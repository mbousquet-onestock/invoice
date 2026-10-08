import { readBody, sendJson } from '../lib/http.js';
import { proxyRequest, OnestockError } from '../lib/onestock.js';
import { withDefaults } from '../lib/settings.js';

/**
 * Generic proxy to the OneStock API (UI Extensibility recommendation):
 * POST /api/onestock-proxy { method, path, body, site_id, api_url, settings }
 * The OneStock status and body are relayed as is.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Méthode non autorisée' });
  try {
    const input = readBody(req);
    const settings = withDefaults(input.settings);
    const ctx = {
      siteId: String(input.site_id || '').trim() || settings.onestock.default_site_id,
      apiUrl: String(input.api_url || '').trim(),
    };
    const result = await proxyRequest(settings, ctx, { method: input.method, path: input.path, body: input.body });
    sendJson(res, result.status, result.data);
  } catch (err) {
    const known = err instanceof OnestockError;
    if (!known) console.error(err);
    sendJson(res, known ? err.status || 400 : 502, { error: err.message, details: err.details });
  }
}
