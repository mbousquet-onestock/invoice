import { methods, readBody } from '../lib/http.js';
import { mask } from '../lib/log.js';
import { scopeOf, writeSettings, SETTING_KEYS } from '../lib/settings.js';
import { INSTALL_SETTINGS, SCOPE_FIELDS } from '../lib/manifest.js';

/**
 * install_url of the manifest: callbacks of the OneStock Hub (installed, updated, settings_updated…).
 *
 * PROVISIONAL — written without CALLBACKS.md: the signature is not verified (unknown format) and the payload
 * fields are read defensively. Every callback is logged (masked); settings received in clear are saved in the
 * Settings API under the same keys, for the site / environment found in the callback (all sites otherwise).
 * Encrypted settings (settings_jwe) are not readable: no callback_encryption_key is declared.
 * Answers 2xx, except when received settings cannot be saved: the Hub then shows the error to the installer and
 * undoes the installation (or does not save the change), as described in MANIFEST.md.
 */
const KNOWN = new Set(INSTALL_SETTINGS.map((f) => f.key).filter((key) => key in SETTING_KEYS));

function pick(body, ...paths) {
  for (const path of paths) {
    const value = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), body);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
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
    const body = readBody(req);
    const event = pick(body, 'event', 'type', 'callback');
    console.log(JSON.stringify({ type: 'hub_callback', event: event ?? null, body: mask(body) }));

    const raw = pick(body, 'settings', 'installation.settings', 'data.settings');
    const settings = raw && typeof raw === 'object' ? raw : {};
    const values = settingsValues(settings);
    if (!Object.keys(values).length) {
      return { ok: true, event: event ?? null, saved: [], ...(body.settings_jwe ? { warning: 'settings_jwe non lus' } : {}) };
    }
    // Site and environment entered at install (manifest fields site_id / api_url) come first, then the callback.
    const scope = scopeOf({
      site_id: pick(settings, 'site_id') ?? pick(body, 'site_id', 'extension.site_id', 'installation.site_id', 'instance.site_id', 'context.site_id') ?? '',
      // OneStock extension entity ({ "extension": { "id": … } }): the extension_id the iframe receives.
      extension_id: pick(body, 'extension_id', 'extension.id', 'installation.extension_id', 'instance.extension_id'),
      environment: pick(body, 'environment', 'installation.environment', 'instance.environment'),
      api_url: pick(settings, 'api_url') ?? pick(body, 'api_url', 'api_root', 'installation.api_url', 'instance.api_url', 'context.api_url'),
    });
    // The API account (onestock_user_id / onestock_password) belongs to a site and an API URL: without a site in
    // the callback it cannot be filed. The other settings are still saved and the installation is not undone.
    const account = Object.keys(values).filter((key) => SETTING_KEYS[key]?.account);
    let warning;
    if (account.length && !scope.siteId) {
      for (const key of account) delete values[key];
      warning = `Compte API OneStock non enregistré : site_id absent de l'appel du Hub (${account.join(', ')})`;
      console.warn(JSON.stringify({ type: 'hub_callback', level: 'warn', event: event ?? null, warning }));
    }
    // The API URL entered at install is the API of this site: the account and the calls use it.
    if (settings.api_url && SCOPE_FIELDS.includes('api_url')) values.onestock_api_root = String(settings.api_url);
    const saved = await writeSettings(scope, values);
    return {
      ok: true,
      event: event ?? null,
      saved,
      ...(warning ? { warning } : {}),
      scope: { siteId: scope.siteId, extensionId: scope.extensionId, environment: scope.environment },
    };
  },
  // Lets the Hub (or a person) check that the endpoint is reachable.
  GET: async () => ({ ok: true }),
});
