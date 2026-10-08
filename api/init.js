import { methods, readBody } from '../lib/http.js';
import { getOrder } from '../lib/onestock.js';
import { orderSummary } from '../lib/order.js';
import { scopeOf, readOrInitializeSettings, runtimeConfig, publicSettings } from '../lib/settings.js';

/**
 * Everything the screen needs when it opens, in one call:
 * POST /api/init { context: { site_id, extension_id, api_url, environment, lang, order_id } }
 *   → { scope, created, settings (secrets masked), order | null, order_error | null }
 * Settings are read once (and initialised on the first connection), then the order is loaded with them.
 */
export default methods({
  async POST(req) {
    const context = readBody(req).context || {};
    const scope = scopeOf(context);
    const { created, settings } = await readOrInitializeSettings(scope, { decrypt: true });
    const result = {
      scope: { siteId: scope.siteId, extensionId: scope.extensionId, environment: scope.environment },
      created,
      settings: publicSettings(settings),
      order: null,
      order_error: null,
    };
    const orderId = String(context.order_id || '').trim();
    if (!orderId || !scope.siteId || !settings.onestock_token.set) return result;
    try {
      const order = await getOrder(runtimeConfig(settings, scope), {
        orderId,
        siteId: scope.siteId,
        apiUrl: String(context.api_url || '').trim(),
        lang: context.lang,
      });
      result.order = orderSummary(order, orderId);
    } catch (err) {
      result.order_error = err.message;
    }
    return result;
  },
});
