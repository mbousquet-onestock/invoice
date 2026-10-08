import { methods, readBody, readQuery } from '../lib/http.js';
import { scopeOf, readSettings, writeSettings, publicSettings } from '../lib/settings.js';

/**
 * GET  /api/settings?site_id=&extension_id=&api_url=&environment=  → settings of the context (secrets masked)
 * PUT  /api/settings { context, target: { site_id, extension_id }, values: { key: value } }
 */
export default methods({
  async GET(req) {
    const scope = scopeOf(readQuery(req));
    return { scope, settings: publicSettings(await readSettings(scope)) };
  },
  async PUT(req) {
    const body = readBody(req);
    const scope = scopeOf(body.context);
    const saved = await writeSettings(scope, body.target, body.values);
    return { scope, saved, settings: publicSettings(await readSettings(scope)) };
  },
});
