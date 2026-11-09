import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  environmentOf,
  scopeOf,
  accountApiOrigin,
  readSettings,
  readOrInitializeSettings,
  writeSettings,
  publicSettings,
  runtimeConfig,
  targetOf,
  loadRuntimeConfig,
  clearSettingsCache,
} from './settings.js';
import { apiBaseUrl, getToken, proxyRequest, clearTokenCache } from './onestock.js';

const QUALIF_API = 'https://c00.api.qualif.onestock-retail.com';

let rows;
let calls;
let onestock; // fake OneStock API: (url, body) => Response

/** Fake Settings API (list filtered by site_id / environment, POST, PUT) and OneStock API. */
function install() {
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body && JSON.parse(init.body);
    if (u.hostname.endsWith('onestock-retail.com') || u.hostname.startsWith('other')) return onestock(u, body);
    calls.push({ method: init.method, url: u, headers: init.headers, body });
    const q = Object.fromEntries(u.searchParams);
    if (init.method === 'PUT') return new Response(JSON.stringify({ setting: {} }));
    if (init.method === 'POST') {
      rows.push(...[].concat(body));
      return new Response(JSON.stringify({ settings: body }), { status: 201 });
    }
    const decrypt = q.decrypt === '1';
    const settings = rows
      .filter((r) => r.site_id === q.site_id && (r.environment ?? 'qualif') === q.environment)
      .map((r) => ({ ...r, value: /password/.test(r.key) && !decrypt ? null : r.value }));
    return new Response(JSON.stringify({ settings, count: settings.length }));
  };
}

beforeEach(() => {
  clearSettingsCache();
  clearTokenCache();
  process.env.SETTINGS_API_KEY = 'k';
  delete process.env.SETTINGS_ENCRYPTION_KEY;
  calls = [];
  rows = [
    { key: 'onestock_user_id', site_id: 'c00', extension_id: '*', environment: QUALIF_API, value: 'api-user' },
    { key: 'onestock_password', site_id: 'c00', extension_id: '*', environment: QUALIF_API, value: 'api-pass' },
    // account of another site and of another API: never used for c00 on the qualif API
    { key: 'onestock_user_id', site_id: 'c01', extension_id: '*', environment: QUALIF_API, value: 'other-site' },
    { key: 'onestock_user_id', site_id: 'c00', extension_id: '*', environment: 'https://other.api.example', value: 'other-api' },
    { key: 'smtp_host', site_id: '', extension_id: 'invoice', environment: 'qualif', value: 'smtp.global' },
    { key: 'smtp_host', site_id: 'c00', extension_id: 'invoice', environment: 'qualif', value: '' },
    { key: 'smtp_password', site_id: 'c00', extension_id: 'invoice', environment: 'qualif', value: 'smtp-pass' },
    { key: 'email_subject', site_id: 'c00', extension_id: 'invoice', environment: 'qualif', value: 'Facture {{order_id}}' },
  ];
  onestock = async () => new Response('{}', { status: 404 });
  install();
});

const scopeC00 = () => scopeOf({ site_id: 'c00', extension_id: 'invoice', api_url: QUALIF_API });

test('environmentOf deduces the environment from the OneStock API URL', () => {
  assert.equal(environmentOf({ apiUrl: QUALIF_API }), 'qualif');
  assert.equal(environmentOf({ apiUrl: 'https://api-qualif.onestock-retail.com' }), 'qualif');
  assert.equal(environmentOf({ apiUrl: 'https://api.onestock-retail.com' }), 'prod');
  assert.equal(environmentOf({ apiUrl: 'https://d01.api.dev.onestock-retail.dev' }), 'dev');
  assert.equal(environmentOf({ apiUrl: 'https://api-client.eu1.prod.onestock-retail.com' }), 'prod');
  assert.equal(environmentOf({ apiUrl: 'https://c00.api.onestock-retail.com' }), 'prod');
  assert.equal(environmentOf({ environment: 'training', apiUrl: 'https://c00.api.onestock-retail.com' }), 'training');
});

