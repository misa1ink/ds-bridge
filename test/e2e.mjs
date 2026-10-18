/**
 * End-to-end check against a running bridge.
 * Usage: node test/e2e.mjs [baseUrl]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || process.env.DS_BRIDGE_URL || 'http://127.0.0.1:8788';

// Read the key the same way the smoke test does, so this works on a locked bridge.
let apiKey = '';
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
  const first = (cfg.apiKeys || [])[0];
  apiKey = typeof first === 'string' ? first : first?.key || '';
} catch { /* open bridge */ }

const auth = apiKey ? { authorization: `Bearer ${apiKey}` } : {};

async function post(path, payload) {
  const t0 = Date.now();
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify(payload),
  });
  const body = await r.json();
  return { status: r.status, body, ms: Date.now() - t0 };
}

const login = await fetch(BASE + '/v1/login/check', { headers: auth }).then(r => r.json());
if (!login.ok) {
  console.error('not logged in — sign in to chat.deepseek.com in the bridge browser first');
  console.error('  ' + (login.error || ''));
  console.error('  if this says "missing key", set apiKeys in config.json or run scripts/init-config.mjs');
  process.exit(1);
}
console.log('login: ok');

/* ---- 1. plain completion, verify the tail is not truncated ------------- */
const long = await post('/v1/chat/completions', {
  model: 'deepseek-web',
  stream: false,
  messages: [{ role: 'user', content: '写一句话描述雨夜的旧书店，必须包含"苔藓"二字，20到40字。' }],
});
const text = long.body?.choices?.[0]?.message?.content ?? '';
console.log(`\n[chat] ${long.ms}ms, ${text.length} chars`);
console.log('  ' + text);
console.log('  contains 苔藓:', text.includes('苔藓'));
console.log('  ends with punctuation:', /[。！？.!?」』"]$/.test(text.trim()));

/* ---- 2. streaming shape ------------------------------------------------ */
{
  const r = await fetch(BASE + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({
      model: 'deepseek-web',
      stream: true,
      messages: [{ role: 'user', content: '数三个数：一二三。只输出这三个字。' }],
    }),
  });
  const raw = await r.text();
  const frames = raw.split('\n\n').filter(Boolean);
  const chunks = frames
    .filter(f => f.startsWith('data: ') && !f.includes('[DONE]'))
    .map(f => { try { return JSON.parse(f.slice(6)); } catch { return null; } })
    .filter(Boolean);
  const joined = chunks.map(c => c.choices?.[0]?.delta?.content || '').join('');
  console.log(`\n[stream] frames=${frames.length} chunks=${chunks.length}`);
  console.log('  joined: ' + JSON.stringify(joined));
  console.log('  has [DONE]:', raw.includes('[DONE]'));
  console.log('  has finish_reason:', chunks.some(c => c.choices?.[0]?.finish_reason));
}

/* ---- 3. batch table fill ---------------------------------------------- */
const fill = await post('/v1/table/fill', {
  context: '角色：林雾，25岁，古董书店店主，冷静寡言。场景：雨夜刚打烊，客人推门进来。',
  columns: [
    { key: 'name', desc: '角色名' },
    { key: 'mood', desc: '当前情绪，两字词' },
    { key: 'outfit', desc: '此刻着装细节，一句' },
    { key: 'intent', desc: '对来客的意图，一句' },
  ],
  rows: [{ name: '林雾' }],
});
console.log(`\n[fill] ${fill.ms}ms ok=${fill.body.ok}`);
console.log('  ' + JSON.stringify(fill.body.rows ?? fill.body.reason));
if (fill.body.rows?.[0]) {
  const row = fill.body.rows[0];
  const keys = Object.keys(row);
  console.log('  keys:', keys.join(','));
  console.log('  no extra keys:', keys.every(k => ['name', 'mood', 'outfit', 'intent'].includes(k)));
}

const ok = text.includes('苔藓') && fill.body.ok === true;
console.log(`\n${ok ? 'E2E OK' : 'E2E INCOMPLETE'}`);
process.exit(ok ? 0 : 1);
