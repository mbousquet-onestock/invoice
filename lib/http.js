import { OnestockError } from './onestock.js';
import { MailError } from './mailer.js';

/** Vercel parses JSON bodies; the Vite dev middleware sets req.body the same way. */
export function readBody(req) {
  const body = req.body;
  if (typeof body === 'string') return body ? JSON.parse(body) : {};
  return body || {};
}

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

/** Wraps a `(body) => payload` function into a POST-only handler with uniform error responses. */
export function postHandler(fn) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Méthode non autorisée' });
    try {
      sendJson(res, 200, await fn(readBody(req)));
    } catch (err) {
      const known = err instanceof OnestockError || err instanceof MailError;
      if (!known) console.error(err);
      sendJson(res, known ? err.status || 400 : 500, {
        error: known ? err.message : `Erreur interne : ${err.message}`,
        details: err.details,
      });
    }
  };
}
