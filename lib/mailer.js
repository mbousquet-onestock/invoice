import nodemailer from 'nodemailer';
import path from 'node:path';

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
  let res;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch (err) {
    throw new MailError(`Impossible de télécharger la facture : ${err.message}`, 502);
  }
  if (!res.ok) throw new MailError(`Téléchargement de la facture en échec (HTTP ${res.status})`, 502);
  const contentType = res.headers.get('content-type') || 'application/pdf';
  return {
    filename: filenameFrom(res, url, fallbackName),
    content: Buffer.from(await res.arrayBuffer()),
    contentType: contentType.split(';')[0],
  };
}

/** The SMTP password is only needed with a user: its decryption error is reported only then. */
function checkPassword(smtp) {
  if (smtp.user && smtp.password_error) throw new MailError(smtp.password_error, 500);
}

export async function sendInvoiceMail(smtp, { to, subject, text, attachments }) {
  if (!smtp.host || !smtp.from) throw new MailError('Configuration SMTP incomplète (Paramètres)');
  checkPassword(smtp);
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: Boolean(smtp.secure),
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
  });
  let info;
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
    throw new MailError(`Envoi SMTP en échec : ${err.message}`, 502);
  }
  return { messageId: info.messageId, accepted: info.accepted };
}

export async function verifySmtp(smtp) {
  if (!smtp.host) throw new MailError('Hôte SMTP manquant');
  checkPassword(smtp);
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: Boolean(smtp.secure),
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
  });
  try {
    await transport.verify();
  } catch (err) {
    throw new MailError(`Connexion SMTP en échec : ${err.message}`, 502);
  }
}
