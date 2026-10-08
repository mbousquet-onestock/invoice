import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { environmentOf, scopeOf, readSettings, writeSettings, publicSettings, runtimeConfig } from './settings.js';

const rows = [
  { key: 'onestock_token', site_id: '', extension_id: '*', value: 'global-token' },
  { key: 'onestock_token', site_id: 'c00', extension_id: '*', value: 'site-token' },
  { key: 'smtp_host', site_id: '', extension_id: 'invoice', value: 'smtp.global' },
  { key: 'smtp_host', site_id: 'c00', extension_id: 'invoice', value: '' },
  { key: 'email_subject', site_id: 'c00', extension_id: 'invoice', value: 'Facture {{order_id}}' },
];
let calls;

beforeEach(() => {
  process.env.SETTINGS_API_KEY = 'k';
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method, url: u, headers: init.headers, body: init.body });
    const q = Object.fromEntries(u.searchParams);
    if (init.method === 'PUT') return new Response(JSON.stringify({ setting: {} }));
    const decrypt = q.decrypt === '1';
    const settings = rows
      .filter((r) => r.site_id === q.site_id && r.extension_id === q.extension_id)
      .map((r) => ({ ...r, value: r.key.includes('token') && !decrypt ? null : r.value }));
    return new Response(JSON.stringify({ settings, count: settings.length }));
  };
});

test('environmentOf deduces the environment from the OneStock API URL', () => {
  assert.equal(environmentOf({ apiUrl: 'https://c00.api.qualif.onestock-retail.com' }), 'qualif');
  assert.equal(environmentOf({ apiUrl: 'https://d01.api.dev.onestock-retail.dev' }), 'dev');
  assert.equal(environmentOf({ apiUrl: 'https://api-client.eu1.prod.onestock-retail.com' }), 'prod');
  assert.equal(environmentOf({ apiUrl: 'https://c00.api.onestock-retail.com' }), 'prod');
  assert.equal(environmentOf({ environment: 'training', apiUrl: 'https://c00.api.onestock-retail.com' }), 'training');
});

test('readSettings prefers site over global and extension over *', async () => {
  const scope = scopeOf({ site_id: 'c00', extension_id: 'invoice', environment: 'qualif' });
  const s = await readSettings(scope, { decrypt: true });
  assert.equal(s.onestock_token.value, 'site-token');
  assert.deepEqual(s.onestock_token.source, { site_id: 'c00', extension_id: '*' });
  // empty site value falls back on the global one
  assert.equal(s.smtp_host.value, 'smtp.global');
  assert.equal(s.email_subject.value, 'Facture {{order_id}}');
  assert.equal(s.smtp_port.value, '587');
  assert.equal(s.smtp_port.source, null);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].headers.Authorization, 'Bearer k');
  assert.equal(calls[0].url.searchParams.get('environment'), 'qualif');
});

test('secrets are never decrypted for the browser', async () => {
  const s = publicSettings(await readSettings(scopeOf({ site_id: 'c00', environment: 'qualif' })));
  assert.equal(s.onestock_token.value, '');
  assert.equal(s.onestock_token.set, true);
  assert.ok(calls.every((c) => !c.url.searchParams.has('decrypt')));
});

test('writeSettings upserts known keys and keeps secrets left empty', async () => {
  const scope = scopeOf({ site_id: 'c00', extension_id: 'invoice', environment: 'qualif' });
  const saved = await writeSettings(scope, { site_id: '', extension_id: '*' }, {
    smtp_host: 'smtp.x',
    smtp_password: '',
    unknown: 'x',
  });
  assert.deepEqual(saved, ['smtp_host']);
  assert.equal(calls.length, 1);
  const q = Object.fromEntries(calls[0].url.searchParams);
  assert.deepEqual(q, { key: 'smtp_host', site_id: '', extension_id: '*', environment: 'qualif', upsert: '1' });
  assert.equal(calls[0].url.pathname.endsWith('/api/settings/item'), true);
  assert.deepEqual(JSON.parse(calls[0].body), { value: 'smtp.x' });
});

test('runtimeConfig builds the OneStock and SMTP configuration', async () => {
  const scope = scopeOf({ site_id: 'c00', environment: 'qualif' });
  const config = runtimeConfig(await readSettings(scope, { decrypt: true }), scope);
  assert.equal(config.onestock.token, 'site-token');
  assert.equal(config.onestock.environment, 'qualif');
  assert.equal(config.smtp.port, 587);
  assert.equal(config.smtp.secure, false);
});

test('a missing API key is reported', async () => {
  delete process.env.SETTINGS_API_KEY;
  await assert.rejects(readSettings(scopeOf({ environment: 'qualif' })), /SETTINGS_API_KEY/);
});
