/**
 * Application settings, stored in the "Settings" API of the Extensions app (Postgres on Vercel).
 * A setting is identified by key + site_id ("" = all sites) + extension_id ("*" = all extensions) + environment.
 * This module runs server side only: the API key and decrypted secrets never reach the browser.
 */

import { decryptSetting } from './settings-secrets.js';
import { logApiError } from './log.js';

export class SettingsError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

export const GLOBAL_EXTENSION = '*';

/**
 * Keys used by the app. `general` keys are shared by every extension of the site (extension_id "*"),
 * the others belong to this extension. Keys containing token/password are encrypted by the Settings API.
 * `provided` keys are supplied by the Settings API itself (global level): the app reads them, never writes them.
 */
export const SETTING_KEYS = {
  onestock_token: { secret: true, general: true, provided: true },
  onestock_api_root: { general: true },
  smtp_host: { default: '' },
  smtp_port: { default: '587' },
  smtp_secure: { default: 'false' },
  smtp_user: { default: '' },
  smtp_password: { secret: true },
  smtp_from: { default: '' },
  smtp_bcc: { default: '' },
  email_subject: { default: 'Votre facture pour la commande {{order_id}}' },
  email_body: {
    default:
      'Bonjour {{first_name}} {{last_name}},\n\n' +
      'Veuillez trouver ci-joint la facture de votre commande {{order_id}}.\n\n' +
      'Cordialement,\nLe service client',
  },
};

function apiUrl() {
  return (process.env.SETTINGS_API_URL || 'https://extensions-lemon.vercel.app/api/settings').replace(/\/+$/, '');
}

function apiKey() {
  const key = process.env.SETTINGS_API_KEY;
  if (!key) throw new SettingsError("SETTINGS_API_KEY non configurée dans les variables d'environnement Vercel", 500);
  return key;
}

/**
 * Calls the Settings API. Every failure is logged (lib/log.js); `handled(status, data)` tells which ones the
 * caller recovers from, logged as warnings.
 */
