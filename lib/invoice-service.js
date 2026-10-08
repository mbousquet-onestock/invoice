import { getOrder } from './onestock.js';
import { invoiceUrls, billingContact } from './order.js';
import { downloadInvoice, sendInvoiceMail, MailError } from './mailer.js';
import { withDefaults } from './settings.js';

export async function loadOrderSummary(body) {
  const settings = withDefaults(body.settings);
  const ctx = {
    orderId: String(body.order_id || '').trim(),
    siteId: String(body.site_id || '').trim() || settings.onestock.default_site_id,
    apiUrl: String(body.api_url || '').trim(),
    lang: body.lang,
  };
  const order = await getOrder(settings, ctx);
  return {
    id: order.id || ctx.orderId,
    state: order.state,
    date: order.date,
    invoices: invoiceUrls(order),
    billing: billingContact(order),
  };
}

export async function sendInvoice(body) {
  const settings = withDefaults(body.settings);
  const to = String(body.to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new MailError('Adresse email destinataire invalide');

  // Invoice URLs are read again from OneStock: the browser only picks among the order's own invoices.
  const order = await loadOrderSummary(body);
  const wanted = Array.isArray(body.invoices) ? body.invoices : order.invoices;
  const urls = order.invoices.filter((url) => wanted.includes(url));
  if (!urls.length) throw new MailError('Aucune facture (information.invoice) à envoyer pour cette commande', 404);

  const attachments = await Promise.all(
    urls.map((url, i) => downloadInvoice(url, `facture-${order.id}${urls.length > 1 ? `-${i + 1}` : ''}.pdf`)),
  );
  const result = await sendInvoiceMail(settings.smtp, {
    to,
    subject: String(body.subject || '').trim() || `Facture ${order.id}`,
    text: String(body.body || ''),
    attachments,
  });
  return { ok: true, ...result, files: attachments.map((a) => a.filename) };
}
