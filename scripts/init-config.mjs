/**
 * Writes config.json from the preset text files and a fresh API key.
 * Run: node scripts/init-config.mjs [--rotate] [--force]
 *
 * Keeps existing keys unless --rotate is passed, so re-running never
 * invalidates a key already pasted into SillyTavern.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKey } from '../lib/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'config.json');
const PRESETS = path.join(ROOT, 'presets');

const args = new Set(process.argv.slice(2));
const rotate = args.has('--rotate');
const force = args.has('--force');

const read = name => fs.readFileSync(path.join(PRESETS, name), 'utf8').trim();

let existing = {};
if (fs.existsSync(CONFIG) && !force) {
  try { existing = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { existing = {}; }
}

const haveKeys = Array.isArray(existing.apiKeys)
  && existing.apiKeys.some(k => (typeof k === 'string' ? k : k?.key));

let apiKeys;
if (haveKeys && !rotate) {
  apiKeys = existing.apiKeys;
} else {
  // Rotating replaces the list; otherwise keep the old one alongside the new key.
  const fresh = { key: generateKey(), label: 'sillytavern' };
  apiKeys = rotate ? [fresh] : [...(existing.apiKeys || []), fresh];
}

const config = {
  server: { host: '127.0.0.1', port: 8788 },
  apiKeys,
  concurrency: 2,
  modelAlias: 'deepseek-web',

  // Sent ahead of every batch-fill prompt. The database plugin has no preset,
  // so this is the only place the fiction framing enters that path.
  fillSystemPrompt: [read('core-nsfw.txt'), read('scene-nsfw.txt')].join('\n\n'),

  // Appended after the client's own system prompt on /v1/chat/completions.
  // Empty on purpose: the imported SillyTavern preset already carries the
  // framing, and doubling it degrades instruction-following.
  chatSystemSuffix: '',

  assistantPrefill: '',
  thinking: false,
  search: false,
};

fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2) + '\n', 'utf8');

const shown = apiKeys.map(k => (typeof k === 'string' ? { key: k, label: '' } : k));
console.log(`wrote ${path.relative(ROOT, CONFIG)}`);
console.log(`\nAPI key(s):`);
for (const k of shown) console.log(`  ${k.key}${k.label ? '   # ' + k.label : ''}`);
console.log(`\nSillyTavern -> API key: ${shown[shown.length - 1].key}`);
console.log(`fillSystemPrompt: ${config.fillSystemPrompt.length} chars`);
if (haveKeys && !rotate) console.log('(existing keys kept; pass --rotate to replace)');