async function request(method, path, params, body, { handled } = {}) {
  const query = params ? `?${new URLSearchParams(params)}` : '';
  const url = `${apiUrl()}${path}${query}`;
  const headers = { Authorization: `Bearer ${apiKey()}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const startedAt = Date.now();
  const log = (entry) => logApiError({ api: 'Settings API', method, url, startedAt, request: body, ...entry });
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (err) {
    log({ error: err.message });
    throw new SettingsError(`API Settings injoignable : ${err.message}`, 502);
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    log({ status: res.status, response: data, error: data.error, handled: Boolean(handled?.(res.status, data)) });
    throw new SettingsError(`API Settings (${res.status}) : ${data.error || 'erreur inconnue'}`, 502);
  }
  return data;
}

const isDecryptFailure = (status, data) => /encryption|decrypt/i.test(data?.error || '') || status === 500;
const isAlreadyExisting = (status, data) => status === 409 || /already_exists/.test(data?.error || '');

/** OneStock environment of the call: explicit value, else deduced from the API URL of the context. */
export function environmentOf({ environment, apiUrl: contextApiUrl } = {}) {
  if (environment) return environment;
  try {
    const host = new URL(contextApiUrl).hostname;
    const match =
      host.match(/\.api\.([a-z0-9-]+)\.onestock-retail\.(com|dev)$/) ||
      host.match(/\.(qualif|dev|training|preprod|staging)\./);
    return match ? match[1] : 'prod';
  } catch {
    return process.env.SETTINGS_ENVIRONMENT || 'qualif';
  }
}

/** Identifies where settings are read from: the extension context (site, extension, environment). */
export function scopeOf(input = {}) {
  return {
    siteId: String(input.site_id || '').trim(),
    extensionId: String(input.extension_id || '').trim() || process.env.EXTENSION_ID || 'invoice',
    environment: environmentOf({ environment: input.environment, apiUrl: input.api_url }),
    contextApiUrl: String(input.api_url || '').trim(),
    // URL of the OneStock page showing the iframe: identifies the OneStock back office, hence its token.
    parentUrl: String(input.parent_url || '').trim(),
  };
}

/** Where a key is written: this site, and "*" for general keys or this extension otherwise. */
export function targetOf(scope, key) {
  return {
    site_id: scope.siteId,
    extension_id: SETTING_KEYS[key]?.general ? GLOBAL_EXTENSION : scope.extensionId,
  };
}

/** Environment whose values are used when the current one has none (per key): prod falls back on qualif. */
export const FALLBACK_ENVIRONMENTS = { prod: 'qualif', production: 'qualif' };

/** Environments read, in order: the current one, then its fallback. */
export function environmentsOf(environment) {
  const fallback = FALLBACK_ENVIRONMENTS[environment];
  return fallback ? [environment, fallback] : [environment];
}

/** Values of site_id meaning "all sites" (the Extensions app uses both). */
export const GLOBAL_SITES = ['', '*'];

/**
 * Lookup order: this site + this extension, this site + all extensions, then the same for all sites
 * (site_id "" then "*"); all of it in the current environment, then in the fallback one (prod → qualif).
 */
function lookupOrder({ siteId, extensionId, environment }) {
  const sites = siteId && !GLOBAL_SITES.includes(siteId) ? [siteId, ...GLOBAL_SITES] : GLOBAL_SITES;
  const extensions = extensionId === GLOBAL_EXTENSION ? [GLOBAL_EXTENSION] : [extensionId, GLOBAL_EXTENSION];
  const order = [];
  for (const env of environmentsOf(environment)) {
    for (const site of sites) {
      for (const extension of extensions) order.push({ site_id: site, extension_id: extension, environment: env });
    }
  }
  return order;
}

/**
 * Secret values still encrypted (`enc:v1:…`, e.g. when the Settings API could not decrypt them) are decrypted
 * here with SETTINGS_ENCRYPTION_KEY, the same key as in the Extensions app. A failure does not break the whole
 * read: it is kept on the row (`error`) and only reported when that setting is actually used.
 */
function decryptRow(row) {
  if (row.decrypt_error) {
    logApiError({
      api: 'Settings API',
      method: 'GET',
      error: `decrypt_error: ${row.key}`,
      response: { key: row.key, site_id: row.site_id, extension_id: row.extension_id, environment: row.environment },
    });
    return { ...row, value: null, error: `L'API Settings n'a pas pu déchiffrer ${row.key} : vérifier SETTINGS_ENCRYPTION_KEY` };
  }
  if (typeof row.value !== 'string' || !row.value.startsWith('enc:v1:')) return row;
  try {
    return { ...row, value: decryptSetting(row.value), encrypted: false };
  } catch (err) {
    logApiError({
      api: 'Settings API',
      method: 'GET',
      error: `déchiffrement local de ${row.key} impossible : ${err.message}`,
      response: { key: row.key, site_id: row.site_id, extension_id: row.extension_id, environment: row.environment },
    });
    return { ...row, value: null, error: `Déchiffrement de ${row.key} impossible : ${err.message}` };
  }
}

// Whether the Settings API can decrypt (decrypt=1). Remembered for a while once it failed, so that every read
// does not try it again before falling back on the raw values.
let apiDecryptsUntil = 0;
const DECRYPT_RETRY_MS = 5 * 60 * 1000;

async function list(params, decrypt, { path = '', handled } = {}) {
  if (!decrypt || Date.now() < apiDecryptsUntil) return request('GET', path, params, undefined, { handled });
  try {
    return await request('GET', path, { ...params, decrypt: '1' }, undefined, {
      handled: (status, data) => isDecryptFailure(status, data) || Boolean(handled?.(status, data)),
    });
  } catch (err) {
    // The Settings API cannot decrypt (no SETTINGS_ENCRYPTION_KEY there): read the raw values, decrypted locally.
    if (!/encryption|decrypt|\(500\)/i.test(err.message)) throw err;
    apiDecryptsUntil = Date.now() + DECRYPT_RETRY_MS;
    return request('GET', path, params, undefined, { handled });
  }
}

/**
 * Short-lived cache of the Settings API reads, per serverless instance, for the working calls (order, sending).
 * The settings screen and the SMTP test always read fresh values; any write clears it.
 */
const CACHE_TTL_MS = Number(process.env.SETTINGS_CACHE_TTL_MS ?? 30_000);
const cache = new Map();

export function clearSettingsCache() {
  cache.clear();
  apiDecryptsUntil = 0;
}

/** One call per environment and site ("this site", "", "*"): the extension levels are filtered here. */
async function listSite(environment, siteId, decrypt, fresh) {
  const key = `${environment}|${siteId}|${decrypt ? 1 : 0}`;
  const hit = cache.get(key);
  if (!fresh && hit && hit.expires > Date.now()) return hit.rows;
  const rows = (await list({ site_id: siteId, environment, limit: '5000' }, decrypt)).settings || [];
  if (CACHE_TTL_MS > 0) cache.set(key, { rows, expires: Date.now() + CACHE_TTL_MS });
  return rows;
}

async function fetchRows(scope, decrypt, { fresh = false } = {}) {
  const order = lookupOrder(scope);
  const calls = [...new Set(order.map((w) => `${w.environment}|${w.site_id}`))];
  const lists = await Promise.all(
    calls.map((call) => {
      const [environment, siteId] = call.split('|');
      return listSite(environment, siteId, decrypt, fresh);
    }),
  );
  const bySite = Object.fromEntries(calls.map((call, i) => [call, lists[i]]));
  return order.map((where) => ({
    where,
    rows: bySite[`${where.environment}|${where.site_id}`]
      .filter((s) => s.site_id === where.site_id && s.extension_id === where.extension_id)
      .map((row) => ({ ...row, environment: row.environment || where.environment }))
      .map((row) => (decrypt ? decryptRow(row) : row)),
  }));
}

/**
 * OneStock token of the back office (parent_url of the context) and API root to call with it:
 * GET /api/settings/token?parent_url=…  → { token, api_root } (404: no token entered for this parent_url).
 * Cached with the parent_url in the key; encrypted values are decrypted like the other secrets.
 */
async function fetchOnestockToken(scope, decrypt, { fresh = false } = {}) {
  const key = `token|${scope.parentUrl}|${scope.contextApiUrl}|${scope.siteId}|${decrypt ? 1 : 0}`;
  const hit = cache.get(key);
  if (!fresh && hit && hit.expires > Date.now()) return hit.rows;
  const params = { parent_url: scope.parentUrl };
  if (scope.contextApiUrl) params.api_url = scope.contextApiUrl;
  if (scope.siteId) params.site_id = scope.siteId;
  const notFound = (status) => status === 404;
  let data;
  try {
    data = await list(params, decrypt, { path: '/token', handled: notFound });
  } catch (err) {
    if (!/\(404\)/.test(err.message)) throw err;
    data = { token: null, missing: true };
  }
  let result = {
    parent_url: data.parent_url || scope.parentUrl,
    api_root: data.api_root || '',
    token: data.token ?? null,
    set: !data.missing,
    updated_at: data.updated_at,
  };
  if (decrypt && result.set) {
    const row = decryptRow({ key: 'onestock_token', value: result.token, decrypt_error: data.decrypt_error, site_id: '', extension_id: '*', environment: result.parent_url });
    result = { ...result, token: row.value, error: row.error };
    if (!result.token && !result.error) result.error = `Token OneStock de ${result.parent_url} non déchiffré`;
  }
  if (CACHE_TTL_MS > 0) cache.set(key, { rows: result, expires: Date.now() + CACHE_TTL_MS });
  return result;
}

/** With a parent_url, onestock_token and onestock_api_root come from the token of this back office. */
function applyToken(settings, credentials) {
  if (!credentials) return settings;
  const source = { parent_url: credentials.parent_url };
  const out = {
    ...settings,
    onestock_token: {
      ...settings.onestock_token,
      value: credentials.token ?? '',
      set: credentials.set,
      provided: true,
      source: credentials.set ? source : null,
      ...(credentials.error ? { error: credentials.error } : {}),
      ...(!credentials.set ? { error: `Aucun token OneStock pour ${credentials.parent_url} : le saisir dans l'application Extensions (Settings généraux → Token OneStock)` } : {}),
    },
  };
  if (credentials.api_root) {
    out.onestock_api_root = { ...settings.onestock_api_root, value: credentials.api_root, set: true, provided: true, source };
  }
  return out;
}

