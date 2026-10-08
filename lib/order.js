/** Pure helpers to read an OneStock order. */

function toUrl(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') return String(value.url || value.link || value.href || '').trim();
  return '';
}

/**
 * Invoice URLs found in `information.invoice`.
 * Accepts a single URL, a list of URLs (array or comma/space separated string) or objects with a `url` field.
 */
export function invoiceUrls(order) {
  const value = order?.information?.invoice;
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,;]+/) : [value];
  return [...new Set(list.map(toUrl).filter((url) => /^https?:\/\//i.test(url)))];
}

export function billingContact(order) {
  const contact = order?.pricing_details?.address?.contact || {};
  return {
    email: contact.email || order?.customer?.email || '',
    first_name: contact.first_name || order?.customer?.first_name || '',
    last_name: contact.last_name || order?.customer?.last_name || '',
  };
}

/** What the screen needs from an order. */
export function orderSummary(order, orderId) {
  return {
    id: order?.id || orderId,
    state: order?.state,
    date: order?.date,
    invoices: invoiceUrls(order),
    billing: billingContact(order),
  };
}
