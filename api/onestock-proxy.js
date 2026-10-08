import { readBody, sendJson, sendError } from '../lib/http.js';
import { proxyRequest } from '../lib/onestock.js';
import { loadRuntimeConfig } from '../lib/settings.js';

/**
 * Generic proxy to the OneStock API (UI Extensibility recommendation):
 * POST /api/onestock-proxy { context: { site_id, extension_id, api_url }, method, path, body }
 * Credentials come from the Settings API; the OneStock status and body are relayed as is.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Méthode non autorisée' });
  try {
    const input = readBody(req);
    const context = input.context || {};
    const { scope, config } = await loadRuntimeConfig(context);
    const result = await proxyRequest(
      config,
      { siteId: scope.siteId, apiUrl: String(context.api_url || '').trim() },
      { method: input.method, path: input.path, body: input.body },
    );
    sendJson(res, result.status, result.data);
  } catch (err) {
    sendError(res, err);
  }
}
