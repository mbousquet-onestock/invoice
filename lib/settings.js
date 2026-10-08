/**
 * Settings are entered in the Settings tab and kept in the browser (Vercel has no persistent file system):
 * they are sent with each API call. Missing fields fall back on these defaults.
 */
export const DEFAULT_SETTINGS = {
  onestock: {
    api_url: '',
    environment: 'qualif',
    api_version: 'v3',
    auth_mode: 'token',
    token: '',
    user_id: '',
    password: '',
    default_site_id: '',
  },
  smtp: {
    host: '',
    port: 587,
    secure: false,
    user: '',
    password: '',
    from: '',
    bcc: '',
  },
  email: {
    subject: 'Votre facture pour la commande {{order_id}}',
    body:
      'Bonjour {{first_name}} {{last_name}},\n\n' +
      'Veuillez trouver ci-joint la facture de votre commande {{order_id}}.\n\n' +
      'Cordialement,\nLe service client',
  },
};

export function withDefaults(settings, base = DEFAULT_SETTINGS) {
  const out = { ...base };
  for (const [key, value] of Object.entries(settings || {})) {
    if (!(key in base)) continue;
    out[key] = base[key] && typeof base[key] === 'object' ? withDefaults(value, base[key]) : value;
  }
  return out;
}