test('accountApiOrigin: onestock_api_root, else the context API URL, else the URL built from the site', () => {
  assert.equal(accountApiOrigin(scopeC00(), 'https://root.example/v3'), 'https://root.example');
  assert.equal(accountApiOrigin(scopeC00()), QUALIF_API);
  assert.equal(accountApiOrigin(scopeOf({ site_id: 'c00', environment: 'qualif' })), QUALIF_API);
  assert.equal(accountApiOrigin(scopeOf({ site_id: 'c00', environment: 'prod' })), 'https://c00.api.onestock-retail.com');
});

test('readSettings prefers site over global and extension over *', async () => {
  const s = await readSettings(scopeC00(), { decrypt: true });
  // empty site value falls back on the global one
  assert.equal(s.smtp_host.value, 'smtp.global');
  assert.deepEqual(s.smtp_host.source, { site_id: '', extension_id: 'invoice', environment: 'qualif' });
  assert.equal(s.email_subject.value, 'Facture {{order_id}}');
  assert.equal(s.smtp_port.value, '587');
  assert.equal(s.smtp_port.source, null);
  assert.equal(calls.length, 4, "sites c00, '' and '*' + the account of the API");
  assert.equal(calls[0].headers.Authorization, 'Bearer k');
});

test('the API account is read for the site and the API URL only', async () => {
  const s = await readSettings(scopeC00(), { decrypt: true });
  assert.equal(s.onestock_user_id.value, 'api-user');
  assert.equal(s.onestock_password.value, 'api-pass');
  assert.equal(s.onestock_user_id.api_origin, QUALIF_API);
  assert.deepEqual(s.onestock_user_id.source, { site_id: 'c00', extension_id: '*', api_url: QUALIF_API });

  const other = await readSettings(scopeOf({ site_id: 'c02', api_url: QUALIF_API }), { decrypt: true });
  assert.equal(other.onestock_user_id.set, false, 'no account for c02');
  assert.equal(other.onestock_user_id.value, '');
});

test('the account follows onestock_api_root when it points to another API', async () => {
  rows.push({ key: 'onestock_api_root', site_id: 'c00', extension_id: '*', environment: 'qualif', value: 'https://other.api.example/v3' });
  const s = await readSettings(scopeC00(), { decrypt: true });
  assert.equal(s.onestock_user_id.value, 'other-api');
  assert.equal(s.onestock_user_id.api_origin, 'https://other.api.example');
});

test('secrets are never decrypted for the browser', async () => {
  const s = publicSettings(await readSettings(scopeC00()));
  assert.equal(s.onestock_password.value, '');
  assert.equal(s.onestock_password.set, true);
  assert.equal(s.smtp_password.value, '');
  assert.ok(calls.every((c) => !c.url.searchParams.has('decrypt')));
});

test('first connection creates the missing keys at their level, never the API account', async () => {
  rows = [];
  const { created, settings } = await readOrInitializeSettings(scopeC00());
  assert.ok(!created.includes('onestock_user_id') && !created.includes('onestock_password'), 'account entered by a person');
  assert.ok(!created.includes('smtp_password'), 'secrets are not created');
  assert.ok(created.includes('onestock_api_root') && created.includes('smtp_host') && created.includes('email_body'));
  const post = calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body.find((r) => r.key === 'onestock_api_root'), {
    key: 'onestock_api_root',
    value: QUALIF_API,
    site_id: 'c00',
    extension_id: '*',
    environment: 'qualif',
  });
  assert.equal(post.body.find((r) => r.key === 'smtp_port').extension_id, 'invoice');
  assert.equal(settings.onestock_api_root.value, QUALIF_API);

  calls = [];
  assert.deepEqual((await readOrInitializeSettings(scopeC00())).created, []);
  assert.ok(calls.every((c) => c.method !== 'POST'));
});

