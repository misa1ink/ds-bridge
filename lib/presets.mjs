/**
 * Preset import/export.
 *
 * Accepts whatever people actually have on disk:
 *   - SillyTavern Chat Completion preset JSON (prompts[] + prompt_order[])
 *   - SillyTavern "completion" preset JSON (single prompt string)
 *   - a bare .txt jailbreak prompt
 *   - a JSON array of {find, replace} regex scripts
 *
 * Everything is normalised into one internal shape, then saved under
 * presets/imported/ so it survives restarts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PRESET_DIR = path.join(__dirname, '..', 'presets');
export const IMPORT_DIR = path.join(PRESET_DIR, 'imported');

const builtin = {
  get core() { return readIfExists(path.join(PRESET_DIR, 'core-nsfw.txt'), ''); },
  get scene() { return readIfExists(path.join(PRESET_DIR, 'scene-nsfw.txt'), ''); },
};

function readIfExists(file, fallback = '') {
  try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Strips characters that would escape the preset directory. */
export function safeName(name) {
  const base = String(name || 'preset')
    .replace(/\.(json|txt)$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80);
  return base || 'preset';
}

/* ------------------------------------------------------------------ */
/* normalisation                                                       */
/* ------------------------------------------------------------------ */

/**
 * Pulls prompt text out of a SillyTavern Chat Completion preset.
 * Returns { main, nsfw, jailbreak, prompts, source } with empty strings for
 * whatever the file did not define.
 */
function fromChatCompletion(json) {
  const prompts = Array.isArray(json.prompts) ? json.prompts : [];
  const byId = id => prompts.find(p => p && p.identifier === id);
  const content = id => {
    const p = byId(id);
    return p && typeof p.content === 'string' ? p.content.trim() : '';
  };

  return {
    source: 'sillytavern-chat',
    main: content('main'),
    nsfw: content('nsfw'),
    jailbreak: content('jailbreak'),
    prompts: prompts.filter(p => p && typeof p.identifier === 'string'),
    order: json.prompt_order,
    settings: pickSettings(json),
  };
}

/**
 * Text-completion presets keep everything in one string separated by markers,
 * so the pieces are split back out when present.
 */
function fromCompletionPreset(json) {
  const raw = String(json.prompt || json.system_prompt || '').trim();
  const parts = raw.split(/\n(?=\[?(?:Main Prompt|Auxiliary Prompt|Post-History Instructions)\]?[:：]?)/i);
  const find = label => {
    const block = parts.find(p => new RegExp(label, 'i').test(p.slice(0, 60)));
    return block ? block.replace(/^\[?[^\]]*\]?[:：]?\s*/i, '').trim() : '';
  };
  return {
    source: 'sillytavern-completion',
    main: find('Main Prompt') || raw,
    nsfw: find('Auxiliary Prompt'),
    jailbreak: find('Post-History'),
    prompts: [],
    settings: pickSettings(json),
  };
}

function pickSettings(json) {
  const out = {};
  for (const key of ['temperature', 'frequency_penalty', 'presence_penalty', 'top_p', 'top_k',
    'min_p', 'repetition_penalty', 'openai_max_context', 'openai_max_tokens',
    'assistant_prefill', 'stream_openai']) {
    if (json[key] !== undefined && json[key] !== null) out[key] = json[key];
  }
  return out;
}

/**
 * Detects the file kind and returns the normalised preset.
 * Throws a readable error instead of silently accepting garbage.
 */
