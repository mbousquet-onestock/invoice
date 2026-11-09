import { methods, readBody, readQuery } from '../lib/http.js';
import { scopeOf, readSettings, readOrInitializeSettings, writeSettings, publicSettings } from '../lib/settings.js';

/**
 * GET /api/settings?site_id=&extension_id=&api_url=&environment=
 *     → settings of the context (secrets masked); missing keys are created on the first connection
 * PUT /api/settings { context, values: { key: value } } → each key written at its level (see targetOf)
 */
export default methods({
  async GET(req) {
    const scope = scopeOf(readQuery(req));
    const { created, from_install: fromInstall, settings } = await readOrInitializeSettings(scope, { fresh: true });
    return { scope: publicScope(scope, settings), created, from_install: fromInstall, settings: publicSettings(settings) };
  },
  async PUT(req) {
    const body = readBody(req);
    const scope = scopeOf(body.context);
    // The OneStock API account can be entered here too: the Hub does not always send its install callback.
    const saved = await writeSettings(scope, body.values);
    const settings = await readSettings(scope, { fresh: true });
    return { scope: publicScope(scope, settings), saved, settings: publicSettings(settings) };
  },
});

function publicScope({ siteId, extensionId, environment }, settings) {
  return { siteId, extensionId, environment, apiOrigin: settings?.onestock_user_id?.api_origin };
}
