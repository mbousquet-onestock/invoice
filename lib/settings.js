/**
 * Application settings, stored in the "Settings" API of the Extensions app (Postgres on Vercel).
 * A setting is identified by key + site_id ("" = all sites) + extension_id ("*" = all extensions) + environment.
 * This module runs server side only: the API key and decrypted secrets never reach the browser.
 */

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
 */
export const SETTING_KEYS = {
  onestock_token: { secret: true, general: true },
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

async function request(method, path, params, body) {
  const query = params ? `?${new URLSearchParams(params)}` : '';
  const headers = { Authorization: `Bearer ${apiKey()}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${apiUrl()}${path}${query}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new SettingsError(`API Settings injoignable : ${err.message}`, 502);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new SettingsError(`API Settings (${res.status}) : ${data.error || 'erreur inconnue'}`, 502);
  return data;
}

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
  };
}

/** Where a key is written: this site, and "*" for general keys or this extension otherwise. */
export function targetOf(scope, key) {
  return {
    site_id: scope.siteId,
    extension_id: SETTING_KEYS[key]?.general ? GLOBAL_EXTENSION : scope.extensionId,
  };
}

/** Lookup order: this site + this extension, this site + all extensions, all sites + this extension, global. */
function lookupOrder({ siteId, extensionId }) {
  const sites = siteId ? [siteId, ''] : [''];
  const extensions = extensionId === GLOBAL_EXTENSION ? [GLOBAL_EXTENSION] : [extensionId, GLOBAL_EXTENSION];
  const order = [];
  for (const site of sites) for (const extension of extensions) order.push({ site_id: site, extension_id: extension });
  return order;
}

async function fetchRows(scope, decrypt) {
  const order = lookupOrder(scope);
  const lists = await Promise.all(
    order.map((where) =>
      request('GET', '', { ...where, environment: scope.environment, limit: '1000', ...(decrypt ? { decrypt: '1' } : {}) }),
    ),
  );
  return order.map((where, i) => ({
    where,
    rows: (lists[i].settings || []).filter((s) => s.site_id === where.site_id && s.extension_id === where.extension_id),
  }));
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
      source: found ? { site_id: found.site_id, extension_id: found.extension_id } : null,
    };
  }
  return result;
}

/**
 * Reads every app setting for the scope. Returns, per key, the value (secrets only when `decrypt`),
 * whether it is set, and where it comes from (null = default value).
 */
export async function readSettings(scope, { decrypt = false } = {}) {
  return resolve(await fetchRows(scope, decrypt));
}

function createRows(scope, entries) {
  return request(
    'POST',
    '',
    undefined,
    entries.map(({ key, value }) => ({ key, value, ...targetOf(scope, key), environment: scope.environment })),
  );
}

/**
 * First connection: creates, at their target level, the keys that exist at no level yet, with their default
 * value (onestock_api_root takes the API URL of the context, empty defaults are created too so that every key
 * is visible in the Extensions app). Secrets are not created without a value. Returns the created keys.
 */
async function initialize(scope, levels) {
  const existing = new Set(levels.flatMap((level) => level.rows.map((row) => row.key)));
  const initial = { onestock_api_root: scope.contextApiUrl };
  const missing = Object.entries(SETTING_KEYS)
    .filter(([key, def]) => !existing.has(key) && !def.secret)
    .map(([key, def]) => ({ key, value: initial[key] ?? def.default ?? '' }));
  if (!missing.length) return [];
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
export async function readOrInitializeSettings(scope) {
  let levels = await fetchRows(scope, false);
  const created = await initialize(scope, levels);
  if (created.length) levels = await fetchRows(scope, false);
  return { created, settings: resolve(levels) };
}

/** Settings shown in the browser: secret values are replaced by "" (their `set` flag stays). */
export function publicSettings(settings) {
  return Object.fromEntries(Object.entries(settings).map(([key, s]) => [key, s.secret ? { ...s, value: '' } : s]));
}

/**
 * Writes values (upsert), each key at its target level. Unknown keys are ignored,
 * an empty secret means "keep the stored value".
 */
export async function writeSettings(scope, values) {
  const entries = Object.entries(values || {}).filter(
    ([key, value]) =>
      key in SETTING_KEYS && value !== null && value !== undefined && !(SETTING_KEYS[key].secret && value === ''),
  );
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
    onestock: { token: v('onestock_token'), api_root: v('onestock_api_root'), environment: scope.environment },
    smtp: {
      host: v('smtp_host'),
      port: Number(v('smtp_port')) || 587,
      secure: v('smtp_secure') === 'true',
      user: v('smtp_user'),
      password: v('smtp_password'),
      from: v('smtp_from'),
      bcc: v('smtp_bcc'),
    },
    email: { subject: v('email_subject'), body: v('email_body') },
  };
}

export async function loadRuntimeConfig(input) {
  const scope = scopeOf(input);
  return { scope, config: runtimeConfig(await readSettings(scope, { decrypt: true }), scope) };
}
