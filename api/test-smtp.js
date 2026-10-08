import { methods, readBody } from '../lib/http.js';
import { verifySmtp } from '../lib/mailer.js';
import { loadRuntimeConfig } from '../lib/settings.js';

export default methods({
  async POST(req) {
    // Always fresh: the SMTP test usually follows a change of the settings.
    const { config } = await loadRuntimeConfig(readBody(req).context, { fresh: true });
    await verifySmtp(config.smtp);
    return { ok: true };
  },
});
