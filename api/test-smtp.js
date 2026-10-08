import { methods, readBody } from '../lib/http.js';
import { verifySmtp } from '../lib/mailer.js';
import { loadRuntimeConfig } from '../lib/settings.js';

export default methods({
  async POST(req) {
    const { config } = await loadRuntimeConfig(readBody(req).context);
    await verifySmtp(config.smtp);
    return { ok: true };
  },
});
