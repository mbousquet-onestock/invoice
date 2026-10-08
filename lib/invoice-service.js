import { getOrder } from './onestock.js';
import { invoiceUrls } from './order.js';
import { downloadInvoice, sendInvoiceMail, MailError } from './mailer.js';
import { loadRuntimeConfig } from './settings.js';

export async function sendInvoice(body) {
  const context = body.context || {};
  const { scope, config } = await loadRuntimeConfig(context);
  const to = String(body.to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new MailError('Adresse email destinataire invalide');

  // Invoice URLs are read again from OneStock: the browser only picks among the order's own invoices.
  const order = await getOrder(config, {
    orderId: String(body.order_id || '').trim(),
    siteId: scope.siteId,
    apiUrl: String(context.api_url || '').trim(),
    lang: context.lang,
  });
  const orderId = order.id || body.order_id;
  const available = invoiceUrls(order);
  const wanted = Array.isArray(body.invoices) ? body.invoices : available;
  const urls = available.filter((url) => wanted.includes(url));
  if (!urls.length) throw new MailError('Aucune facture (information.invoice) à envoyer pour cette commande', 404);

  const attachments = await Promise.all(
    urls.map((url, i) => downloadInvoice(url, `facture-${orderId}${urls.length > 1 ? `-${i + 1}` : ''}.pdf`)),
  );
  const result = await sendInvoiceMail(config.smtp, {
    to,
    subject: String(body.subject || '').trim() || `Facture ${orderId}`,
    text: String(body.body || ''),
    attachments,
  });
  return { ok: true, ...result, files: attachments.map((a) => a.filename) };
}

