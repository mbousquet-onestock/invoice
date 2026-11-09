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
  loadRuntimeConfig,
  clearSettingsCache,
  saveContextSettings,
} from './settings.js';
import { apiBaseUrl, getToken, proxyRequest, clearTokenCache } from './onestock.js';

// Settings are linked to the site and the API URL of the context: environment = origin of the API URL.
const QUALIF_API = 'https://c00.api.qualif.onestock-retail.com';
const OTHER_QUALIF_API = 'https://api-qualif.onestock-retail.com';

let rows;
let calls;
let onestock; // fake OneStock API: (url, body) => Response

/** Fake Settings API (list filtered by site_id / environment, POST, PUT) and OneStock API. */
function install() {
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body && JSON.parse(init.body);
    if (u.hostname.endsWith('onestock-retail.com')) return onestock(u, body);
    calls.push({ method: init.method, url: u, headers: init.headers, body });
    const q = Object.fromEntries(u.searchParams);
    if (init.method === 'PUT') {
      const row = { key: q.key, site_id: q.site_id, extension_id: q.extension_id, environment: q.environment, value: body.value };
      const i = rows.findIndex((r) => ['key', 'site_id', 'extension_id', 'environment'].every((k) => r[k] === row[k]));
      if (i >= 0) rows[i] = row;
      else rows.push(row);
      return new Response(JSON.stringify({ setting: {} }));
    }
    if (init.method === 'POST') {
      rows.push(...[].concat(body));
      return new Response(JSON.stringify({ settings: body }), { status: 201 });
    }
    const decrypt = q.decrypt === '1';
    const settings = rows
      .filter((r) => r.site_id === q.site_id && r.environment === q.environment)
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
    // account of another site and of another API URL: never used for c00 on QUALIF_API
    { key: 'onestock_user_id', site_id: 'c01', extension_id: '*', environment: QUALIF_API, value: 'other-site' },
    { key: 'onestock_user_id', site_id: 'c00', extension_id: '*', environment: OTHER_QUALIF_API, value: 'other-api' },
    // an account for all sites is never used: the account belongs to the site
    { key: 'onestock_user_id', site_id: '', extension_id: '*', environment: QUALIF_API, value: 'all-sites' },
    { key: 'smtp_host', site_id: '', extension_id: 'invoice', environment: QUALIF_API, value: 'smtp.global' },
    { key: 'smtp_host', site_id: 'c00', extension_id: 'invoice', environment: QUALIF_API, value: '' },
    { key: 'smtp_host', site_id: 'c00', extension_id: 'invoice', environment: OTHER_QUALIF_API, value: 'smtp.other-api' },
    { key: 'smtp_password', site_id: 'c00', extension_id: 'invoice', environment: QUALIF_API, value: 'smtp-pass' },
    { key: 'email_subject', site_id: 'c00', extension_id: 'invoice', environment: QUALIF_API, value: 'Facture {{order_id}}' },
  ];
  onestock = async () => new Response('{}', { status: 404 });
  install();
});

const scopeC00 = () => scopeOf({ site_id: 'c00', extension_id: 'invoice', api_url: QUALIF_API });

test('environmentOf deduces the environment name from the OneStock API URL', () => {
  assert.equal(environmentOf({ apiUrl: QUALIF_API }), 'qualif');
  assert.equal(environmentOf({ apiUrl: OTHER_QUALIF_API }), 'qualif');
  assert.equal(environmentOf({ apiUrl: 'https://api.onestock-retail.com' }), 'prod');
  assert.equal(environmentOf({ apiUrl: 'https://d01.api.dev.onestock-retail.dev' }), 'dev');
  assert.equal(environmentOf({ apiUrl: 'https://api-client.eu1.prod.onestock-retail.com' }), 'prod');
  assert.equal(environmentOf({ environment: 'training', apiUrl: 'https://c00.api.onestock-retail.com' }), 'training');
});

test('settings are linked to the site and the API URL of the context', () => {
  const scope = scopeOf({ site_id: 'p0039', api_url: `${OTHER_QUALIF_API}/v3` });
  assert.equal(scope.environment, OTHER_QUALIF_API, 'environment = origin of the API URL');
  assert.equal(scope.apiOrigin, OTHER_QUALIF_API);
  assert.equal(scope.envName, 'qualif');
  // without API URL: built from the site
  assert.equal(scopeOf({ site_id: 'c00', environment: 'qualif' }).environment, QUALIF_API);
  assert.equal(scopeOf({ site_id: 'c00', environment: 'prod' }).environment, 'https://c00.api.onestock-retail.com');
});