export function parsePreset(rawText, filename = 'preset.json') {
  const text = String(rawText || '').replace(/^\uFEFF/, '').trim();
  if (!text) throw new Error('文件是空的');

  let json = null;
  if (/^[{[]/.test(text)) {
    try { json = JSON.parse(text); } catch (err) {
      throw new Error('JSON 解析失败：' + err.message);
    }
  }

  if (json && !Array.isArray(json)) {
    if (Array.isArray(json.prompts)) return { ...fromChatCompletion(json), rawName: filename };
    if (typeof json.prompt === 'string' || typeof json.system_prompt === 'string') {
      return { ...fromCompletionPreset(json), rawName: filename };
    }
    // A bare {"main": "...", "nsfw": "..."} style file is also accepted.
    if (typeof json.main === 'string' || typeof json.nsfw === 'string') {
      return {
        source: 'custom-json',
        main: String(json.main || '').trim(),
        nsfw: String(json.nsfw || '').trim(),
        jailbreak: String(json.jailbreak || '').trim(),
        prompts: [],
        settings: pickSettings(json),
        rawName: filename,
      };
    }
    throw new Error('认不出这个 JSON：既没有 prompts[]，也没有 prompt 字段');
  }

  if (Array.isArray(json)) {
    const isRegex = json.every(x => x && typeof x === 'object' && 'find' in x);
    if (isRegex) {
      return {
        source: 'regex-scripts',
        main: '', nsfw: '', jailbreak: '',
        prompts: [],
        regex: json.map(r => ({ find: String(r.find), replace: String(r.replace ?? ''), name: r.name || '' })),
        rawName: filename,
      };
    }
    throw new Error('JSON 数组格式不认识');
  }

  // Plain text: treat the whole thing as the main prompt.
  return {
    source: 'plain-text',
    main: text,
    nsfw: '',
    jailbreak: '',
    prompts: [],
    settings: {},
    rawName: filename,
  };
}

/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */

function normalizeStored(name, parsed) {
  const now = new Date().toISOString();
  return {
    name,
    createdAt: parsed.createdAt || now,
    updatedAt: now,
    source: parsed.source || 'custom',
    main: parsed.main || '',
    nsfw: parsed.nsfw || '',
    jailbreak: parsed.jailbreak || '',
    settings: parsed.settings || {},
    regex: parsed.regex || [],
    // The raw prompts[] are kept so an export round-trips to SillyTavern.
    prompts: parsed.prompts || [],
    notes: parsed.notes || '',
  };
}

export function savePreset(name, parsed) {
  ensureDir(IMPORT_DIR);
  const safe = safeName(name);
  const file = path.join(IMPORT_DIR, `${safe}.json`);

  let createdAt;
  if (fs.existsSync(file)) {
    try { createdAt = JSON.parse(fs.readFileSync(file, 'utf8')).createdAt; } catch { /* overwrite */ }
  }

  const record = normalizeStored(safe, { ...parsed, createdAt });
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return record;
}

export function listPresets() {
  ensureDir(IMPORT_DIR);
  const items = [];
  for (const entry of fs.readdirSync(IMPORT_DIR)) {
    if (!entry.endsWith('.json')) continue;
    const file = path.join(IMPORT_DIR, entry);
    try {
      const p = JSON.parse(fs.readFileSync(file, 'utf8'));
      items.push({
        name: p.name || entry.replace(/\.json$/, ''),
        source: p.source,
        updatedAt: p.updatedAt,
        sizes: { main: (p.main || '').length, nsfw: (p.nsfw || '').length, jailbreak: (p.jailbreak || '').length },
      });
    } catch { /* skip a corrupt file rather than failing the listing */ }
  }
  return items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function loadPreset(name) {
  const file = path.join(IMPORT_DIR, `${safeName(name)}.json`);
  if (!fs.existsSync(file)) throw new Error('预设不存在: ' + name);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function deletePreset(name) {
  const file = path.join(IMPORT_DIR, `${safeName(name)}.json`);
  if (!fs.existsSync(file)) throw new Error('预设不存在: ' + name);
  fs.unlinkSync(file);
  return true;
}

/**
 * Exports a stored preset back to a SillyTavern Chat Completion file so it can
 * be imported on another machine.
 */
export function exportAsSillyTavern(name) {
  const p = loadPreset(name);
  const prompts = Array.isArray(p.prompts) && p.prompts.length
    ? p.prompts.map(x => ({ ...x }))
    : buildDefaultPrompts(p);

  const ensure = (id, fallback) => {
    const found = prompts.find(x => x.identifier === id);
    if (found) return found;
    const added = { identifier: id, name: id, system_prompt: true, role: 'system', content: fallback, marker: false };
    prompts.push(added);
    return added;
  };

  ensure('main', p.main || 'Write {{char}}\'s next reply.');
  ensure('nsfw', p.nsfw || '');
  ensure('jailbreak', p.jailbreak || '');

  const order = (p.order && p.order[0] && p.order[0].order) || prompts.map(x => ({ identifier: x.identifier, enabled: true }));

  return {
    chat_completion_source: 'custom',
    custom_url: 'http://127.0.0.1:8788/v1',
    custom_model: 'deepseek-web',
    temperature: p.settings?.temperature ?? 1,
    top_p: p.settings?.top_p ?? 0.95,
    openai_max_context: p.settings?.openai_max_context ?? 64000,
    openai_max_tokens: p.settings?.openai_max_tokens ?? 1200,
    stream_openai: p.settings?.stream_openai ?? true,
    prompts,
    prompt_order: [{ character_id: 100000, order }, { character_id: 100001, order }],
    bypass_status_check: true,
    max_context_unlocked: true,
  };
}

function buildDefaultPrompts(p) {
  return [
    { identifier: 'main', name: 'Main Prompt', system_prompt: true, role: 'system', content: p.main || '', marker: false },
    { identifier: 'nsfw', name: 'Auxiliary Prompt', system_prompt: true, role: 'system', content: p.nsfw || '', marker: false },
    { identifier: 'jailbreak', name: 'Post-History Instructions', system_prompt: true, role: 'system', content: p.jailbreak || '', marker: false },
    { identifier: 'chatHistory', name: 'Chat History', system_prompt: true, marker: true },
    { identifier: 'worldInfoBefore', name: 'World Info (before)', system_prompt: true, marker: true },
    { identifier: 'worldInfoAfter', name: 'World Info (after)', system_prompt: true, marker: true },
    { identifier: 'charDescription', name: 'Char Description', system_prompt: true, marker: true },
    { identifier: 'charPersonality', name: 'Char Personality', system_prompt: true, marker: true },
    { identifier: 'scenario', name: 'Scenario', system_prompt: true, marker: true },
  ];
}

/**
 * Composes the text actually injected for a preset.
 * Order matters: identity frame, then scene discipline, then stop instructions.
 */
export function composeFillPrompt(preset) {
  const parts = [];
  if (preset.main) parts.push(preset.main);
  if (preset.nsfw) parts.push(preset.nsfw);
  if (preset.jailbreak) parts.push(preset.jailbreak);
  return parts.join('\n\n').trim();
}

export function activePresetName(cfg) {
  return cfg.activePreset || '';
}

/** Resolves the fill prompt: active imported preset wins, built-ins are the fallback. */
export function resolveFillPrompt(cfg) {
  if (cfg.activePreset) {
    try {
      const p = loadPreset(cfg.activePreset);
      const text = composeFillPrompt(p);
      if (text) return { text, from: p.name, source: p.source };
    } catch { /* fall through to defaults */ }
  }
  const text = [builtin.core, builtin.scene].filter(Boolean).join('\n\n').trim();
  return { text, from: 'built-in', source: 'bundled' };
}

export { builtin as builtinPrompts };
