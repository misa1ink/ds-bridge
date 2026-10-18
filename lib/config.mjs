import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = process.env.DS_CONFIG || path.join(ROOT, 'config.json');

const DEFAULTS = {
  server: { host: '127.0.0.1', port: 8788 },
  apiKeys: [],
  concurrency: 2,
  modelAlias: 'deepseek-web',
  // Which DeepSeek endpoint the bridge talks to: 'cn' or 'intl'.
  site: 'cn',
  // Per-site overrides, e.g. { intl: { origin: "https://..." } }.
  siteOverrides: {},
  // Applied to /v1/table/fill — the database plugin never sends a preset,
  // so the fiction framing has to come from here.
  fillSystemPrompt: '',
  // Name of an imported preset under presets/imported/ that overrides
  // fillSystemPrompt. Empty means "use the built-in framing".
  activePreset: '',
  // Appended after whatever system content the client sent on /v1/chat/completions.
  chatSystemSuffix: '',
  // Prepended to the assistant turn to force the model out of "assistant" voice.
  assistantPrefill: '',
  thinking: false,
  search: false,
};

function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

let cached = null;

/**
 * Reads a JSON file, tolerating a UTF-8 BOM (Windows editors add one).
 * Returns `fallback` when the file is missing or unparsable.
 */
function readJsonFile(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

/**
 * Persists a patch to config.json.
 * Writes atomically (temp file + rename) so a crash mid-write cannot leave a
 * truncated config that would stop the bridge from starting.
 */
export function saveConfig(patch) {
  const fileCfg = fs.existsSync(CONFIG_PATH) ? readJsonFile(CONFIG_PATH, {}) : {};
  const merged = deepMerge(fileCfg, patch);
  const tmp = CONFIG_PATH + '.tmp';
  // encoding 'utf8' writes no BOM, which keeps the file parseable by jq and by
  // anything that does not strip one.
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
  cached = null;
  return loadConfig({ reload: true });
}

/**
 * Loads config.json, falling back to defaults. Env vars win over the file so a
 * temporary override never requires editing the file.
 */
export function loadConfig({ reload = false } = {}) {
  if (cached && !reload) return cached;

  let fileCfg = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      // PowerShell's Set-Content and many Windows editors prepend a BOM, which
      // JSON.parse rejects. Strip it so a hand-edited config still loads.
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
      fileCfg = JSON.parse(raw);
    } catch (err) {
      throw new Error(`config.json is not valid JSON: ${err.message}`);
    }
  }

  const cfg = deepMerge(DEFAULTS, fileCfg);

  if (process.env.DS_BRIDGE_HOST) cfg.server.host = process.env.DS_BRIDGE_HOST;
  if (process.env.DS_BRIDGE_PORT) cfg.server.port = Number(process.env.DS_BRIDGE_PORT);
  if (process.env.DS_CONCURRENCY) cfg.concurrency = Number(process.env.DS_CONCURRENCY);
  if (process.env.DS_MODEL_ALIAS) cfg.modelAlias = process.env.DS_MODEL_ALIAS;

  // A single env key is appended, not substituted, so existing keys keep working.
  if (process.env.DS_BRIDGE_KEY) {
    cfg.apiKeys = [...new Set([...(cfg.apiKeys || []), process.env.DS_BRIDGE_KEY])];
  }

  if (!Array.isArray(cfg.apiKeys)) cfg.apiKeys = [];

  cached = cfg;
  return cfg;
}

/**
 * Accepts either a bare string or {key, label} entries so keys can be rotated
 * per client (SillyTavern, a script, a phone) without sharing one secret.
 */
export function normalizeKeys(list) {
  return (list || [])
    .map(entry => (typeof entry === 'string' ? { key: entry, label: '' } : entry))
    .filter(entry => entry && typeof entry.key === 'string' && entry.key.trim())
    .map(entry => ({ key: entry.key.trim(), label: entry.label || '' }));
}

export function matchKey(cfg, presented) {
  if (!presented) return null;
  const keys = normalizeKeys(cfg.apiKeys);
  if (keys.length === 0) return { key: '', label: 'open' };
  return keys.find(k => k.key === presented) || null;
}

export function generateKey(prefix = 'sk-dsb') {
  const hex = crypto.randomBytes(24).toString('hex');
  return `${prefix}-${hex}`;
}

export { CONFIG_PATH, ROOT };