test('writeSettings: the account goes to site + "*" + API origin, the others to their level', async () => {
  const scope = scopeC00();
  const saved = await writeSettings(scope, {
    onestock_user_id: 'u2',
    onestock_password: 'p2',
    smtp_host: 'smtp.x',
    smtp_password: '',
    unknown: 'x',
  });
  assert.deepEqual(saved, ['onestock_user_id', 'onestock_password', 'smtp_host']);
  const puts = calls.filter((c) => c.method === 'PUT').map((c) => ({ ...Object.fromEntries(c.url.searchParams), body: c.body }));
  assert.deepEqual(puts[0], { key: 'onestock_user_id', site_id: 'c00', extension_id: '*', environment: QUALIF_API, upsert: '1', body: { value: 'u2' } });
  assert.equal(puts[1].environment, QUALIF_API);
  assert.deepEqual({ ...puts[2], body: undefined }, { key: 'smtp_host', site_id: 'c00', extension_id: 'invoice', environment: 'qualif', upsert: '1', body: undefined });
  assert.deepEqual(targetOf(scope, 'onestock_password'), { site_id: 'c00', extension_id: '*' });

  // with a new API root in the same save, the account goes to that API
  calls = [];
  await writeSettings(scope, { onestock_api_root: 'https://other.api.example', onestock_user_id: 'u3' });
  const account = calls.find((c) => c.url.searchParams.get('key') === 'onestock_user_id');
  assert.equal(account.url.searchParams.get('environment'), 'https://other.api.example');

  // settings screen: the account is ignored
  calls = [];
  assert.deepEqual(await writeSettings(scope, { onestock_user_id: 'x', smtp_from: 'a@b.c' }, { account: false }), ['smtp_from']);
  assert.ok(calls.every((c) => c.url.searchParams.get('key') !== 'onestock_user_id'));

  // no site: the account cannot be saved
  await assert.rejects(writeSettings(scopeOf({ environment: 'qualif' }), { onestock_user_id: 'x' }), /Site et URL/);
});

test('runtimeConfig and apiBaseUrl', async () => {
  rows.push({ key: 'onestock_api_root', site_id: 'c00', extension_id: '*', environment: 'qualif', value: `${QUALIF_API}/` });
  const scope = scopeC00();
  const config = runtimeConfig(await readSettings(scope, { decrypt: true }), scope);
  assert.equal(config.onestock.user_id, 'api-user');
  assert.equal(config.onestock.password, 'api-pass');
  assert.equal(config.onestock.api_origin, QUALIF_API);
  assert.equal(apiBaseUrl(config, { apiUrl: 'https://ctx', siteId: 'c00' }), `${QUALIF_API}/v3`);
  config.onestock.api_root = 'https://root/v4';
  assert.equal(apiBaseUrl(config, {}), 'https://root/v4');
  config.onestock.api_root = '';
  assert.equal(apiBaseUrl(config, { apiUrl: 'https://ctx' }), 'https://ctx/v3');
  assert.equal(apiBaseUrl(config, { siteId: 'c00' }), `${QUALIF_API}/v3`);
  assert.equal(config.smtp.port, 587);
  assert.equal(config.smtp.password, 'smtp-pass');
});

test('global settings may use site_id "*"', async () => {
  rows = [{ key: 'smtp_from', site_id: '*', extension_id: '*', environment: 'qualif', value: 'star@x.io' }];
  const s = await readSettings(scopeC00(), { decrypt: true });
  assert.equal(s.smtp_from.value, 'star@x.io');
  assert.deepEqual(s.smtp_from.source, { site_id: '*', extension_id: '*', environment: 'qualif' });
});

