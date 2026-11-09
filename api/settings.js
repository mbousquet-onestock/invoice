import { methods, readBody, readQuery } from '../lib/http.js';
import { scopeOf, readSettings, readOrInitializeSettings, saveContextSettings, publicSettings } from '../lib/settings.js';

/**
 * GET /api/settings?site_id=&extension_id=&api_url=&environment=
 *     → settings of the context (secrets masked); missing keys are created on the first connection
 * PUT /api/settings { context, values: { key: value } } → all the values of the page saved for the context
 */
export default methods({
  async GET(req) {
    const scope = scopeOf(readQuery(req));
    const { created, from_install: fromInstall, settings } = await readOrInitializeSettings(scope, { fresh: true });
    return { scope: publicScope(scope), created, from_install: fromInstall, settings: publicSettings(settings) };
  },
  async PUT(req) {
    const body = readBody(req);
    const scope = scopeOf(body.context);
    // All the values of the page, saved for the context (site, extension, API URL): the values the app uses.
    const saved = await saveContextSettings(scope, body.values);
    const settings = await readSettings(scope, { fresh: true });
    return { scope: publicScope(scope), saved, settings: publicSettings(settings) };
  },
});

function publicScope({ siteId, extensionId, envName, apiOrigin }) {
  return { siteId, extensionId, environment: envName, apiOrigin };
}
