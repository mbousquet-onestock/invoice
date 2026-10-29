import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mask, maskUrl, logApiError, MASK } from './log.js';

test('mask hides sensitive values at any depth and in JSON strings', () => {
  const masked = mask({
    site_id: 'c00',
    token: 'abc',
    nested: { smtp_password: 'p', list: [{ onestock_token: 't', key: 'onestock_token', value: 'enc:v1:xyz' }] },
    raw: '{"token":"abc","fields":["id"]}',
    empty_token: '',
  });
  assert.equal(masked.site_id, 'c00');
  assert.equal(masked.token, MASK);
  assert.equal(masked.nested.smtp_password, MASK);
  assert.equal(masked.nested.list[0].onestock_token, MASK);
  assert.equal(masked.nested.list[0].key, 'onestock_token', 'key names are kept');
  assert.equal(masked.nested.list[0].value, MASK, 'encrypted values are masked');
  assert.deepEqual(JSON.parse(masked.raw), { token: MASK, fields: ['id'] });
  assert.equal(masked.empty_token, '');
});

test('maskUrl hides credentials and sensitive query parameters', () => {
  assert.equal(
    maskUrl('https://u:p@x.io/api/settings?key=onestock_token&token=abc&site_id=c00'),
    `https://x.io/api/settings?key=onestock_token&token=${MASK}&site_id=c00`,
  );
});

test('logApiError writes one JSON line with status, duration and masked bodies', () => {
  const lines = [];
  const original = { error: console.error, warn: console.warn };
  console.error = (line) => lines.push(['error', line]);
  console.warn = (line) => lines.push(['warn', line]);
  try {
    logApiError({
      api: 'OneStock API',
      method: 'GET',
      url: 'https://c00.api.qualif.onestock-retail.com/v3/orders/X',
      status: 404,
      startedAt: Date.now() - 12,
      request: { site_id: 'c00', token: 'secret' },
      response: { message: 'not found' },
      error: 'not found',
    });
    logApiError({ api: 'Settings API', method: 'POST', status: 409, error: 'already_exists', handled: true });
  } finally {
    Object.assign(console, original);
  }
  const [level, line] = lines[0];
  const entry = JSON.parse(line);
  assert.equal(level, 'error');
  assert.equal(entry.type, 'api_error');
  assert.equal(entry.api, 'OneStock API');
  assert.equal(entry.status, 404);
  assert.ok(entry.duration_ms >= 12);
  assert.equal(entry.request_body.token, MASK);
  assert.ok(!line.includes('secret'));
  assert.equal(lines[1][0], 'warn', 'handled errors are warnings');
});
