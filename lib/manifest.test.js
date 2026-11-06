import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest, INSTALL_SETTINGS } from './manifest.js';
import { SETTING_KEYS } from './settings.js';

// Rules of MANIFEST.md (schema version 1) that can be checked here.
const CATEGORIES = ['Monitoring', 'B2B & clienteling', 'Data & setup', 'After-sales', 'Orchestration', 'Communication', 'Store operations', 'Other'];
const ANCHORS = ['bo.page', 'bo.order.action', 'bo.orders.action', 'bo.customer.tab', 'bo.customer.information', 'bo.endpoints.action', 'bo.endpoint.tab', 'sa.page'];
const TYPES = ['string', 'text', 'secret', 'integer', 'number', 'boolean', 'select', 'multiselect', 'email', 'url'];
const https = (v) => typeof v === 'string' && v.startsWith('https://');

const manifest = buildManifest('https://invoice.example.app');

test('top-level fields follow the manifest rules', () => {
  assert.equal(manifest.schema_version, 1);
  assert.match(manifest.id, /^[a-z0-9-]+(\.[a-z0-9-]+){1,4}$/);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(['stable', 'preview'].includes(manifest.channel));
  assert.ok(manifest.name.length <= 60);
  assert.equal(manifest.name, 'Facture', 'name of the extension declared in OneStock');
  assert.ok(manifest.summary.length <= 140 && !/[<>*`]/.test(manifest.summary), 'summary: plain text ≤ 140');
  assert.ok(manifest.description.length <= 10000);
  assert.ok(manifest.release_notes.length <= 2000);
  assert.ok(CATEGORIES.includes(manifest.category));
  assert.ok(manifest.publisher.name);
  assert.ok(https(manifest.icon) && https(manifest.urls.production) && https(manifest.install_url) && https(manifest.settings.url));
  assert.equal(manifest.urls.production, 'https://invoice.example.app');
  assert.equal(JSON.stringify(manifest).length < 256 * 1024, true);
  assert.ok(!/password|token|secret_value/i.test(JSON.stringify(manifest.urls)), 'no secret in a public manifest');
});

test('injection points follow the manifest rules', () => {
  const points = manifest.injection_points;
  assert.ok(points.length >= 1 && points.length <= 10);
  assert.equal(new Set(points.map((p) => p.slug)).size, points.length);
  assert.ok(points.some((p) => !p.optional));
  for (const p of points) {
    assert.ok(ANCHORS.includes(p.anchor));
    assert.ok(p.name.length <= 120);
    assert.match(p.slug, /^[a-z0-9][a-z0-9-]{0,63}$/);
    assert.match(p.path, /^\//);
  }
  // Must match the extension already declared in OneStock (name, slug, rank, path).
  assert.deepEqual(
    points.map(({ anchor, name, slug, path, rank }) => ({ anchor, name, slug, path, rank })),
    [{ anchor: 'bo.order.action', name: 'Facture', slug: 'facture', path: '/', rank: 1 }],
  );
});

test('settings asked at install follow the rules and match the Settings API keys', () => {
  const fields = manifest.settings.fields;
  assert.ok(fields.length >= 1 && fields.length <= 50);
  assert.equal(new Set(fields.map((f) => f.key)).size, fields.length);
  for (const f of fields) {
    assert.match(f.key, /^[a-z][a-z0-9_]{0,63}$/);
    assert.ok(f.key in SETTING_KEYS, `${f.key} is a Settings API key of the app`);
    assert.ok(f.label.length <= 60);
    assert.ok(TYPES.includes(f.type));
    assert.ok(!f.section || f.section.length <= 60);
    assert.ok(!f.help || f.help.length <= 300);
    assert.ok(!f.placeholder || f.placeholder.length <= 100);
    if (f.type === 'secret') assert.equal(f.default, undefined, 'no default on a secret');
    if (f.default !== undefined) {
      if (f.type === 'integer') assert.ok(Number.isInteger(f.default) && f.default >= (f.min ?? -Infinity) && f.default <= (f.max ?? Infinity));
      if (f.type === 'boolean') assert.equal(typeof f.default, 'boolean');
      if (['string', 'text'].includes(f.type)) {
        assert.equal(typeof f.default, 'string');
        assert.ok(f.default.length <= (f.max_length ?? (f.type === 'text' ? 10000 : 1000)));
      }
    }
  }
  assert.ok(!('onestock_token' in Object.fromEntries(INSTALL_SETTINGS.map((f) => [f.key, f]))), 'the token comes from the Settings API');
});

test('EXTENSION_URL / EXTENSION_TEST_URL force the URLs', () => {
  const m = buildManifest('https://ignored.vercel.app', {
    EXTENSION_URL: 'https://invoice.onestock.app/',
    EXTENSION_TEST_URL: 'https://invoice-qa.onestock.app',
  });
  assert.equal(m.urls.production, 'https://invoice.onestock.app');
  assert.equal(m.urls.test, 'https://invoice-qa.onestock.app');
  assert.equal(m.install_url, 'https://invoice.onestock.app/api/hub');
  assert.equal(m.icon, 'https://invoice.onestock.app/icon.png');
});

test('hub callback settings are converted to Settings API strings', async () => {
  const { settingsValues } = await import('../api/hub.js');
  assert.deepEqual(settingsValues({ smtp_port: 465, smtp_secure: true, smtp_host: 'smtp.x', unknown: 'x', smtp_bcc: null }), {
    smtp_port: '465',
    smtp_secure: 'true',
    smtp_host: 'smtp.x',
  });
});

test('hub callbacks carrying the OneStock extension entity save under its id', async () => {
  const { scopeOf } = await import('./settings.js');
  process.env.SETTINGS_API_KEY = 'k';
  const puts = [];
  globalThis.fetch = async (url, init) => {
    puts.push(Object.fromEntries(new URL(url).searchParams));
    return new Response(JSON.stringify({ setting: {} }));
  };
  const { default: handler } = await import('../api/hub.js');
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
  await handler(
    {
      method: 'POST',
      url: '/api/hub',
      body: { event: 'installed', environment: 'qualif', extension: { id: '6aedd70d65e829c2464a632e', name: 'Facture' }, settings: { smtp_host: 'smtp.x' } },
    },
    res,
  );
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(puts[0].extension_id, '6aedd70d65e829c2464a632e');
  assert.equal(puts[0].key, 'smtp_host');
  void scopeOf;
});
