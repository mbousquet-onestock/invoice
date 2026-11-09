/**
 * Application settings, stored in the "Settings" API of the Extensions app (Postgres on Vercel).
 * A setting is identified by key + site_id ("" = all sites) + extension_id ("*" = all extensions) + environment.
 * The app links its settings to the site and the OneStock API URL of the context: environment = origin of the
 * API URL (e.g. https://api-qualif.onestock-retail.com).
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
 * `account` keys are the OneStock API account, entered in the Extensions app (or, as a backup, in the settings screen
 * of this app), used to get a token with POST /login.
 */
export const SETTING_KEYS = {
  onestock_user_id: { account: true },
  onestock_password: { secret: true, account: true },
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

/** OneStock environment name (qualif, prod…): explicit value, else deduced from the API URL of the context. */
export function environmentOf({ environment, apiUrl: contextApiUrl } = {}) {
  if (environment) return environment;
  try {
    const host = new URL(contextApiUrl).hostname;
    // c00.api.qualif.onestock-retail.com, api-qualif.onestock-retail.com, d01.api.dev.onestock-retail.dev…
    const match =
      host.match(/(?:^|[.-])(qualif|dev|training|preprod|staging)(?=[.-])/) ||
      host.match(/\.api\.([a-z0-9-]+)\.onestock-retail\.(com|dev)$/);
    return match ? match[1] : 'prod';
  } catch {
    return process.env.SETTINGS_ENVIRONMENT || 'qualif';
  }
}

function originOf(url) {
  try {
    return url ? new URL(url).origin : '';
  } catch {
    return '';
  }
}

/**
 * Where settings are read and written: the context of the extension. `environment` (the Settings API field) is
 * the origin of the OneStock API URL of the context, else the URL built from the site
 * (https://{site}.api.{qualif.}onestock-retail.com), else the environment name.
 */
export function scopeOf(input = {}) {
  const siteId = String(input.site_id || '').trim();
  const contextApiUrl = String(input.api_url || '').trim();
  const envName = environmentOf({ environment: input.environment, apiUrl: contextApiUrl });
  const built = siteId
    ? `https://${siteId}.api.${['prod', 'production'].includes(envName) ? '' : `${envName}.`}onestock-retail.com`
    : '';
  const apiOrigin = originOf(contextApiUrl) || built;
  return {
    siteId,
    extensionId: String(input.extension_id || '').trim() || process.env.EXTENSION_ID || 'invoice',
    envName,
    apiOrigin,
    environment: apiOrigin || envName,
    contextApiUrl,
  };
}

/** Where a key is written: this site, and "*" for general and account keys or this extension otherwise. */
export function targetOf(scope, key) {
  const def = SETTING_KEYS[key];
  return {
    site_id: scope.siteId,
    extension_id: def?.general || def?.account ? GLOBAL_EXTENSION : scope.extensionId,
  };
}

/**
 * Values entered when the extension is installed from the OneStock Hub, before any site / API URL is known
 * (they come from the context of the iframe): kept for the installation (site_id "", environment below, extension
 * of the callback), then copied for a site and its API URL the first time the extension opens there.
 */
export const INSTALL_ENVIRONMENT = 'hub-install';

/** Saves the values of an installation (Hub callback without site / API URL). */
export async function saveInstallValues(extensionId, values) {
  const entries = Object.entries(values || {}).filter(
    ([key, value]) => key in SETTING_KEYS && value !== null && value !== undefined && !(SETTING_KEYS[key].secret && value === ''),
  );
  if (entries.length) clearSettingsCache();
  for (const [key, value] of entries) {
    await request(
      'PUT',
      '/item',
      { key, site_id: '', extension_id: extensionId, environment: INSTALL_ENVIRONMENT, upsert: '1' },
      { value: String(value) },
    );
  }
  return entries.map(([key]) => key);
}

/** Values of site_id meaning "all sites" (the Extensions app uses both). */
export const GLOBAL_SITES = ['', '*'];

/**
 * Environments read: the API URL of the context (where this app writes), then the environment name (qualif,
 * prod…) used by the Extensions app for the values entered there (e.g. the API account).
 */
export function environmentsOf(scope) {
  return [...new Set([scope.environment, scope.envName].filter(Boolean))];
}

/**
 * Lookup order: for each environment, this site + this extension, this site + all extensions, then the same for
 * all sites (site_id "" then "*").
 */
function lookupOrder(scope) {
  const { siteId, extensionId } = scope;
  const sites = siteId && !GLOBAL_SITES.includes(siteId) ? [siteId, ...GLOBAL_SITES] : GLOBAL_SITES;
  const extensions = extensionId === GLOBAL_EXTENSION ? [GLOBAL_EXTENSION] : [extensionId, GLOBAL_EXTENSION];
  const order = [];
  for (const environment of environmentsOf(scope)) {
    for (const site of sites) {
      for (const extension of extensions) order.push({ site_id: site, extension_id: extension, environment });
    }
  }
  return order;
}

/** Where the API account is looked for, for the messages. */
export function accountLookup(scope) {
  const sites = [scope.siteId || null, 'tous les sites'].filter(Boolean).join(' puis ');
  return `clés onestock_user_id / onestock_password, site ${sites}, extension ${scope.extensionId} ou *, environment ${environmentsOf(scope).join(' puis ')}`;
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

function resolve(levels, scope) {
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
      ...(def.account ? { account: true, api_origin: scope.apiOrigin, lookup: accountLookup(scope) } : {}),
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
  return resolve(await fetchRows(scope, decrypt, { fresh }), scope);
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
 * First connection: creates, at their target level, the keys that exist at no level yet, with their default value
 * (onestock_api_root takes the API URL of the context, empty defaults are created too so that every key is visible
 * in the Extensions app). Secrets and the API account are not created without a value. Returns the created keys.
 */
async function initialize(scope, levels) {
  const existing = new Set(levels.flatMap((level) => level.rows.map((row) => row.key)));
  const initial = { onestock_api_root: scope.contextApiUrl };
  const missing = Object.entries(SETTING_KEYS)
    .filter(([key, def]) => !existing.has(key) && !def.secret && !def.account)
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

/** Values of the installation of this extension (decrypted: they are copied, never sent to the browser). */
async function fetchInstall(scope, fresh) {
  const rows = await listSite(INSTALL_ENVIRONMENT, '', true, fresh);
  return rows
    .filter((row) => row.site_id === '' && row.extension_id === scope.extensionId && row.key in SETTING_KEYS)
    .map(decryptRow)
    .filter((row) => row.value !== null && row.value !== '' && !row.error);
}

/**
 * First opening on a site: copies, for the site and API URL of the context, the values of the installation they do
 * not have yet (at no level; for the API account: none for this site). Returns the copied keys.
 */
async function applyInstall(scope, levels, installRows) {
  if (!scope.siteId || !installRows.length) return [];
  const existing = new Set(levels.flatMap((level) => level.rows.map((row) => row.key)));
  const settings = resolve(levels, scope);
  const values = {};
  for (const row of installRows) {
    const missing = SETTING_KEYS[row.key].account ? !settings[row.key].set : !existing.has(row.key);
    if (missing) values[row.key] = row.value;
  }
  return Object.keys(values).length ? writeSettings(scope, values) : [];
}

/**
 * Reads the settings of the scope. On the first opening for a site and API URL, copies the values entered at
 * install, then creates the missing keys with their default value.
 */
export async function readOrInitializeSettings(scope, { decrypt = false, fresh = false } = {}) {
  const [firstLevels, installRows] = await Promise.all([
    fetchRows(scope, decrypt, { fresh }),
    scope.siteId ? fetchInstall(scope, fresh) : [],
  ]);
  let levels = firstLevels;
  const fromInstall = await applyInstall(scope, levels, installRows);
  if (fromInstall.length) levels = await fetchRows(scope, decrypt, { fresh: true });
  const created = await initialize(scope, levels);
  if (created.length) levels = await fetchRows(scope, decrypt, { fresh: true });
  return { created, from_install: fromInstall, settings: resolve(levels, scope) };
}

/** Settings shown in the browser: secret values are replaced by "" (their `set` flag stays). */
export function publicSettings(settings) {
  return Object.fromEntries(Object.entries(settings).map(([key, s]) => [key, s.secret ? { ...s, value: '' } : s]));
}

/**
 * Writes values (upsert) for the site and API URL of the scope, each key at its extension level. Unknown keys are
 * ignored, an empty secret means "keep the stored value"; `account: false` ignores the API account.
 */
export async function writeSettings(scope, values, { account = true } = {}) {
  const entries = Object.entries(values || {}).filter(
    ([key, value]) =>
      key in SETTING_KEYS &&
      (account || !SETTING_KEYS[key].account) &&
      value !== null &&
      value !== undefined &&
      !(SETTING_KEYS[key].secret && value === ''),
  );
  if (entries.some(([key]) => SETTING_KEYS[key].account) && (!scope.siteId || !scope.apiOrigin)) {
    throw new SettingsError("Site et URL d'API nécessaires pour enregistrer le compte OneStock", 400);
  }
  if (entries.length) clearSettingsCache();
  for (const [key, value] of entries) {
    await request(
      'PUT',
      '/item',
      { key, ...targetOf(scope, key), environment: scope.environment, upsert: '1' },
      { value: String(value) },
    );
  }
  return entries.map(([key]) => key);
}

/** Nested runtime configuration used by the OneStock client and the mailer. */
export function runtimeConfig(settings, scope) {
  const v = (key) => settings[key]?.value ?? '';
  return {
    onestock: {
      user_id: v('onestock_user_id'),
      password: v('onestock_password'),
      password_error: settings.onestock_password?.error,
      api_origin: scope.apiOrigin,
      lookup: settings.onestock_user_id?.lookup,
      api_root: v('onestock_api_root'),
      environment: scope.envName,
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
