import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  environmentOf,
  scopeOf,
  readSettings,
  readOrInitializeSettings,
  writeSettings,
  publicSettings,
  runtimeConfig,
  targetOf,
} from './settings.js';
import { apiBaseUrl } from './onestock.js';

let rows;
let calls;

beforeEach(() => {
  process.env.SETTINGS_API_KEY = 'k';
  calls = [];
  rows = [
    { key: 'onestock_token', site_id: '', extension_id: '*', value: 'global-token' },
    { key: 'onestock_token', site_id: 'c00', extension_id: '*', value: 'site-token' },
    { key: 'smtp_host', site_id: '', extension_id: 'invoice', value: 'smtp.global' },
    { key: 'smtp_host', site_id: 'c00', extension_id: 'invoice', value: '' },
    { key: 'email_subject', site_id: 'c00', extension_id: 'invoice', value: 'Facture {{order_id}}' },
  ];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method, url: u, headers: init.headers, body: init.body && JSON.parse(init.body) });
    const q = Object.fromEntries(u.searchParams);
    if (init.method === 'PUT') return new Response(JSON.stringify({ setting: {} }));
    if (init.method === 'POST') {
      const list = [].concat(calls.at(-1).body);
      rows.push(...list);
      return new Response(JSON.stringify({ settings: list }), { status: 201 });
    }
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

test('first connection creates the missing keys at their level, api root from the context', async () => {
  rows = [];
  const scope = scopeOf({ site_id: 'c00', extension_id: 'invoice', api_url: 'https://c00.api.qualif.onestock-retail.com' });
  const { created, settings } = await readOrInitializeSettings(scope);
  assert.ok(!created.includes('onestock_token') && !created.includes('smtp_password'), 'secrets are not created');
  assert.ok(created.includes('onestock_api_root') && created.includes('smtp_host') && created.includes('email_body'));
  const post = calls.find((c) => c.method === 'POST');
  const root = post.body.find((r) => r.key === 'onestock_api_root');
  assert.deepEqual(root, {
    key: 'onestock_api_root',
    value: 'https://c00.api.qualif.onestock-retail.com',
    site_id: 'c00',
    extension_id: '*',
    environment: 'qualif',
  });
  assert.equal(post.body.find((r) => r.key === 'smtp_port').extension_id, 'invoice');
  assert.equal(settings.onestock_api_root.value, 'https://c00.api.qualif.onestock-retail.com');

  // second connection: nothing left to create
  calls = [];
  assert.deepEqual((await readOrInitializeSettings(scope)).created, []);
  assert.ok(calls.every((c) => c.method !== 'POST'));
});

test('writeSettings upserts each key at its level and keeps secrets left empty', async () => {
  const scope = scopeOf({ site_id: 'c00', extension_id: 'invoice', environment: 'qualif' });
  const saved = await writeSettings(scope, { onestock_token: 'tok', smtp_host: 'smtp.x', smtp_password: '', unknown: 'x' });
  assert.deepEqual(saved, ['onestock_token', 'smtp_host']);
  const [token, host] = calls.map((c) => Object.fromEntries(c.url.searchParams));
  assert.deepEqual(token, { key: 'onestock_token', site_id: 'c00', extension_id: '*', environment: 'qualif', upsert: '1' });
  assert.equal(host.extension_id, 'invoice');
  assert.ok(calls[0].url.pathname.endsWith('/api/settings/item'));
  assert.deepEqual(calls[0].body, { value: 'tok' });
  assert.deepEqual(targetOf(scope, 'email_body'), { site_id: 'c00', extension_id: 'invoice' });
});

test('runtimeConfig and apiBaseUrl use onestock_token and onestock_api_root', async () => {
  rows.push({ key: 'onestock_api_root', site_id: 'c00', extension_id: '*', value: 'https://c00.api.qualif.onestock-retail.com/' });
  const scope = scopeOf({ site_id: 'c00', environment: 'qualif' });
  const config = runtimeConfig(await readSettings(scope, { decrypt: true }), scope);
  assert.equal(config.onestock.token, 'site-token');
  assert.equal(apiBaseUrl(config, { apiUrl: 'https://ctx', siteId: 'c00' }), 'https://c00.api.qualif.onestock-retail.com/v3');
  config.onestock.api_root = 'https://root/v4';
  assert.equal(apiBaseUrl(config, {}), 'https://root/v4');
  config.onestock.api_root = '';
  assert.equal(apiBaseUrl(config, { apiUrl: 'https://ctx' }), 'https://ctx/v3');
  assert.equal(apiBaseUrl(config, { siteId: 'c00' }), 'https://c00.api.qualif.onestock-retail.com/v3');
  assert.equal(config.smtp.port, 587);
});

test('a missing API key is reported', async () => {
  delete process.env.SETTINGS_API_KEY;
  await assert.rejects(readSettings(scopeOf({ environment: 'qualif' })), /SETTINGS_API_KEY/);
});