test('readSettings prefers site over global and extension over *, for the API URL of the context only', async () => {
  const s = await readSettings(scopeC00(), { decrypt: true });
  // empty site value falls back on the global one; the value of another API URL is never used
  assert.equal(s.smtp_host.value, 'smtp.global');
  assert.deepEqual(s.smtp_host.source, { site_id: '', extension_id: 'invoice', environment: QUALIF_API });
  assert.equal(s.email_subject.value, 'Facture {{order_id}}');
  assert.equal(s.smtp_port.value, '587');
  assert.equal(s.smtp_port.source, null);
  assert.equal(calls.length, 6, "sites c00, '' and '*' × the API URL and the environment name");
  assert.deepEqual([...new Set(calls.map((c) => c.url.searchParams.get('environment')))], [QUALIF_API, 'qualif']);
  assert.equal(calls[0].headers.Authorization, 'Bearer k');

  const other = await readSettings(scopeOf({ site_id: 'c00', extension_id: 'invoice', api_url: OTHER_QUALIF_API }));
  assert.equal(other.smtp_host.value, 'smtp.other-api', 'another API URL has its own values');
});

test('the API account: site and API URL first, then all sites', async () => {
  const s = await readSettings(scopeC00(), { decrypt: true });
  assert.equal(s.onestock_user_id.value, 'api-user');
  assert.equal(s.onestock_password.value, 'api-pass');
  assert.equal(s.onestock_user_id.api_origin, QUALIF_API);
  assert.deepEqual(s.onestock_user_id.source, { site_id: 'c00', extension_id: '*', environment: QUALIF_API });
  assert.match(s.onestock_user_id.lookup, /site c00 puis tous les sites, extension invoice ou \*, environment https:\/\/c00\.api\.qualif\.onestock-retail\.com puis qualif/);

  const c02 = await readSettings(scopeOf({ site_id: 'c02', api_url: QUALIF_API }), { decrypt: true });
  assert.equal(c02.onestock_user_id.value, 'all-sites', 'no account for c02: the one for all sites applies');

  const otherApi = await readSettings(scopeOf({ site_id: 'c00', api_url: OTHER_QUALIF_API }), { decrypt: true });
  assert.equal(otherApi.onestock_user_id.value, 'other-api');
});

test('the API account entered in the Extensions app (environment qualif / prod) is found', async () => {
  rows = [
    { key: 'onestock_user_id', site_id: 'p0039', extension_id: '*', environment: 'qualif', value: 'ext-user' },
    { key: 'onestock_password', site_id: 'p0039', extension_id: '*', environment: 'qualif', value: 'ext-pass' },
    { key: 'onestock_user_id', site_id: 'p0039', extension_id: '*', environment: 'prod', value: 'prod-user' },
  ];
  const scope = scopeOf({ site_id: 'p0039', api_url: 'https://p0039.api.qualif.onestock-retail.com' });
  const { config } = await loadRuntimeConfig({ site_id: 'p0039', api_url: 'https://p0039.api.qualif.onestock-retail.com' });
  assert.equal(config.onestock.user_id, 'ext-user');
  assert.equal(config.onestock.password, 'ext-pass');
  assert.deepEqual((await readSettings(scope)).onestock_user_id.source, { site_id: 'p0039', extension_id: '*', environment: 'qualif' });

  // a value saved by this app for the API URL comes first
  rows.push({ key: 'onestock_user_id', site_id: 'p0039', extension_id: '*', environment: 'https://p0039.api.qualif.onestock-retail.com', value: 'app-user' });
  clearSettingsCache();
  assert.equal((await readSettings(scope)).onestock_user_id.value, 'app-user');
});

test('secrets are never decrypted for the browser', async () => {
  const s = publicSettings(await readSettings(scopeC00()));
  assert.equal(s.onestock_password.value, '');
  assert.equal(s.onestock_password.set, true);
  assert.equal(s.smtp_password.value, '');
  assert.ok(calls.every((c) => !c.url.searchParams.has('decrypt')));
});

test('first connection creates the missing keys for the site and API URL, never the API account', async () => {
  rows = [];
  const { created, settings } = await readOrInitializeSettings(scopeC00());
  assert.ok(!created.includes('onestock_user_id') && !created.includes('onestock_password'), 'account entered by a person');
  assert.ok(!created.includes('smtp_password'), 'secrets are not created');
  assert.ok(created.includes('onestock_api_root') && created.includes('smtp_host') && created.includes('email_body'));
  assert.ok(created.includes('context_site_id') && created.includes('context_api_url'), 'the context is saved');
  const post = calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body.find((r) => r.key === 'onestock_api_root'), {
    key: 'onestock_api_root',
    value: QUALIF_API,
    site_id: 'c00',
    extension_id: 'invoice',
    environment: QUALIF_API,
  });
  assert.equal(post.body.find((r) => r.key === 'context_site_id').value, 'c00');
  assert.equal(post.body.find((r) => r.key === 'context_api_url').value, QUALIF_API);
  const port = post.body.find((r) => r.key === 'smtp_port');
  assert.deepEqual([port.extension_id, port.environment], ['invoice', QUALIF_API]);
  assert.equal(settings.onestock_api_root.value, QUALIF_API);

  calls = [];
  assert.deepEqual((await readOrInitializeSettings(scopeC00())).created, []);
  assert.ok(calls.every((c) => c.method !== 'POST'));
});

