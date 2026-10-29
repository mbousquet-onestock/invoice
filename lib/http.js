import { OnestockError } from './onestock.js';
import { MailError } from './mailer.js';
import { SettingsError } from './settings.js';
import { logApiError } from './log.js';

/** Vercel parses JSON bodies; the Vite dev middleware sets req.body the same way. */
export function readBody(req) {
  const body = req.body;
  if (typeof body === 'string') return body ? JSON.parse(body) : {};
  return body || {};
}

export function readQuery(req) {
  return Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
}

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

/** Error response of one of our /api routes, logged with the route and the (masked) request body. */
export function sendError(res, err, req) {
  const known =
    err instanceof OnestockError || err instanceof MailError || err instanceof SettingsError || err instanceof MethodError;
  const status = known ? err.status || 400 : 500;
  if (!known) console.error(err);
  logApiError({
    api: 'Extension',
    method: req?.method,
    url: req?.url && `http://extension${req.url}`,
    status,
    startedAt: req?.startedAt,
    error: err.message,
    request: req?.body,
  });
  sendJson(res, status, { error: known ? err.message : `Erreur interne : ${err.message}`, details: err.details });
}

class MethodError extends Error {
  constructor() {
    super('Méthode non autorisée');
  }
}

/** Builds a handler from `{ METHOD: (req) => payload }`, with uniform error responses. */
export function methods(routes) {
  return async function handler(req, res) {
    req.startedAt = Date.now();
    const route = routes[req.method];
    if (!route) return sendError(res, Object.assign(new MethodError(), { status: 405 }), req);
    try {
      sendJson(res, 200, await route(req));
    } catch (err) {
      sendError(res, err, req);
    }
  };
}