function resolve(levels) {
  const result = {};
  for (const [key, def] of Object.entries(SETTING_KEYS)) {
    let found = null;
    for (const level of levels) {
      const row = level.rows.find((s) => s.key === key);
      // An empty value counts as "not set" so that a more global value applies.
      if (row && row.value !== '' && (def.secret || row.value !== null)) {
        found = row;
        break;
      }
    }
    result[key] = {
      value: found ? (found.value ?? '') : (def.default ?? ''),
      set: Boolean(found),
      secret: Boolean(def.secret),
      general: Boolean(def.general),
      provided: Boolean(def.provided),
      source: found ? { site_id: found.site_id, extension_id: found.extension_id, environment: found.environment } : null,
      ...(found?.error ? { error: found.error } : {}),
    };
  }
  return result;
}

/**
 * Reads every app setting for the scope. Returns, per key, the value (secrets only when `decrypt`),
 * whether it is set, and where it comes from (null = default value).
 */
export async function readSettings(scope, { decrypt = false, fresh = false } = {}) {
  const [levels, credentials] = await Promise.all([
    fetchRows(scope, decrypt, { fresh }),
    scope.parentUrl ? fetchOnestockToken(scope, decrypt, { fresh }) : null,
  ]);
  return applyToken(resolve(levels), credentials);
}

