import { OnestockError } from './onestock.js';
import { MailError } from './mailer.js';
import { SettingsError } from './settings.js';

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

export function sendError(res, err) {
  const known = err instanceof OnestockError || err instanceof MailError || err instanceof SettingsError;
  if (!known) console.error(err);
  sendJson(res, known ? err.status || 400 : 500, {
    error: known ? err.message : `Erreur interne : ${err.message}`,
    details: err.details,
  });
}

/** Builds a handler from `{ METHOD: (req) => payload }`, with uniform error responses. */
export function methods(routes) {
  return async function handler(req, res) {
    const route = routes[req.method];
    if (!route) return sendJson(res, 405, { error: 'Méthode non autorisée' });
    try {
      sendJson(res, 200, await route(req));
    } catch (err) {
      sendError(res, err);
    }
  };
}
