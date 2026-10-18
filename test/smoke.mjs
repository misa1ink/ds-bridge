/**
 * Smoke test: plumbings and auth, no model call needed.
 * Usage: node test/smoke.mjs
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
} catch { /* no config: bridge runs open */ }

const auth = apiKey ? { authorization: `Bearer ${apiKey}` } : {};

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function get(pathname, headers = auth) {
  const r = await fetch(BASE + pathname, { headers });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

async function post(pathname, payload, headers = auth) {
  const r = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

const health = await get('/health');
record('GET /health returns 200', health.status === 200, `status=${health.status}`);
record('browser layer is attached', health.body?.browser === 'ok', String(health.body?.browser));
record('auth state is reported', typeof health.body?.authRequired === 'boolean', `authRequired=${health.body?.authRequired}`);

/* ---- auth gate -------------------------------------------------------- */
if (apiKey) {
  const noKey = await get('/v1/models', {});
  record('unauthenticated request blocked', noKey.status === 401, `status=${noKey.status}`);

  const badKey = await get('/v1/models', { authorization: 'Bearer sk-dsb-nope' });
  record('wrong key blocked', badKey.status === 401, `status=${badKey.status}`);

  const goodKey = await get('/v1/models');
  record('valid key accepted', goodKey.status === 200, `status=${goodKey.status}`);

  const h = JSON.stringify(health.body || {});
  record('health never leaks the key', !h.includes(apiKey.slice(7)), 'ok');
} else {
  record('bridge is open (no keys configured)', true, 'set config.json apiKeys to lock it');
}

const models = await get('/v1/models');
record('GET /v1/models lists aliases', Array.isArray(models.body?.data), `count=${models.body?.data?.length}`);

const login = await get('/v1/login/check');
record('GET /v1/login/check answers', login.status === 200,
  login.body?.ok ? 'logged in' : 'not logged in (expected until you sign in)');

const bad = await post('/v1/chat/completions', { messages: [{ role: 'user', content: '' }] });
record('empty prompt rejected', bad.status === 400, `status=${bad.status}`);

const notFound = await get('/nope');
record('unknown route -> 404', notFound.status === 404);

const fillBad = await post('/v1/table/fill', { rows: [] });
record('fill without columns rejected', fillBad.status === 400, `status=${fillBad.status}`);

const keys = await get('/v1/keys');
record('GET /v1/keys lists labels only',
  Array.isArray(keys.body?.keys) && !JSON.stringify(keys.body).includes('sk-dsb-1'),
  `labels=${(keys.body?.keys || []).map(k => k.label).join(',')}`);

const total = results.length;
const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
