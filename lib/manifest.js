/**
 * OneStock extension manifest (schema version 1, see the Hub's MANIFEST.md), published at
 * /.well-known/onestock-extension.json. Built per request so that the absolute URLs follow the deployment;
 * EXTENSION_URL / EXTENSION_TEST_URL force them.
 *
 * `version` must be raised (package.json) whenever the content changes: the Hub refuses the same version with a
 * different content. `name` and the slugs must never change (Back Office translation keys and URLs).
 */
import { readFileSync } from 'node:fs';
import { SETTING_KEYS } from './settings.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const MANIFEST_PATH = '/.well-known/onestock-extension.json';

function origin(value) {
  return value ? new URL(value).origin : '';
}

/**
 * Origin of the deployment when no request is at hand (build): EXTENSION_URL, else the production domain Vercel
 * gives the build (VERCEL_PROJECT_PRODUCTION_URL), else the deployment URL (VERCEL_URL). Empty when unknown.
 */
export function deploymentOrigin(env = process.env) {
  if (env.EXTENSION_URL) return origin(env.EXTENSION_URL);
  const host = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  return host ? `https://${host.replace(/^https?:\/\//, '')}` : '';
}

/** Settings asked by the Hub at install; keys are the Settings API keys used by the app. */
export const INSTALL_SETTINGS = [
  {
    key: 'smtp_host',
    label: 'Serveur SMTP',
    type: 'string',
    section: 'Envoi des emails',
    required: true,
    placeholder: 'smtp.gmail.com',
    max_length: 255,
  },
  {
    key: 'smtp_port',
    label: 'Port',
    type: 'integer',
    section: 'Envoi des emails',
    min: 1,
    max: 65535,
    default: Number(SETTING_KEYS.smtp_port.default),
    help: '587 ou 25 : STARTTLS. 465 : TLS direct.',
  },
  {
    key: 'smtp_secure',
    label: 'Connexion TLS directe',
    type: 'boolean',
    section: 'Envoi des emails',
    default: SETTING_KEYS.smtp_secure.default === 'true',
    help: 'Pour les autres ports que 25, 465, 587 et 2525, dont le mode est fixé par le port.',
  },
  { key: 'smtp_user', label: 'Utilisateur SMTP', type: 'string', section: 'Envoi des emails', max_length: 255 },
  {
    key: 'smtp_password',
    label: 'Mot de passe SMTP',
    type: 'secret',
    section: 'Envoi des emails',
    help: "Pour Gmail : mot de passe d'application (16 caractères).",
  },
  {
    key: 'smtp_from',
    label: 'Expéditeur',
    type: 'string',
    section: 'Envoi des emails',
    required: true,
    placeholder: 'Service client <factures@example.com>',
    max_length: 255,
  },
  { key: 'smtp_bcc', label: 'Copie cachée', type: 'email', section: 'Envoi des emails' },
  {
    key: 'email_subject',
    label: "Objet de l'email",
    type: 'string',
    section: "Modèle d'email",
    default: SETTING_KEYS.email_subject.default,
    max_length: 200,
    help: 'Variables : {{order_id}}, {{first_name}}, {{last_name}}, {{email}}.',
  },
  {
    key: 'email_body',
    label: "Message de l'email",
    type: 'text',
    section: "Modèle d'email",
    default: SETTING_KEYS.email_body.default,
    max_length: 5000,
    help: 'Variables : {{order_id}}, {{first_name}}, {{last_name}}, {{email}}.',
  },
];

/**
 * @param {string} requestOrigin origin the manifest is served from (used when EXTENSION_URL is not set)
 */
export function buildManifest(requestOrigin, env = process.env) {
  const production = origin(env.EXTENSION_URL) || origin(requestOrigin);
  const test = origin(env.EXTENSION_TEST_URL);
  return {
    schema_version: 1,
    id: 'com.onestock.invoice-email',
    version: pkg.version,
    channel: 'stable',
    // Name and slug of the extension already declared in OneStock: never change them.
    name: 'Facture',
    summary: 'Envoie au client, par email, les factures d’une commande OneStock depuis le détail de la commande.',
    description: [
      'Ajoute une action **Facture** sur le détail des commandes.',
      '',
      '- Récupère les factures de la commande (`information.invoice`).',
      '- Pré-remplit l’email avec l’adresse de facturation et un modèle personnalisable.',
      '- Envoie les factures en pièce jointe via votre serveur SMTP.',
      '',
      'Le serveur SMTP et le modèle d’email sont demandés à l’installation et restent modifiables depuis la page de l’installation ou l’écran Paramètres de l’extension.',
    ].join('\n'),
    category: 'Communication',
    publisher: { name: 'OneStock', url: 'https://onestock-retail.com' },
    icon: `${production}/icon.png`,
    release_notes: 'Première version publiée sur le Hub.',
    urls: { production, ...(test ? { test } : {}) },
    install_url: `${production}/api/hub`,
    requires: { onestock_api: true },
    injection_points: [
      {
        anchor: 'bo.order.action',
        name: 'Facture',
        slug: 'facture',
        path: '/',
        rank: 1,
      },
    ],
    settings: { url: `${production}/api/hub`, fields: INSTALL_SETTINGS },
  };
}
