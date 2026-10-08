export class OnestockError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const ORDER_FIELDS = ['id', 'state', 'date', 'information', 'customer', 'pricing_details'];

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Base URL of the OneStock API, version included.
 * Priority: URL forced in settings > api_url received from the extension context > URL built from the site id.
 */
export function apiBaseUrl(settings, { apiUrl, siteId }) {
  const { api_url, environment, api_version } = settings.onestock;
  let base = api_url || apiUrl;
  if (!base) {
    if (!siteId) throw new OnestockError("site_id manquant pour construire l'URL de l'API", 400);
    const host =
      environment === 'production' ? 'api.onestock-retail.com' : `api.${environment || 'qualif'}.onestock-retail.com`;
    base = `https://${siteId}.${host}`;
  }
  return `${base.replace(/\/+$/, '')}/${api_version || 'v3'}`;
}

async function call(method, url, body) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  let httpMethod = method;
  // OneStock GET routes take a JSON body: POST + X-HTTP-Method-Override is the documented transport.
  if (method === 'GET') {
    httpMethod = 'POST';
    headers['X-HTTP-Method-Override'] = 'GET';
  }
  const res = await fetch(url, { method: httpMethod, headers, body: JSON.stringify(body) });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, ok: res.ok, data };
}

// Kept while the serverless instance is warm, to avoid a /login on every call.
const tokenCache = new Map();

async function getToken(settings, ctx, { refresh = false } = {}) {
  const { auth_mode, token, user_id, password } = settings.onestock;
  if (auth_mode !== 'credentials') {
    if (!token) throw new OnestockError('Aucun token OneStock configuré (onglet Paramètres)', 400);
    return token;
  }
  if (!user_id || !password) throw new OnestockError('Identifiants OneStock incomplets (onglet Paramètres)', 400);
  const base = apiBaseUrl(settings, ctx);
  const key = `${base}|${ctx.siteId}|${user_id}`;
  if (!refresh && tokenCache.has(key)) return tokenCache.get(key);
  const res = await call('POST', `${base}/login`, { site_id: ctx.siteId, user_id, password });
  if (!res.ok || !res.data.token) {
    throw new OnestockError("Échec de l'authentification OneStock (/login)", res.status || 401, res.data);
  }
  tokenCache.set(key, res.data.token);
  return res.data.token;
}

/**
 * Forwards a call to the OneStock API, adding `site_id` and the token to the body.
 * Returns `{ status, ok, data }` as received from OneStock.
 */
export async function proxyRequest(settings, ctx, { method = 'GET', path, body = {} }) {
  method = String(method).toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new OnestockError(`Méthode ${method} non supportée`, 400);
  if (!ctx.siteId) throw new OnestockError('site_id manquant', 400);
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('..') || path.includes('://')) {
    throw new OnestockError('Chemin OneStock invalide', 400);
  }
  if (path === '/login') throw new OnestockError('Route /login non exposée par le proxy', 400);

  const url = `${apiBaseUrl(settings, ctx)}${path}`;
  const payload = { ...body, site_id: ctx.siteId };
  let res = await call(method, url, { ...payload, token: await getToken(settings, ctx) });
  if (res.status === 401 && settings.onestock.auth_mode === 'credentials') {
    res = await call(method, url, { ...payload, token: await getToken(settings, ctx, { refresh: true }) });
  }
  return res;
}

export async function getOrder(settings, { orderId, siteId, apiUrl, lang }) {
  if (!orderId) throw new OnestockError('order_id manquant', 400);
  const res = await proxyRequest(
    settings,
    { siteId, apiUrl },
    {
      method: 'GET',
      path: `/orders/${encodeURIComponent(orderId)}`,
      body: { fields: ORDER_FIELDS, item_features_lang: lang || 'fr' },
    },
  );
  if (!res.ok) {
    const message = res.status === 404 ? `Commande ${orderId} introuvable` : `Erreur API OneStock (${res.status})`;
    throw new OnestockError(message, res.status, res.data);
  }
  return res.data;
}