function createRows(scope, entries) {
  return request(
    'POST',
    '',
    undefined,
    entries.map(({ key, value }) => ({ key, value, ...targetOf(scope, key), environment: scope.environment })),
    { handled: isAlreadyExisting },
  );
}

/**
 * First connection: creates, at their target level, the keys that exist at no level yet (in the current nor in
 * the fallback environment, whose values would otherwise be hidden by the defaults), with their default
 * value (onestock_api_root takes the API URL of the context, empty defaults are created too so that every key
 * is visible in the Extensions app). Secrets are not created without a value. Returns the created keys.
 */
async function initialize(scope, levels) {
  const existing = new Set(levels.flatMap((level) => level.rows.map((row) => row.key)));
  const initial = { onestock_api_root: scope.contextApiUrl };
  // With a parent_url, the API root comes with the token of the back office: nothing to create for it.
  if (scope.parentUrl) existing.add('onestock_api_root');
  const missing = Object.entries(SETTING_KEYS)
    .filter(([key, def]) => !existing.has(key) && !def.secret && !def.provided)
    .map(([key, def]) => ({ key, value: initial[key] ?? def.default ?? '' }));
  if (!missing.length) return [];
  clearSettingsCache();
  try {
    await createRows(scope, missing);
  } catch (err) {
    if (!/already_exists/.test(err.message)) throw err;
    // Another call created some of them meanwhile: the batch stopped there, create the others one by one.
    for (const entry of missing) {
      await createRows(scope, [entry]).catch((e) => {
        if (!/already_exists/.test(e.message)) throw e;
      });
    }
  }
  return missing.map(({ key }) => key);
}

/** Reads the settings of the scope, initialising the missing keys on the first connection. */
export async function readOrInitializeSettings(scope, { decrypt = false, fresh = false } = {}) {
  const tokenRead = scope.parentUrl ? fetchOnestockToken(scope, decrypt, { fresh }) : Promise.resolve(null);
  let levels = await fetchRows(scope, decrypt, { fresh });
  const created = await initialize(scope, levels);
  if (created.length) levels = await fetchRows(scope, decrypt, { fresh: true });
  return { created, settings: applyToken(resolve(levels), await tokenRead) };
}

/** Settings shown in the browser: secret values are replaced by "" (their `set` flag stays). */
export function publicSettings(settings) {
  return Object.fromEntries(Object.entries(settings).map(([key, s]) => [key, s.secret ? { ...s, value: '' } : s]));
}

/**
 * Writes values (upsert), each key at its target level. Unknown and provided keys are ignored,
 * an empty secret means "keep the stored value".
 */
export async function writeSettings(scope, values) {
  const entries = Object.entries(values || {}).filter(
    ([key, value]) =>
      key in SETTING_KEYS &&
      !SETTING_KEYS[key].provided &&
      value !== null &&
      value !== undefined &&
      !(SETTING_KEYS[key].secret && value === ''),
  );
  if (entries.length) clearSettingsCache();
  for (const [key, value] of entries) {
    await request('PUT', '/item', { key, ...targetOf(scope, key), environment: scope.environment, upsert: '1' }, {
      value: String(value),
    });
  }
  return entries.map(([key]) => key);
}

/** Nested runtime configuration used by the OneStock client and the mailer. */
export function runtimeConfig(settings, scope) {
  const v = (key) => settings[key]?.value ?? '';
  return {
    onestock: {
      token: v('onestock_token'),
      token_error: settings.onestock_token?.error,
      api_root: v('onestock_api_root'),
      environment: scope.environment,
    },
    smtp: {
      host: v('smtp_host'),
      port: Number(v('smtp_port')) || 587,
      secure: v('smtp_secure') === 'true',
      user: v('smtp_user'),
      password: v('smtp_password'),
      password_error: settings.smtp_password?.error,
      from: v('smtp_from'),
      bcc: v('smtp_bcc'),
    },
    email: { subject: v('email_subject'), body: v('email_body') },
  };
}

export async function loadRuntimeConfig(input, { fresh = false } = {}) {
  const scope = scopeOf(input);
  return { scope, config: runtimeConfig(await readSettings(scope, { decrypt: true, fresh }), scope) };
}
