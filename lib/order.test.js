import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceUrls, billingContact } from './order.js';

test('invoiceUrls reads information.invoice in its different shapes', () => {
  assert.deepEqual(invoiceUrls({ information: { invoice: 'https://x.io/a.pdf' } }), ['https://x.io/a.pdf']);
  assert.deepEqual(invoiceUrls({ information: { invoice: 'https://x.io/a.pdf, https://x.io/b.pdf' } }), [
    'https://x.io/a.pdf',
    'https://x.io/b.pdf',
  ]);
  assert.deepEqual(invoiceUrls({ information: { invoice: [{ url: 'https://x.io/c.pdf' }, 'not-a-url'] } }), [
    'https://x.io/c.pdf',
  ]);
  assert.deepEqual(invoiceUrls({ information: {} }), []);
  assert.deepEqual(invoiceUrls({}), []);
});

test('billingContact prefers the billing address contact and falls back on the customer', () => {
  const order = {
    customer: { email: 'customer@example.com', first_name: 'Jane', last_name: 'Doe' },
    pricing_details: { address: { contact: { email: 'billing@example.com', first_name: 'John' } } },
  };
  assert.deepEqual(billingContact(order), { email: 'billing@example.com', first_name: 'John', last_name: 'Doe' });
  assert.equal(billingContact({ customer: { email: 'c@x.io' } }).email, 'c@x.io');
});

test('proxyRequest rejects paths leaving the OneStock API', async () => {
  const { proxyRequest } = await import('./onestock.js');
  const settings = { onestock: { token: 't', api_root: '', environment: 'qualif' } };
  for (const path of ['https://evil.io/x', '/../x', 'orders', '/login']) {
    await assert.rejects(proxyRequest(settings, { siteId: 'c00' }, { path }), /invalide|non exposée/);
  }
});

test('the SMTP TLS mode follows standard ports', async () => {
  const { connectionOf } = await import('./mailer.js');
  assert.deepEqual(connectionOf({ port: '587', secure: true }), { port: 587, secure: false });
  assert.deepEqual(connectionOf({ port: '25', secure: true }), { port: 25, secure: false });
  assert.deepEqual(connectionOf({ port: '465', secure: false }), { port: 465, secure: true });
  assert.deepEqual(connectionOf({ port: '', secure: true }), { port: 587, secure: false });
  assert.deepEqual(connectionOf({ port: '8465', secure: true }), { port: 8465, secure: true });
});
