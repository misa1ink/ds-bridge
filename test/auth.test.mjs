/**
 * Auth + preset injection tests. Run offline: node test/auth.test.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, matchKey, normalizeKeys, generateKey } from '../lib/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
void __dirname;

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}\n        got ${a}\n        want ${e}`); }
}

const cfg = loadConfig();

/* ---- key normalization ------------------------------------------------ */
check('string keys normalize', normalizeKeys(['a', 'b']).map(k => k.key), ['a', 'b']);
check('object keys keep labels', normalizeKeys([{ key: 'x', label: 'tavern' }]), [{ key: 'x', label: 'tavern' }]);
check('blank entries dropped', normalizeKeys(['', '  ', null, { key: '' }]).length, 0);

/* ---- generated keys look sane ----------------------------------------- */
{
  const k = generateKey();
  check('key prefix', k.startsWith('sk-dsb-'), true);
  check('key length', k.length, 7 + 48);
  check('two keys differ', generateKey() === generateKey(), false);
}

/* ---- matching --------------------------------------------------------- */
{
  const sample = { apiKeys: [{ key: 'sk-dsb-aaa', label: 'tavern' }] };
  check('exact match wins', matchKey(sample, 'sk-dsb-aaa')?.label, 'tavern');
  check('wrong key rejected', matchKey(sample, 'sk-dsb-bbb'), null);
  check('empty presentation rejected', matchKey(sample, ''), null);
  check('no keys configured stays open', matchKey({ apiKeys: [] }, 'anything'), { key: '', label: 'open' });
}

/* ---- live config has what the routes expect --------------------------- */
check('config has api keys', Array.isArray(cfg.apiKeys) && cfg.apiKeys.length > 0, true);
check('fill prompt is present', (cfg.fillSystemPrompt || '').length > 500, true);
check('fill prompt frames fiction', /{{char}}/.test(cfg.fillSystemPrompt), true);
check('fill prompt forbids fourth wall', /fourth wall/i.test(cfg.fillSystemPrompt), true);
check('chat suffix empty by default', cfg.chatSystemSuffix, '');

/* ---- preset file is importable --------------------------------------- */
{
  const fs = await import('node:fs');
  const presetPath = path.join(__dirname, '..', 'presets', 'DS-Bridge-NSFW.json');
  const preset = JSON.parse(fs.readFileSync(presetPath, 'utf8'));

  check('preset targets custom endpoint', preset.chat_completion_source, 'custom');
  check('preset url points at bridge', preset.custom_url.startsWith('http://127.0.0.1'), true);
  check('preset model set', preset.custom_model, 'deepseek-web');

  const ids = preset.prompts.map(p => p.identifier);
  check('has main prompt', ids.includes('main'), true);
  check('has nsfw prompt', ids.includes('nsfw'), true);
  check('has jailbreak prompt', ids.includes('jailbreak'), true);

  const main = preset.prompts.find(p => p.identifier === 'main');
  const nsfw = preset.prompts.find(p => p.identifier === 'nsfw');
  check('main prompt keeps {{char}}', main.content.includes('{{char}}'), true);
  check('nsfw prompt forbids summarizing', /no time skip|never summarize/i.test(nsfw.content), true);

  for (const order of preset.prompt_order) {
    const missing = order.order.filter(o => !ids.includes(o.identifier));
    check(`order ${order.character_id} refs known ids`, missing, []);
  }

  check('streaming on', preset.stream_openai, true);
  check('context raised for long scenes', preset.openai_max_context >= 32000, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
