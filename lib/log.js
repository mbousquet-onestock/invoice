/**
 * API error logs, written to the Vercel function logs (Project → Logs, filter "api_error").
 * Same content as the "Logs API" tab of the Extensions app: API, method, path, status, duration and bodies,
 * sensitive values replaced by ••••••••.
 */

export const MASK = '••••••••';

// Same rule as the Settings API for sensitive keys, plus the HTTP authentication headers.
const SENSITIVE = /token|secret|password|passwd|pass$|api_key|apikey|credential|authorization/i;
const MAX_BODY = 2000;

/** Deep copy with the values of sensitive keys masked (objects, arrays, JSON strings). */
export function mask(value, key = '') {
  if (key && SENSITIVE.test(key) && value !== null && value !== undefined && value !== '') return MASK;
  if (Array.isArray(value)) return value.map((v) => mask(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mask(v, k)]));
  }
  if (typeof value === 'string' && /^\s*[[{]/.test(value)) {
    try {
      return JSON.stringify(mask(JSON.parse(value)));
    } catch {
      /* not JSON */
    }
  }
  if (typeof value === 'string' && value.startsWith('enc:v1:')) return MASK;
  return value;
}

/** URL without credentials, with the sensitive query parameters masked. */
export function maskUrl(raw) {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    for (const [k] of url.searchParams) if (SENSITIVE.test(k)) url.searchParams.set(k, MASK);
    return url.toString().replaceAll(encodeURIComponent(MASK), MASK);
  } catch {
    return raw;
  }
}

function truncate(value) {
  if (value === undefined) return undefined;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}… (${text.length} caractères)` : value;
}

/**
 * Logs one failed API call. `status` is the HTTP status (absent for a network error), `error` the message.
 * `handled` marks an error the app recovers from (fallback, retry…), logged as a warning.
 */
export function logApiError({ api, method, url, status, startedAt, request, response, error, handled = false }) {
  const entry = {
    type: 'api_error',
    level: handled ? 'warn' : 'error',
    api,
    method,
    url: url && maskUrl(url),
    status: status ?? null,
    duration_ms: startedAt ? Date.now() - startedAt : undefined,
    error,
    handled: handled || undefined,
    request_body: truncate(mask(request)),
    response_body: truncate(mask(response)),
  };
  (handled ? console.warn : console.error)(JSON.stringify(entry));
  return entry;
}
