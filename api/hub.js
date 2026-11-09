import { methods, readBody } from '../lib/http.js';
import { mask } from '../lib/log.js';
import {
  scopeOf,
  writeSettings,
  saveInstallValues,
  saveHubDiagnostic,
  readHubDiagnostic,
  HUB_EXTENSION_ID,
  SETTING_KEYS,
} from '../lib/settings.js';
import { INSTALL_SETTINGS } from '../lib/manifest.js';

/**
 * install_url of the manifest (POST / is routed here): callbacks of the OneStock Hub (installed, updated,
 * settings_updated…).
 *
 * Written without CALLBACKS.md: the signature is not verified and the payload is read defensively (JSON, signed
 * JWS token, payload wrapped in `payload` / `data` / `jws`…). Settings received in clear are saved in the Settings
 * API under the same keys: for the site / API URL of the callback when it has them, else for the installation
 * (copied for each site / API URL at the first opening, see lib/settings.js).
 * Every callback is logged (masked) and summed up, without values, in a diagnostic readable with GET /api/hub.
 * Encrypted settings (settings_jwe) are not readable: no callback_encryption_key is declared.
 */
const KNOWN = new Set(INSTALL_SETTINGS.map((f) => f.key).filter((key) => key in SETTING_KEYS));
const JWS = /^[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]*$/;

function pick(body, ...paths) {
  for (const path of paths) {
    const value = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), body);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/** Payload of a compact JWS (header.payload.signature), not verified. */
function jwsPayload(token) {
  const match = typeof token === 'string' && token.trim().match(JWS);
  if (!match) return null;
  try {
    return JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** The callback as an object, whatever its envelope: JSON, JWS token, or JSON wrapping a token / payload. */
export function callbackBody(raw) {
  let body = raw;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    const text = body.trim();
    body = jwsPayload(text) ?? (() => {
      try {
        return text ? JSON.parse(text) : {};
      } catch {
        return { raw: text.slice(0, 200) };
      }
    })();
  }
  if (!body || typeof body !== 'object') return {};
  for (const key of ['jws', 'token', 'signed', 'payload', 'data']) {
    const inner = body[key];
    const decoded = typeof inner === 'string' ? jwsPayload(inner) ?? (() => { try { return JSON.parse(inner); } catch { return null; } })() : null;
    if (decoded && typeof decoded === 'object') return { ...body, ...decoded };
  }
  return body;
}

/** Settings of the callback: object { key: value } or list [{ key, value }]. */
function settingsOf(body) {
  const raw = pick(
    body,
    'settings',
    'installation.settings',
    'data.settings',
    'payload.settings',
    'values',
    'configuration',
    'installation.values',
  );
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw.filter((item) => item && item.key).map((item) => [item.key, item.value]));
  }
  return raw && typeof raw === 'object' ? raw : {};
}

/** Hub values (strings, numbers, booleans) as Settings API strings; unknown keys are ignored. */
export function settingsValues(settings) {
  return Object.fromEntries(
    Object.entries(settings || {})
      .filter(([key, value]) => KNOWN.has(key) && value !== undefined && value !== null)
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : String(value)]),
  );
}

export default methods({
  async POST(req) {
    const body = callbackBody(req.body ?? readBody(req));
    const event = pick(body, 'event', 'type', 'callback', 'name') ?? null;
    console.log(
      JSON.stringify({ type: 'hub_callback', event, content_type: req.headers?.['content-type'] ?? null, body: mask(body) }),
    );

    const settings = settingsOf(body);
    const values = settingsValues(settings);
    const scope = scopeOf({
      site_id: pick(body, 'site_id', 'extension.site_id', 'installation.site_id', 'instance.site_id', 'context.site_id') ?? '',
      // OneStock extension entity ({ "extension": { "id": … } }): the extension_id the iframe receives.
      extension_id:
        pick(body, 'extension_id', 'extension.id', 'installation.extension_id', 'instance.extension_id') ?? HUB_EXTENSION_ID,
      environment: pick(body, 'environment', 'installation.environment', 'instance.environment'),
      api_url: pick(body, 'api_url', 'api_root', 'installation.api_url', 'instance.api_url', 'context.api_url'),
    });
    const summary = { siteId: scope.siteId, extensionId: scope.extensionId, apiUrl: scope.siteId ? scope.apiOrigin : null };

    let saved = [];
    let savedFor = null;
    let warning;
    if (Object.keys(values).length) {
      if (scope.siteId) {
        saved = await writeSettings(scope, values);
        savedFor = 'site';
      } else {
        // Site and API URL come from the context of the iframe: the values are kept for the installation and
        // copied for each site / API URL the first time the extension opens there.
        saved = await saveInstallValues(scope.extensionId, values);
        savedFor = 'installation';
      }
    } else {
      warning = body.settings_jwe
        ? 'Paramètres chiffrés (settings_jwe) : illisibles sans callback_encryption_key'
        : "Aucun paramètre connu dans l'appel du Hub";
      console.warn(JSON.stringify({ type: 'hub_callback', level: 'warn', event, warning }));
    }

    // Diagnostic without any value: names of what was received and of what was saved.
    await saveHubDiagnostic({
      at: new Date().toISOString(),
      event,
      content_type: req.headers?.['content-type'] ?? null,
      body_keys: Object.keys(body),
      settings_keys: Object.keys(settings),
      saved,
      saved_for: savedFor,
      scope: summary,
      ...(warning ? { warning } : {}),
    }).catch((err) => console.error(JSON.stringify({ type: 'hub_callback', level: 'error', error: err.message })));

    return { ok: true, event, saved, saved_for: savedFor, scope: summary, ...(warning ? { warning } : {}) };
  },
  // Reachability check, and what the last Hub callback contained (key names only, never values).
  async GET() {
    return { ok: true, last_callback: await readHubDiagnostic().catch(() => null) };
  },
});
