/**
 * Console API tests against a running bridge: live view + preset lifecycle.
 * Run: node test/console.e2e.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.DS_BRIDGE_URL || 'http://127.0.0.1:8788';

let apiKey = '';
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
  const first = (cfg.apiKeys || [])[0];
  apiKey = typeof first === 'string' ? first : first?.key || '';
} catch { /* open bridge */ }

const auth = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
const H = { 'content-type': 'application/json', ...auth };

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}

async function get(p) {
  const r = await fetch(BASE + p, { headers: auth });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function post(p, payload) {
  const r = await fetch(BASE + p, { method: 'POST', headers: H, body: JSON.stringify(payload) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

/* ---- bootstrap -------------------------------------------------------- */
{
  const r = await fetch(BASE + '/v1/console/bootstrap').then(x => x.json()).catch(() => null);
  ok('bootstrap answers', r && r.ok === true, r ? `label=${r.label}` : 'no response');
  ok('bootstrap returns the configured key', r && r.key === apiKey, r ? `…${String(r.key).slice(-6)}` : '');
}

/* ---- live view -------------------------------------------------------- */
{
  const st = await get('/v1/view/status');
  ok('view status ok', st.body?.ok === true, st.body?.error || 'active');
  ok('view has a url', typeof st.body?.url === 'string', st.body?.url || '');

  const snap = await get('/v1/view/snapshot');
  ok('snapshot returns jpeg', typeof snap.body?.image === 'string'
    && snap.body.image.startsWith('data:image/jpeg;base64,'), `${(snap.body?.image || '').length} chars`);

  // A frame must be a decodable JPEG, not a placeholder.
  if (snap.body?.image) {
    const buf = Buffer.from(snap.body.image.split(',')[1], 'base64');
    ok('snapshot is a real image', buf.length > 2000 && buf[0] === 0xff && buf[1] === 0xd8,
      `${buf.length} bytes, magic ${buf[0].toString(16)}${buf[1].toString(16)}`);
  }

  const nav = await post('/v1/view/input', { action: 'navigate', url: 'https://chat.deepseek.com/' });
  ok('navigate accepted', nav.body?.ok === true, nav.body?.error || 'ok');

  const bad = await post('/v1/view/input', { action: 'nonsense' });
  ok('unknown input action rejected', bad.status === 400, `status=${bad.status}`);
}

/* ---- SSE stream sends frames ----------------------------------------- */
{
  const ctrl = new AbortController();
  const q = apiKey ? `?key=${encodeURIComponent(apiKey)}` : '';
  const res = await fetch(BASE + '/v1/view/stream' + q, { signal: ctrl.signal });
  ok('stream content-type', (res.headers.get('content-type') || '').startsWith('text/event-stream'),
    res.headers.get('content-type') || '');

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let gotFrame = false;
  let gotStatus = false;
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    if (buf.includes('event: status')) gotStatus = true;
    if (buf.includes('event: frame')) { gotFrame = true; break; }
  }
  ctrl.abort();
  ok('stream sends status event', gotStatus);
  ok('stream sends frames', gotFrame, `${buf.length} bytes buffered`);
}

/* ---- preset lifecycle ------------------------------------------------- */
{
  const name = '__console_test__';
  try { await post('/v1/presets/delete', { name }); } catch { /* not there */ }

  const before = await get('/v1/presets');
  ok('presets list ok', before.body?.ok === true, `active=${before.body?.active || 'built-in'}`);

  const txt = 'You are {{char}}, a fiction engine. Never break character.';
  const imp = await post('/v1/presets/import', { content: txt, filename: 'x.txt', name });
  ok('import plain text', imp.body?.ok === true, imp.body?.source || imp.body?.error);
  ok('import activates by default', imp.body?.active === name, imp.body?.active || '');

  const pv = await get('/v1/presets/preview');
  ok('preview reflects import', pv.body?.from === name, `${pv.body?.from} / ${pv.body?.length} chars`);
  ok('preview text is the pasted text', (pv.body?.text || '').includes('fiction engine'));

  const health = await get('/health');
  ok('health reports active preset', health.body?.preset === name, health.body?.preset || '');

  const del = await post('/v1/presets/delete', { name });
  ok('delete works', del.body?.ok === true);
  ok('delete clears active', del.body?.active === '', JSON.stringify(del.body?.active));

  const after = await get('/v1/presets/preview');
  ok('falls back to built-in', after.body?.source === 'bundled', after.body?.source || '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
