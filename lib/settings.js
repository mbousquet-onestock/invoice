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

/** Keys used by the app. Keys containing token/password are encrypted by the Settings API. */
export const SETTING_KEYS = {
  onestock_auth_mode: { default: 'token' },
  onestock_token: { secret: true },
  onestock_user_id: {},
  onestock_password: { secret: true },
  onestock_api_url: {},
  onestock_api_version: { default: 'v3' },
  smtp_host: {},
  smtp_port: { default: '587' },
  smtp_secure: { default: 'false' },
  smtp_user: {},
  smtp_password: { secret: true },
  smtp_from: {},
  smtp_bcc: {},
  email_subject: { default: 'Votre facture pour la commande {{order_id}}' },
  email_body: {
    default:
      'Bonjour {{first_name}} {{last_name}},\n\n' +
      'Veuillez trouver ci-joint la facture de votre commande {{order_id}}.\n\n' +
      'Cordialement,\nLe service client',
  },
};

export const GLOBAL_EXTENSION = '*';

function apiUrl() {
  return (process.env.SETTINGS_API_URL || 'https://extensions-lemon.vercel.app/api/settings').replace(/\/+$/, '');
}

function apiKey() {
  const key = process.env.SETTINGS_API_KEY;
  if (!key) throw new SettingsError('SETTINGS_API_KEY non configurée dans les variables d\'environnement Vercel', 500);
  return key;
}

async function request(method, path, params, body) {
  const url = `${apiUrl()}${path}?${new URLSearchParams(params)}`;
  const headers = { Authorization: `Bearer ${apiKey()}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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
    const match = host.match(/\.api\.([a-z0-9-]+)\.onestock-retail\.(com|dev)$/) || host.match(/\.(qualif|dev|training|preprod|staging)\./);
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

/**
 * Reads every app setting for the scope. Returns, per key, the value (secrets only when `decrypt`),
 * whether it is set, and where it comes from (null = default value).
 */
export async function readSettings(scope, { decrypt = false } = {}) {
  const order = lookupOrder(scope);
  const lists = await Promise.all(
    order.map((where) =>
      request('GET', '', {
        ...where,
        environment: scope.environment,
        limit: '1000',
        ...(decrypt ? { decrypt: '1' } : {}),
      }),
    ),
  );
  const result = {};
  for (const [key, def] of Object.entries(SETTING_KEYS)) {
    let found = null;
    for (let i = 0; i < order.length && !found; i++) {
      const row = (lists[i].settings || []).find((s) => s.key === key && s.site_id === order[i].site_id);
      // An empty non-secret value counts as "not set" so that a more global value applies.
      if (row && (def.secret ? row.value !== '' : row.value !== null && row.value !== '')) found = row;
    }
    result[key] = {
      value: found ? (found.value ?? '') : (def.default ?? ''),
      set: Boolean(found),
      secret: Boolean(def.secret),
      source: found ? { site_id: found.site_id, extension_id: found.extension_id } : null,
    };
  }
  return result;
}

/** Settings shown in the browser: secret values are replaced by "" (their `set` flag stays). */
export function publicSettings(settings) {
  return Object.fromEntries(
    Object.entries(settings).map(([key, s]) => [key, s.secret ? { ...s, value: '' } : s]),
  );
}

/**
 * Writes values (upsert) at the target site / extension. Unknown keys are ignored,
 * an empty secret means "keep the stored value".
 */
export async function writeSettings(scope, target, values) {
  const where = {
    site_id: String(target?.site_id ?? scope.siteId),
    extension_id: String(target?.extension_id || scope.extensionId),
    environment: scope.environment,
  };
  const entries = Object.entries(values || {}).filter(
    ([key, value]) => key in SETTING_KEYS && value !== null && value !== undefined && !(SETTING_KEYS[key].secret && value === ''),
  );
  for (const [key, value] of entries) {
    await request('PUT', '/item', { key, ...where, upsert: '1' }, { value: String(value) });
  }
  return entries.map(([key]) => key);
}

/** Nested runtime configuration used by the OneStock client and the mailer. */
export function runtimeConfig(settings, scope) {
  const v = (key) => settings[key]?.value ?? '';
  return {
    onestock: {
      auth_mode: v('onestock_auth_mode'),
      token: v('onestock_token'),
      user_id: v('onestock_user_id'),
      password: v('onestock_password'),
      api_url: v('onestock_api_url'),
      api_version: v('onestock_api_version') || 'v3',
      environment: scope.environment,
    },
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
