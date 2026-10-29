import nodemailer from 'nodemailer';
import path from 'node:path';
import { logApiError } from './log.js';

export class MailError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function filenameFrom(res, url, fallback) {
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (match) return decodeURIComponent(match[1]);
  try {
    const base = path.basename(new URL(url).pathname);
    if (base && base.includes('.')) return base;
  } catch {
    /* ignore */
  }
  return fallback;
}

export async function downloadInvoice(url, fallbackName) {
  const startedAt = Date.now();
  let res;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch (err) {
    logApiError({ api: 'Facture', method: 'GET', url, startedAt, error: err.message });
    throw new MailError(`Impossible de télécharger la facture : ${err.message}`, 502);
  }
  if (!res.ok) {
    const response = await res.text().catch(() => '');
    logApiError({ api: 'Facture', method: 'GET', url, startedAt, status: res.status, response, error: res.statusText });
    throw new MailError(`Téléchargement de la facture en échec (HTTP ${res.status})`, 502);
  }
  const contentType = res.headers.get('content-type') || 'application/pdf';
  return {
    filename: filenameFrom(res, url, fallbackName),
    content: Buffer.from(await res.arrayBuffer()),
    contentType: contentType.split(';')[0],
  };
}

/** Ports whose TLS mode is fixed: 465 = implicit TLS, the others start in clear text and upgrade with STARTTLS. */
const IMPLICIT_TLS_PORTS = [465];
const STARTTLS_PORTS = [25, 587, 2525];

/**
 * Port and TLS mode. A direct TLS connection on a STARTTLS port fails with
 * "ssl3_get_record:wrong version number", so the mode follows the port when it is a standard one;
 * smtp_secure only decides for other ports.
 */
export function connectionOf(smtp) {
  const port = Number(smtp.port) || 587;
  if (IMPLICIT_TLS_PORTS.includes(port)) return { port, secure: true };
  if (STARTTLS_PORTS.includes(port)) return { port, secure: false };
  return { port, secure: Boolean(smtp.secure) };
}

function transportOf(smtp) {
  return nodemailer.createTransport({
    host: smtp.host,
    ...connectionOf(smtp),
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
  });
}

/** SMTP failures, logged with the connection used (never the password). */
function logSmtpError(smtp, method, startedAt, err, request) {
  logApiError({
    api: 'SMTP',
    method,
    url: `smtp://${smtp.host}:${connectionOf(smtp).port}`,
    startedAt,
    status: err.responseCode,
    error: err.message,
    request: { ...connectionOf(smtp), user: smtp.user || undefined, ...request },
    response: err.response ? { code: err.code, command: err.command, response: err.response } : { code: err.code },
  });
}

/** The SMTP password is only needed with a user: its decryption error is reported only then. */
function checkPassword(smtp) {
  if (smtp.user && smtp.password_error) throw new MailError(smtp.password_error, 500);
}

export async function sendInvoiceMail(smtp, { to, subject, text, attachments }) {
  if (!smtp.host || !smtp.from) throw new MailError('Configuration SMTP incomplète (Paramètres)');
  checkPassword(smtp);
  const transport = transportOf(smtp);
  let info;
  const startedAt = Date.now();
  try {
    info = await transport.sendMail({
      from: smtp.from,
      to,
      bcc: smtp.bcc || undefined,
      subject,
      text,
      attachments,
    });
  } catch (err) {
    logSmtpError(smtp, 'SEND', startedAt, err, { from: smtp.from, to, subject, attachments: attachments?.map((a) => a.filename) });
    throw new MailError(`Envoi SMTP en échec : ${err.message}`, 502);
  }
  return { messageId: info.messageId, accepted: info.accepted };
}

export async function verifySmtp(smtp) {
  if (!smtp.host) throw new MailError('Hôte SMTP manquant');
  checkPassword(smtp);
  const transport = transportOf(smtp);
  const startedAt = Date.now();
  try {
    await transport.verify();
  } catch (err) {
    logSmtpError(smtp, 'VERIFY', startedAt, err);
    throw new MailError(`Connexion SMTP en échec : ${err.message}`, 502);
  }
}
