/**
 * Preset import/export tests. Offline: node test/presets.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  parsePreset, savePreset, listPresets, loadPreset, deletePreset,
  exportAsSillyTavern, composeFillPrompt, safeName, IMPORT_DIR,
} from '../lib/presets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}\n        got ${a}\n        want ${e}`); }
}
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}

/* ---- 1. real SillyTavern Chat Completion preset ----------------------- */
{
  const text = fs.readFileSync(path.join(__dirname, '..', 'presets', 'DS-Bridge-NSFW.json'), 'utf8');
  const p = parsePreset(text, 'tavern.json');
  check('st source', p.source, 'sillytavern-chat');
  ok('st main extracted', p.main.length > 1000, `${p.main.length} chars`);
  ok('st nsfw extracted', p.nsfw.length > 300, `${p.nsfw.length} chars`);
  ok('st jailbreak extracted', p.jailbreak.length > 50, `${p.jailbreak.length} chars`);
  ok('st keeps prompts[]', Array.isArray(p.prompts) && p.prompts.length === 12, `${p.prompts?.length} prompts`);
  ok('st settings carried', p.settings.openai_max_context >= 32000, String(p.settings.openai_max_context));
}

/* ---- 2. plain text jailbreak ----------------------------------------- */
{
  const p = parsePreset('You are {{char}}. Never break character.', 'jail.txt');
  check('txt source', p.source, 'plain-text');
  check('txt whole as main', p.main, 'You are {{char}}. Never break character.');
  check('txt no nsfw', p.nsfw, '');
}

/* ---- 3. BOM is stripped ---------------------------------------------- */
{
  const p = parsePreset('\uFEFF{"main":"hello"}', 'bom.json');
  check('bom stripped from main', p.main, 'hello');
}

/* ---- 4. custom minimal json ------------------------------------------ */
{
  const p = parsePreset(JSON.stringify({ main: 'M', nsfw: 'N', jailbreak: 'J' }), 'mini.json');
  check('custom source', p.source, 'custom-json');
  check('custom main', p.main, 'M');
  check('custom nsfw', p.nsfw, 'N');
}

/* ---- 5. completion-style preset (single prompt string) ---------------- */
{
  const file = {
    prompt: '[Main Prompt]\nWrite as {{char}}.\n\n[Auxiliary Prompt]\nStay in scene.\n\n[Post-History Instructions]\nDo not summarize.',
  };
  const p = parsePreset(JSON.stringify(file), 'completion.json');
  check('completion source', p.source, 'sillytavern-completion');
  ok('completion main split', p.main.includes('{{char}}'), p.main.slice(0, 40));
  ok('completion nsfw split', p.nsfw.includes('Stay in scene'), p.nsfw);
  ok('completion jailbreak split', p.jailbreak.includes('summarize'), p.jailbreak);
}

/* ---- 6. regex script array ------------------------------------------- */
{
  const p = parsePreset(JSON.stringify([{ find: 'foo', replace: 'bar', name: 'r1' }]), 'regex.json');
  check('regex source', p.source, 'regex-scripts');
  check('regex carried', p.regex[0].find, 'foo');
}

/* ---- 7. garbage is rejected, not swallowed --------------------------- */
{
  let threw = false;
  try { parsePreset('{ not json', 'bad.json'); } catch { threw = true; }
  ok('broken json throws', threw);

  let threw2 = false;
  try { parsePreset('', 'empty.txt'); } catch { threw2 = true; }
  ok('empty file throws', threw2);

  let threw3 = false;
  try { parsePreset('{"foo":"bar"}', 'unknown.json'); } catch { threw3 = true; }
  ok('unknown json shape throws', threw3);
}

/* ---- 8. path traversal is neutralised -------------------------------- */
{
  // The exact output matters less than the property: no separators, no leading
  // dots, so a crafted name can never escape presets/imported/.
  const evil = safeName('../../etc/passwd');
  ok('no forward slash', !evil.includes('/'), evil);
  ok('no backslash', !safeName('a\\b').includes('\\'), safeName('a\\b'));
  ok('no leading dot', !evil.startsWith('.'), evil);
  check('traversal cannot escape', path.join(IMPORT_DIR, evil + '.json').startsWith(IMPORT_DIR), true);
  check('extension dropped', safeName('preset.json'), 'preset');
  check('empty falls back', safeName(''), 'preset');
  ok('windows reserved chars replaced', !/[<>:"|?*]/.test(safeName('a<b>c:d"e|f?g*h')), safeName('a<b>c:d"e|f?g*h'));
}

/* ---- 9. save / list / load / delete round trip ----------------------- */
{
  const testName = '__unit_test_preset__';
  // Clean up any leftover from a previous run.
  try { deletePreset(testName); } catch { /* nothing to remove */ }

  const parsed = parsePreset('You are {{char}} in a scene.', 'x.txt');
  const saved = savePreset(testName, parsed);
  check('saved name', saved.name, testName);

  const listed = listPresets().find(p => p.name === testName);
  ok('appears in list', Boolean(listed), listed ? listed.source : 'missing');
  ok('list reports sizes', listed.sizes.main > 0, JSON.stringify(listed.sizes));

  const loaded = loadPreset(testName);
  check('loaded main survives', loaded.main, 'You are {{char}} in a scene.');
  ok('has timestamps', Boolean(loaded.createdAt && loaded.updatedAt));

  deletePreset(testName);
  const after = listPresets().find(p => p.name === testName);
  check('deleted from list', after, undefined);

  // Export needs a preset to exist, so build one and clean up after.
  savePreset(testName, parsed);
  const exported = exportAsSillyTavern(testName);
  check('export source', exported.chat_completion_source, 'custom');
  check('export model', exported.custom_model, 'deepseek-web');
  ok('export has prompts', Array.isArray(exported.prompts) && exported.prompts.length >= 3);
  ok('export has main content', exported.prompts.find(p => p.identifier === 'main').content.includes('{{char}}'));
  ok('export order refs known ids',
    exported.prompt_order[0].order.every(o => exported.prompts.some(p => p.identifier === o.identifier)));
  deletePreset(testName);
}

/* ---- 10. compose order: main -> nsfw -> jailbreak -------------------- */
{
  const composed = composeFillPrompt({ main: 'A', nsfw: 'B', jailbreak: 'C' });
  check('compose order', composed, 'A\n\nB\n\nC');
  check('compose skips empty', composeFillPrompt({ main: 'A', nsfw: '', jailbreak: '' }), 'A');
}

/* ---- 11. imported dir lives under presets/ --------------------------- */
{
  ok('import dir path', IMPORT_DIR.endsWith(path.join('presets', 'imported')), IMPORT_DIR);
}

console.log(`\n${pass} passed, ${fail} failed`);
void os;
process.exit(fail === 0 ? 0 : 1);
