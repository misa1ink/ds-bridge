/**
 * Site (endpoint) tests: offline config checks + live switching.
 * Run: node test/sites.e2e.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITES, DEFAULT_SITE, getSite, listSites, resolveSite, isKnownSite } from '../lib/sites.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}

/* ---- 1. definitions are coherent -------------------------------------- */
{
  ok('default site is known', isKnownSite(DEFAULT_SITE), DEFAULT_SITE);
  ok('cn and intl exist', Boolean(SITES.cn && SITES.intl));

  for (const [id, s] of Object.entries(SITES)) {
    ok(`${id}: has origin`, String(s.origin).startsWith('https://'), s.origin);
    ok(`${id}: apiBase matches origin`, s.apiBase.startsWith(s.origin), s.apiBase);
    ok(`${id}: has locale`, /^[a-z]{2}_[A-Z]{2}$/.test(s.locale), s.locale);
    ok(`${id}: has profileSlot`, Boolean(s.profileSlot), s.profileSlot);
    ok(`${id}: has cdpPort`, Number.isInteger(s.cdpPort) && s.cdpPort > 0, String(s.cdpPort));
  }

  // The single most important invariant: profiles and ports must not collide,
  // or two accounts end up sharing one cookie jar.
  const slots = Object.values(SITES).map(s => s.profileSlot);
  const ports = Object.values(SITES).map(s => s.cdpPort);
  ok('profile slots are unique', new Set(slots).size === slots.length, slots.join(','));
  ok('debug ports are unique', new Set(ports).size === ports.length, ports.join(','));

  const locales = Object.values(SITES).map(s => s.locale);
  ok('locales differ per site', new Set(locales).size === locales.length, locales.join(','));
}

/* ---- 2. lookup helpers are total -------------------------------------- */
{
  ok('unknown id falls back to default', getSite('nope').id, );
  ok('unknown id resolves to default', getSite('nope').id === DEFAULT_SITE);
  ok('isKnownSite rejects junk', isKnownSite('nope') === false);

  const list = listSites();
  ok('listSites covers both', list.length === 2, list.map(s => s.id).join(','));
  ok('listSites exposes ports', list.every(s => Number.isInteger(s.cdpPort)));

  // origin override should move apiBase with it
  const over = resolveSite('intl', { intl: { origin: 'https://example.test/' } });
  ok('override applies', over.origin === 'https://example.test/', over.origin);
  ok('apiBase follows origin', over.apiBase === 'https://example.test/api/v0', over.apiBase);
  ok('override keeps id', over.id === 'intl', over.id);
}

/* ---- 3. live server --------------------------------------------------- */
const BASE = process.env.DS_BRIDGE_URL || 'http://127.0.0.1:8788';
let apiKey = '';
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
  const first = (cfg.apiKeys || [])[0];
  apiKey = typeof first === 'string' ? first : first?.key || '';
} catch { /* open bridge */ }
const H = { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) };
const j = async (p, o) => (await fetch(BASE + p, { headers: H, ...o })).json();

let live = true;
try { await j('/health'); } catch { live = false; }

if (!live) {
  console.log('\n(server not running — skipped live checks)');
} else {
  const before = await j('/v1/sites');
  ok('GET /v1/sites works', before.ok === true);
  ok('sites list has both', (before.sites || []).length === 2);
  ok('exactly one active', (before.sites || []).filter(s => s.active).length === 1);

  const original = before.active;

  // Switch to the other site, confirm it persisted, then switch back.
  const other = original === 'cn' ? 'intl' : 'cn';
  const sw = await j('/v1/sites/switch', {
    method: 'POST', body: JSON.stringify({ site: other }),
  });
  ok('switch accepted', sw.ok === true, `${sw.active} / ${sw.label}`);
  ok('switch reports origin', typeof sw.origin === 'string', sw.origin);

  const after = await j('/v1/sites');
  ok('active follows switch', after.active === other, after.active);

  const saved = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
  ok('site persisted to config.json', saved.site === other, String(saved.site));

  const health = await j('/health');
  ok('health reports the active site', health.site === other, health.site);
  ok('health reports per-site pool state', Array.isArray(health.sites) && health.sites.length === 2);

  // Unknown site must be rejected, not silently defaulted.
  const bad = await fetch(BASE + '/v1/sites/switch', {
    method: 'POST', headers: H, body: JSON.stringify({ site: 'nope' }),
  });
  ok('unknown site rejected', bad.status === 400, `status=${bad.status}`);

  // Restore the original choice so the test is idempotent.
  await j('/v1/sites/switch', { method: 'POST', body: JSON.stringify({ site: original }) });
  const restored = await j('/v1/sites');
  ok('original site restored', restored.active === original, restored.active);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
