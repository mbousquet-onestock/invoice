# Extension OneStock – Envoi de facture

Extension UI OneStock (anchor `bo.order.action`) qui :

1. récupère le contexte OneStock (paramètres d'URL + handshake `extension_ready` / `onestock_data`) : `order_id`, `site_id`, `api_url` ;
2. lit la commande via l'API OneStock (`GET /v3/orders/{id}`) **au travers d'un proxy Vercel** ;
3. affiche les factures trouvées dans `information.invoice` (une URL, une liste, ou des objets `{ url }`) ;
4. envoie les factures sélectionnées en pièce jointe par email à l'adresse de facturation
   (`pricing_details.address.contact.email`, à défaut `customer.email`).

Conformément à la demande, **la signature de l'extension n'est pas vérifiée** (pas de sécurité).

## Architecture (Vercel)

```
navigateur (iframe OneStock)             Vercel
 └─ Vue 3 + design system OneStock ─▶ api/onestock-proxy.js ─▶ API OneStock
                                      api/send-invoice.js    ─▶ API OneStock + téléchargement facture + SMTP
                                      api/test-smtp.js       ─▶ SMTP
                                      api/settings.js        ─▶ API Settings (lecture / écriture des paramètres)
```

- Le navigateur n'appelle jamais OneStock directement : tous les appels passent par `POST /api/onestock-proxy`
  `{ method, path, body, site_id, api_url }`. Le proxy ajoute `site_id` et le token, et utilise
  `POST` + `X-HTTP-Method-Override: GET` pour les routes GET à body.
- Les identifiants OneStock et SMTP sont lus par les fonctions dans l'API Settings (voir ci-dessous).
- `api/send-invoice` relit la commande côté serveur : seules les factures de la commande peuvent être envoyées.
- L'URL de l'API est, par ordre de priorité : `onestock_api_root`, celle reçue du contexte (`api_url`),
  sinon `https://{site_id}.api.qualif.onestock-retail.com` (ou `api.onestock-retail.com` en production).

## Paramètres (API Settings)

Tous les paramètres de fonctionnement sont stockés dans l'**API Settings** de l'application Extensions
(`https://extensions-lemon.vercel.app/api/settings`, base Postgres Vercel). Cette API n'est appelée que par les
fonctions Vercel : la clé d'API et les secrets déchiffrés n'atteignent jamais le navigateur.

Un setting est identifié par `key` + `site_id` + `extension_id` + `environment` :

- `site_id` et `extension_id` viennent du contexte OneStock ; `environment` est déduit de `api_url`
  (`*.api.qualif.onestock-retail.com` → `qualif`, sinon `prod`), ou forcé par `?environment=` ;
- à la lecture, la priorité est : ce site + cette extension → ce site + `*` → tous les sites + cette extension →
  tous les sites + `*` → valeur par défaut ;
- à l'écriture, les paramètres OneStock sont enregistrés pour le site et toutes les extensions (`*`), les autres
  pour le site et cette extension. Seuls les champs modifiés sont écrits (`PUT /api/settings/item?upsert=1`) ;
  un secret laissé vide conserve la valeur enregistrée.

**Première connexion** : à l'ouverture, les clés qui n'existent à aucun niveau sont créées (`POST /api/settings`)
avec leur valeur par défaut, `onestock_api_root` prenant l'URL d'API reçue du contexte. Les secrets
(`onestock_token`, `smtp_password`) ne sont pas créés sans valeur : l'app signale alors que `onestock_token` est
à renseigner.

| Clé | Niveau | Rôle |
| --- | --- | --- |
| `onestock_token` 🔒 | site, `*` | Token de l'API OneStock |
| `onestock_api_root` | site, `*` | Racine de l'API OneStock (sinon URL du contexte) ; `/v3` ajouté si aucune version n'est précisée |
| `smtp_host`, `smtp_port`, `smtp_secure`, `smtp_user`, `smtp_password` 🔒, `smtp_from`, `smtp_bcc` | site, extension | Serveur d'envoi |
| `email_subject`, `email_body` | site, extension | Modèle d'email (`{{order_id}}`, `{{first_name}}`, `{{last_name}}`, `{{email}}`) |

🔒 chiffré par l'API Settings, lu avec `decrypt=1` côté serveur uniquement.

### Variables d'environnement Vercel

| Variable | Valeur |
| --- | --- |
| `SETTINGS_API_KEY` | Clé déclarée dans `SETTINGS_API_KEYS` du projet Extensions (obligatoire) |
| `SETTINGS_API_URL` | Par défaut `https://extensions-lemon.vercel.app/api/settings` |
| `EXTENSION_ID` | `extension_id` utilisé hors contexte OneStock (défaut `invoice`) |
| `SETTINGS_ENVIRONMENT` | Environnement par défaut sans `api_url` (défaut `qualif`) |

Côté application Extensions, `SETTINGS_API_KEYS` et `SETTINGS_ENCRYPTION_KEY` doivent être définies (sinon 503 /
`encryption_key_missing`). En local, mettre ces variables dans `.env.local` (voir `.env.example`).

## Design system OneStock

Le code importe les composants depuis l'alias `#ds` (`OsButton`, `OsTabs`, `OsInputText`, `OsSelect`, `OsAlert`…) :

- si `@onestock-public/design-system` est installé, c'est lui qui est utilisé (avec sa CSS) ;
- sinon, `src/ds/fallback` fournit des composants de même nom, mêmes props et mêmes tokens visuels, pour que l'app
  se construise sans accès au registre privé.

Pour utiliser le vrai paquet (registre Google Artifact Registry, cf. Quick start du design system) :

```bash
gcloud auth application-default login
npx google-artifactregistry-auth --registry https://europe-west4-npm.pkg.dev/os-tools-abm42i/os-npm-public \
  --scope @onestock-public --repo-config .npmrc
npm install @onestock-public/design-system
```

Sur Vercel, ajouter un `.npmrc` qui lit le token depuis une variable d'environnement :

```
@onestock-public:registry=https://europe-west4-npm.pkg.dev/os-tools-abm42i/os-npm-public/
//europe-west4-npm.pkg.dev/os-tools-abm42i/os-npm-public/:_authToken=${NPM_TOKEN}
```

(le token gcloud expire au bout d'une heure : utiliser un compte de service pour les builds Vercel).

## Développement

```bash
npm install
npm run dev        # Vite + fonctions /api servies localement (pas besoin de la CLI Vercel)
npm test           # tests unitaires (commande, proxy, API Settings)
npm run typecheck
```

La commande et le site ID viennent uniquement du contexte OneStock. Pour tester hors OneStock :
`http://localhost:5173/?site_id=c00&order_id=ORD000001&extension_id=invoice&environment=qualif`.

## Déploiement

Importer le dépôt dans Vercel (framework Vite, sortie `dist/`, fonctions `api/`) ou `vercel deploy`.
Communiquer ensuite l'URL Vercel à votre contact OneStock pour déclarer l'extension avec un anchor `bo.order.action`
(path `/`), et définir `SETTINGS_API_KEY` dans les variables d'environnement du projet. `vercel.json` autorise l'affichage en iframe (`frame-ancestors *`).
