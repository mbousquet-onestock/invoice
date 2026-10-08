import { postHandler } from '../lib/http.js';
import { verifySmtp } from '../lib/mailer.js';
import { withDefaults } from '../lib/settings.js';

export default postHandler(async (body) => {
  await verifySmtp(withDefaults(body.settings).smtp);
  return { ok: true };
});