test('encrypted values are decrypted locally with SETTINGS_ENCRYPTION_KEY', async () => {
  const { createCipheriv, randomBytes } = await import('node:crypto');
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update('secret-pass', 'utf8'), cipher.final()]);
  const encrypted = `enc:v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')}`;
  rows = [{ key: 'onestock_password', site_id: 'c00', extension_id: '*', environment: QUALIF_API, value: encrypted }];
  process.env.SETTINGS_ENCRYPTION_KEY = key.toString('hex');

  // the Settings API cannot decrypt (decrypt=1 fails) and returns the stored value: it is decrypted here
  globalThis.fetch = async (url) => {
    const q = new URL(url).searchParams;
    if (q.get('decrypt') === '1') return new Response(JSON.stringify({ error: 'encryption_key_missing' }), { status: 500 });
    const settings = rows.filter((r) => r.site_id === q.get('site_id') && r.environment === q.get('environment'));
    return new Response(JSON.stringify({ settings }));
  };
  const s = await readSettings(scopeC00(), { decrypt: true });
  assert.equal(s.onestock_password.value, 'secret-pass');

  // wrong key: the error stays on the setting instead of breaking the whole read
  clearSettingsCache();
  process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  const wrong = await readSettings(scopeC00(), { decrypt: true });
  assert.equal(wrong.onestock_password.value, '');
  assert.match(wrong.onestock_password.error, /Déchiffrement de onestock_password impossible/);
});