test('writeSettings: everything for the site and API URL; account and API root shared by the extensions', async () => {
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
  assert.deepEqual(puts[0], { key: 'onestock_user_id', site_id: 'c00', extension_id: 'invoice', environment: QUALIF_API, upsert: '1', body: { value: 'u2' } });
  assert.equal(puts[1].environment, QUALIF_API);
  assert.deepEqual(
    { ...puts[2], body: undefined },
    { key: 'smtp_host', site_id: 'c00', extension_id: 'invoice', environment: QUALIF_API, upsert: '1', body: undefined },
  );
  assert.deepEqual(targetOf(scope), { site_id: 'c00', extension_id: 'invoice' });

  // option used to ignore the account
  calls = [];
  assert.deepEqual(await writeSettings(scope, { onestock_user_id: 'x', smtp_from: 'a@b.c' }, { account: false }), ['smtp_from']);

  // no site: the account cannot be saved
  await assert.rejects(writeSettings(scopeOf({ environment: 'qualif' }), { onestock_user_id: 'x' }), /Site et URL/);
});

test('runtimeConfig and apiBaseUrl', async () => {
  rows.push({ key: 'onestock_api_root', site_id: 'c00', extension_id: '*', environment: QUALIF_API, value: `${QUALIF_API}/` });
  const scope = scopeC00();
  const config = runtimeConfig(await readSettings(scope, { decrypt: true }), scope);
  assert.equal(config.onestock.user_id, 'api-user');
  assert.equal(config.onestock.password, 'api-pass');
  assert.equal(config.onestock.api_origin, QUALIF_API);
  assert.equal(config.onestock.environment, 'qualif');
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
  rows = [{ key: 'smtp_from', site_id: '*', extension_id: '*', environment: QUALIF_API, value: 'star@x.io' }];
  const s = await readSettings(scopeC00(), { decrypt: true });
  assert.equal(s.smtp_from.value, 'star@x.io');
  assert.deepEqual(s.smtp_from.source, { site_id: '*', extension_id: '*', environment: QUALIF_API });
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
    { key: 'smtp_password', site_id: '', extension_id: '*', environment: QUALIF_API, value: null, decrypt_error: true },
    { key: 'smtp_host', site_id: '', extension_id: '*', environment: QUALIF_API, value: '127.0.0.1' },
    { key: 'smtp_port', site_id: '', extension_id: '*', environment: QUALIF_API, value: '1' },
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

test('working reads are cached for a short time, fresh reads and writes bypass it', async () => {
  const scope = scopeC00();
  await readSettings(scope, { decrypt: true });
  await readSettings(scope, { decrypt: true });
  assert.equal(calls.length, 6, 'second read served from the cache');
  await readSettings(scope, { decrypt: true, fresh: true });
  assert.equal(calls.length, 12, 'fresh read goes to the API');
  await writeSettings(scope, { smtp_host: 'smtp.y' });
  calls = [];
  await readSettings(scope, { decrypt: true });
  assert.equal(calls.length, 6, 'a write clears the cache');
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
    const expired = body.token === 'tok-1' && orders.length === 1;
    return new Response(JSON.stringify(expired ? { message: 'expired' } : { id: 'ORD1' }), { status: expired ? 401 : 200 });
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
    /Compte API OneStock introuvable dans l'API Settings pour le site c00/,
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

test('values entered at install are saved for the site and API URL of the context at the first opening', async () => {
  rows = [
    // installation (Hub callback without site): extension ext1
    { key: 'onestock_user_id', site_id: '', extension_id: 'ext1', environment: 'hub-install', value: 'hub-user' },
    { key: 'onestock_password', site_id: '', extension_id: 'ext1', environment: 'hub-install', value: 'hub-pass' },
    { key: 'smtp_host', site_id: '', extension_id: 'ext1', environment: 'hub-install', value: 'smtp.hub' },
    { key: 'smtp_port', site_id: '', extension_id: 'ext1', environment: 'hub-install', value: '465' },
    { key: 'smtp_from', site_id: '', extension_id: 'other', environment: 'hub-install', value: 'other-extension' },
    // already entered for the site and API URL: kept
    { key: 'smtp_host', site_id: 'p0039', extension_id: 'ext1', environment: OTHER_QUALIF_API, value: 'smtp.site' },
  ];
  const scope = scopeOf({ site_id: 'p0039', extension_id: 'ext1', api_url: OTHER_QUALIF_API });
  const { from_install: fromInstall, created, settings } = await readOrInitializeSettings(scope, { decrypt: true });
  assert.deepEqual(fromInstall.sort(), ['onestock_password', 'onestock_user_id', 'smtp_port']);
  const puts = calls.filter((c) => c.method === 'PUT').map((c) => Object.fromEntries(c.url.searchParams));
  assert.deepEqual(
    puts.map((p) => [p.key, p.site_id, p.extension_id, p.environment]).sort(),
    [
      ['onestock_password', 'p0039', 'ext1', OTHER_QUALIF_API],
      ['onestock_user_id', 'p0039', 'ext1', OTHER_QUALIF_API],
      ['smtp_port', 'p0039', 'ext1', OTHER_QUALIF_API],
    ],
  );
  assert.equal(settings.smtp_host.value, 'smtp.site', 'a value of the site is never overwritten');
  assert.equal(settings.smtp_port.value, '465');
  assert.equal(settings.onestock_user_id.value, 'hub-user');
  assert.equal(settings.smtp_from.value, '', 'values of another extension are ignored');
  assert.ok(!created.includes('smtp_port'), 'install values come before the defaults');

  // the same installation opened on another API URL gets its own copy
  const prod = await readOrInitializeSettings(
    scopeOf({ site_id: 'p0039', extension_id: 'ext1', api_url: 'https://api.onestock-retail.com' }),
    { decrypt: true },
  );
  assert.ok(prod.from_install.includes('onestock_user_id'));
  assert.equal(prod.settings.smtp_host.value, 'smtp.hub');

  // second opening: nothing left to copy
  calls = [];
  clearSettingsCache();
  assert.deepEqual((await readOrInitializeSettings(scope, { decrypt: true })).from_install, []);
  assert.ok(calls.every((c) => c.method !== 'PUT'));
});

test('install values saved without the OneStock extension id are found at the first opening', async () => {
  rows = [
    { key: 'onestock_user_id', site_id: '', extension_id: 'com.onestock.invoice-email', environment: 'hub-install', value: 'hub-user' },
    { key: 'smtp_host', site_id: '', extension_id: 'com.onestock.invoice-email', environment: 'hub-install', value: 'smtp.hub' },
  ];
  const scope = scopeOf({ site_id: 'p0039', extension_id: '6aedd70d65e829c2464a632e', api_url: OTHER_QUALIF_API });
  const { from_install: fromInstall, settings } = await readOrInitializeSettings(scope, { decrypt: true });
  assert.deepEqual(fromInstall.sort(), ['onestock_user_id', 'smtp_host']);
  assert.equal(settings.smtp_host.value, 'smtp.hub');
  assert.equal(settings.onestock_user_id.value, 'hub-user');
});

test('the settings page is saved entirely for the key of the context, and used by the app', async () => {
  rows = [];
  const scope = scopeOf({ site_id: 'p0039', extension_id: 'ext1', api_url: `${OTHER_QUALIF_API}/` });
  const page = {
    onestock_user_id: 'api-user',
    onestock_password: 'api-pass',
    onestock_api_root: OTHER_QUALIF_API,
    smtp_host: 'smtp.gmail.com',
    smtp_port: '587',
    smtp_secure: 'false',
    smtp_user: '',
    smtp_password: '',
    smtp_from: 'f@x.io',
    smtp_bcc: '',
    email_subject: 'Facture {{order_id}}',
    email_body: 'Bonjour',
    context_site_id: 'forged', // never taken from the page
  };
  const saved = await saveContextSettings(scope, page);
  assert.ok(!saved.includes('smtp_password'), 'an empty password keeps the stored one');
  assert.ok(saved.includes('smtp_user') && saved.includes('smtp_bcc'), 'empty fields are saved too');
  const puts = calls.filter((c) => c.method === 'PUT').map((c) => ({ ...Object.fromEntries(c.url.searchParams), value: c.body.value }));
  assert.ok(puts.every((p) => p.site_id === 'p0039' && p.extension_id === 'ext1' && p.environment === OTHER_QUALIF_API));
  assert.equal(puts.find((p) => p.key === 'context_site_id').value, 'p0039');
  assert.equal(puts.find((p) => p.key === 'context_api_url').value, OTHER_QUALIF_API);

  // the app uses exactly these values
  const { config } = await loadRuntimeConfig({ site_id: 'p0039', extension_id: 'ext1', api_url: OTHER_QUALIF_API });
  assert.deepEqual([config.onestock.user_id, config.onestock.password, config.smtp.host, config.smtp.from], ['api-user', 'api-pass', 'smtp.gmail.com', 'f@x.io']);

  // incomplete context: refused
  await assert.rejects(saveContextSettings(scopeOf({ extension_id: 'ext1' }), page), /Contexte incomplet/);
});
