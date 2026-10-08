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
    const { created, settings } = await readOrInitializeSettings(scope, { fresh: true });
    return { scope: publicScope(scope), created, settings: publicSettings(settings) };
  },
  async PUT(req) {
    const body = readBody(req);
    const scope = scopeOf(body.context);
    const saved = await writeSettings(scope, body.values);
    return { scope: publicScope(scope), saved, settings: publicSettings(await readSettings(scope, { fresh: true })) };
  },
});

function publicScope({ siteId, extensionId, environment }) {
  return { siteId, extensionId, environment };
}