test('a secret that cannot be decrypted only fails where it is used', async () => {
  const { verifySmtp } = await import('./mailer.js');
  rows = [
    { key: 'onestock_user_id', site_id: 'c00', extension_id: '*', environment: QUALIF_API, value: 'u' },
    { key: 'onestock_password', site_id: 'c00', extension_id: '*', environment: QUALIF_API, value: null, decrypt_error: true },
    { key: 'smtp_password', site_id: '', extension_id: '*', environment: 'qualif', value: null, decrypt_error: true },
    { key: 'smtp_host', site_id: '', extension_id: '*', environment: 'qualif', value: '127.0.0.1' },
    { key: 'smtp_port', site_id: '', extension_id: '*', environment: 'qualif', value: '1' },
  ];
  globalThis.fetch = async (url) => {
    const q = new URL(url).searchParams;
    const settings = rows.filter((r) => r.site_id === q.get('site_id') && r.environment === q.get('environment'));
    return new Response(JSON.stringify({ settings }));
  };
  const { config } = await loadRuntimeConfig({ site_id: 'c00', api_url: QUALIF_API });
  assert.equal(config.smtp.host, '127.0.0.1', 'the rest of the configuration is read');
  await assert.rejects(proxyRequest(config, { siteId: 'c00' }, { path: '/orders/1' }), /n'a pas pu déchiffrer onestock_password/);
  await assert.rejects(verifySmtp(config.smtp), /Connexion SMTP en échec/);
  await assert.rejects(verifySmtp({ ...config.smtp, user: 'u' }), /n'a pas pu déchiffrer smtp_password/);
});

test('in prod, keys without data fall back on qualif', async () => {
  rows = [
    { key: 'smtp_from', site_id: '', extension_id: '*', environment: 'qualif', value: 'qualif@x.io' },
    { key: 'smtp_host', site_id: 'c00', extension_id: 'invoice', environment: 'qualif', value: 'smtp.qualif' },
    { key: 'smtp_host', site_id: '', extension_id: 'invoice', environment: 'prod', value: 'smtp.prod' },
  ];
  const scope = scopeOf({ site_id: 'c00', extension_id: 'invoice', api_url: 'https://c00.api.onestock-retail.com' });
  assert.equal(scope.environment, 'prod');
  const s = await readSettings(scope, { decrypt: true });
  assert.equal(s.smtp_from.value, 'qualif@x.io');
  assert.equal(s.smtp_from.source.environment, 'qualif');
  assert.equal(s.smtp_host.value, 'smtp.prod', 'a prod value (even global) wins over a qualif one');
  assert.equal(calls.length, 7, '3 sites × prod, qualif + the account');

  calls = [];
  const { created } = await readOrInitializeSettings(scope);
  assert.ok(!created.includes('smtp_host'));
  assert.ok(created.includes('smtp_port'));
});

test('working reads are cached for a short time, fresh reads and writes bypass it', async () => {
  const scope = scopeC00();
  await readSettings(scope, { decrypt: true });
  await readSettings(scope, { decrypt: true });
  assert.equal(calls.length, 4, 'second read served from the cache');
  await readSettings(scope, { decrypt: true, fresh: true });
  assert.equal(calls.length, 8, 'fresh read goes to the API');
  await writeSettings(scope, { smtp_host: 'smtp.y' });
  calls = [];
  await readSettings(scope, { decrypt: true });
  assert.equal(calls.length, 4, 'a write clears the cache');
});

test('when the Settings API cannot decrypt, decrypt=1 is not retried on every read', async () => {
  let decryptCalls = 0;
  globalThis.fetch = async (url) => {
    if (new URL(url).searchParams.get('decrypt') === '1') {
      decryptCalls++;
      return new Response(JSON.stringify({ error: 'encryption_key_missing' }), { status: 500 });
    }
    return new Response(JSON.stringify({ settings: [] }));
  };
  await readSettings(scopeC00(), { decrypt: true, fresh: true });
  const first = decryptCalls;
  await readSettings(scopeC00(), { decrypt: true, fresh: true });
  assert.equal(decryptCalls, first);
});

test('a missing API key is reported', async () => {
  delete process.env.SETTINGS_API_KEY;
  await assert.rejects(readSettings(scopeOf({ environment: 'qualif' })), /SETTINGS_API_KEY/);
});

test('the token is obtained with POST {url}/login and the account of the site', async () => {
  const logins = [];
  const orders = [];
  onestock = async (u, body) => {
    if (u.pathname === '/v3/login') {
      logins.push(body);
      return new Response(JSON.stringify({ token: `tok-${logins.length}` }));
    }
    orders.push(body.token);
    return new Response(JSON.stringify(body.token === 'tok-1' && orders.length === 1 ? { message: 'expired' } : { id: 'ORD1' }), {
      status: body.token === 'tok-1' && orders.length === 1 ? 401 : 200,
    });
  };
  const { config } = await loadRuntimeConfig({ site_id: 'c00', api_url: QUALIF_API });

  // first call: login, 401 (token expired), new login, retry
  const res = await proxyRequest(config, { siteId: 'c00', apiUrl: QUALIF_API }, { path: '/orders/ORD1' });
  assert.equal(res.status, 200);
  assert.deepEqual(logins[0], { password: 'api-pass', site_id: 'c00', user_id: 'api-user' });
  assert.equal(logins.length, 2);
  assert.deepEqual(orders, ['tok-1', 'tok-2']);

  // next call: the token is reused
  await proxyRequest(config, { siteId: 'c00', apiUrl: QUALIF_API }, { path: '/orders/ORD1' });
  assert.equal(logins.length, 2);
  assert.equal(await getToken(config, { siteId: 'c00', apiUrl: QUALIF_API }), 'tok-2');
});

test('login errors: missing account, refused credentials (password never shown)', async () => {
  await assert.rejects(
    getToken({ onestock: { user_id: '', password: '', api_origin: QUALIF_API } }, { siteId: 'c00', apiUrl: QUALIF_API }),
    /Compte API OneStock non renseigné pour le site c00/,
  );
  onestock = async () => new Response(JSON.stringify({ message: 'invalid credentials' }), { status: 401 });
  const err = await getToken(
    { onestock: { user_id: 'u', password: 'p-secret', api_origin: QUALIF_API } },
    { siteId: 'c00', apiUrl: QUALIF_API },
  ).catch((e) => e);
  assert.match(err.message, /Échec de l'authentification OneStock \(POST \/login, 401\) : invalid credentials/);
  assert.equal(err.details.request.url, `${QUALIF_API}/v3/login`);
  assert.equal(err.details.request.body.password, '••••••••');
  assert.ok(!JSON.stringify(err.details).includes('p-secret'));
});
