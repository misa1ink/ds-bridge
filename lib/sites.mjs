/**
 * Endpoint (site) definitions.
 *
 * DeepSeek serves both regions from `chat.deepseek.com`; what differs is the
 * account's assigned cluster plus the UI locale. The bundle only ever
 * references that one chat host, so "international" is not a separate domain.
 *
 * Still, three real things differ per region and all three matter here:
 *   - `x-client-locale` sent on every API call
 *   - the browser profile that holds the login (CN and INTL accounts must not
 *     share one cookie jar)
 *   - the sign-in page locale the user sees in the mirrored view
 *
 * So a site is described as: base URL + locale + profile slot. The base URL is
 * per-site configurable, which also covers any future dedicated domain without
 * touching code.
 */

export const SITES = {
  cn: {
    id: 'cn',
    label: '国内站',
    description: 'chat.deepseek.com · 简体中文 · 手机号登录',
    origin: 'https://chat.deepseek.com',
    apiBase: 'https://chat.deepseek.com/api/v0',
    locale: 'zh_CN',
    acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
    // DeepSeek's own locale preference key, used to steer the mirrored UI.
    uiLocale: 'zh_CN',
    profileSlot: 'cn',
    // Fixed debug port per site: two accounts cannot share one browser, and a
    // stable port makes "attach to the one already running" reliable.
    cdpPort: 9222,
    timezoneOffset: '28800',
  },
  intl: {
    id: 'intl',
    label: '国际站',
    description: 'chat.deepseek.com · English · email / Google 登录',
    origin: 'https://chat.deepseek.com',
    apiBase: 'https://chat.deepseek.com/api/v0',
    locale: 'en_US',
    acceptLanguage: 'en-US,en;q=0.9,zh-CN;q=0.6',
    uiLocale: 'en_US',
    profileSlot: 'intl',
    cdpPort: 9223,
    timezoneOffset: '0',
  },
};

export const DEFAULT_SITE = 'cn';

/** Returns the site config, falling back to the default for unknown ids. */
export function getSite(id) {
  return SITES[id] || SITES[DEFAULT_SITE];
}

export function listSites() {
  return Object.values(SITES).map(s => ({
    id: s.id,
    label: s.label,
    description: s.description,
    origin: s.origin,
    locale: s.locale,
    profileSlot: s.profileSlot,
    cdpPort: s.cdpPort,
  }));
}

/**
 * Site overrides from config.json let a different deployment point at another
 * origin without editing this file, e.g.
 *   { sites: { intl: { origin: "https://chat.example.com" } } }
 */
export function resolveSite(id, overrides = {}) {
  const base = getSite(id);
  const patch = (overrides && overrides[id]) || {};
  const merged = { ...base, ...patch };
  // Keep apiBase consistent when only the origin was overridden.
  if (patch.origin && !patch.apiBase) merged.apiBase = patch.origin.replace(/\/+$/, '') + '/api/v0';
  merged.id = base.id;
  return merged;
}

export function isKnownSite(id) {
  return Object.prototype.hasOwnProperty.call(SITES, id);
}
