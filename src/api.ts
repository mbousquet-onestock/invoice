import { settings } from './settings';
import { invoiceUrls, billingContact } from '#lib/order.js';
import { ORDER_FIELDS } from '#lib/onestock.js';

export interface OrderSummary {
  id: string;
  state?: string;
  date?: number;
  invoices: string[];
  billing: { email: string; first_name: string; last_name: string };
}

export interface CallContext {
  siteId: string;
  apiUrl: string;
  lang?: string;
}

async function post<T>(url: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, settings }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error || data.message || data.raw || `Erreur HTTP ${res.status}`;
    throw Object.assign(new Error(message), { status: res.status, details: data });
  }
  return data as T;
}

/** Every OneStock API call goes through the Vercel proxy (api/onestock-proxy.js). */
export function onestock<T>(ctx: CallContext, method: string, path: string, body: Record<string, unknown> = {}) {
  return post<T>('/api/onestock-proxy', { site_id: ctx.siteId, api_url: ctx.apiUrl, method, path, body });
}

export async function fetchOrder(ctx: CallContext, orderId: string): Promise<OrderSummary> {
  try {
    const order = await onestock<Record<string, any>>(ctx, 'GET', `/orders/${encodeURIComponent(orderId)}`, {
      fields: ORDER_FIELDS,
      item_features_lang: ctx.lang || 'fr',
    });
    return {
      id: order.id || orderId,
      state: order.state,
      date: order.date,
      invoices: invoiceUrls(order),
      billing: billingContact(order),
    };
  } catch (err) {
    if ((err as { status?: number }).status === 404) throw new Error(`Commande ${orderId} introuvable`);
    throw err;
  }
}

export function sendInvoice(
  ctx: CallContext,
  payload: { order_id: string; to: string; subject: string; body: string; invoices: string[] },
) {
  return post<{ ok: boolean; files: string[]; accepted: string[] }>('/api/send-invoice', {
    ...payload,
    site_id: ctx.siteId,
    api_url: ctx.apiUrl,
    lang: ctx.lang,
  });
}

export function testSmtp() {
  return post<{ ok: boolean }>('/api/test-smtp', {});
}

export function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? '');
}
