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
 └─ Vue 3 + design system OneStock ─▶ api/init.js           ─▶ API Settings + API OneStock (ouverture de l'écran)
                                      api/onestock-proxy.js ─▶ API OneStock
                                      api/send-invoice.js    ─▶ API OneStock + téléchargement facture + SMTP
                                      api/test-smtp.js       ─▶ SMTP
                                      api/settings.js        ─▶ API Settings (lecture / écriture des paramètres)
```

- Le navigateur n'appelle jamais OneStock directement : tous les appels passent par `POST /api/onestock-proxy`
  `{ method, path, body, site_id, api_url }`. Le proxy ajoute `site_id` et le token (obtenu par `POST /login`), et utilise
  `POST` + `X-HTTP-Method-Override: GET` pour les routes GET à body.
- Les identifiants OneStock et SMTP sont lus par les fonctions dans l'API Settings (voir ci-dessous).
- À l'ouverture, un seul appel `POST /api/init` lit les paramètres (une fois), les initialise si besoin et charge la
  commande.
- Performances : l'API Settings est lue avec un appel par site (ce site, `""`, `*`) et par environnement, et les
  lectures des appels de travail sont mises en cache 30 s dans l'instance (`SETTINGS_CACHE_TTL_MS`, `0` pour
  désactiver). L'écran Paramètres et le test SMTP lisent toujours des valeurs fraîches ; toute écriture vide le cache.
- `api/send-invoice` relit la commande côté serveur : seules les factures de la commande peuvent être envoyées.
- L'URL de l'API est, par ordre de priorité : `onestock_api_root`, celle reçue du contexte (`api_url`),
  sinon `https://{site_id}.api.qualif.onestock-retail.com` (ou `api.onestock-retail.com` en production).

## Paramètres (API Settings)

Tous les paramètres de fonctionnement sont stockés dans l'**API Settings** de l'application Extensions
(`https://extensions-lemon.vercel.app/api/settings`, base Postgres Vercel). Cette API n'est appelée que par les
fonctions Vercel : la clé d'API et les secrets déchiffrés n'atteignent jamais le navigateur.

Un setting est identifié par `key` + `site_id` + `extension_id` + `environment`. **La clé est le contexte de
l'extension** : `site_id` = le site du contexte, `extension_id` = l'extension du contexte, `environment` = l'origine de
l'`api_url` du contexte (ex. `https://api-qualif.onestock-retail.com` ; à défaut l'URL construite depuis le site).

- **Écran Paramètres** : « Enregistrer » sauvegarde **toutes les données de la page** sous cette clé, avec le contexte
  lui-même (`context_site_id`, `context_api_url`) ; un mot de passe laissé vide conserve celui enregistré. **Ce sont
  les données utilisées par l'app** : elles sont lues en premier. Le contexte doit fournir (ou on saisit) le site et
  l'URL d'API, sinon l'enregistrement est refusé ;
- à la lecture, la priorité est : la clé du contexte (ce site + cette extension + cette URL d'API), puis ce site +
  `*`, puis tous les sites (`site_id` vide puis `*`), d'abord pour l'URL d'API puis pour le nom d'environnement
  (`qualif`, `prod`…, convention de l'application Extensions), puis la valeur par défaut. Les valeurs saisies ailleurs
  (application Extensions) sont donc reprises tant que la page n'a pas été enregistrée ;
- **token OneStock par `POST {url}/login`** avec le compte de la page (`onestock_user_id`, `onestock_password`) :
  `{ "password", "site_id", "user_id" }` sur `…/v3/login`, gardé en mémoire de l'instance et redemandé une fois sur
  un 401.

**Première connexion** : à l'ouverture, les clés qui n'existent à aucun niveau sont créées sous la clé du contexte
(`POST /api/settings`) avec leur valeur par défaut, `onestock_api_root` prenant l'URL d'API reçue du contexte, et le
contexte est enregistré (`context_site_id`, `context_api_url`). Les secrets
(`smtp_password`) et le compte API OneStock ne sont pas créés : l'app signale si le compte du site est à saisir.

| Clé (écrites sous la clé du contexte : site, extension, URL d'API) | Lue aussi | Rôle |
| --- | --- | --- |
| `context_site_id`, `context_api_url` | — | Le contexte (site, URL d'API) |
| `onestock_user_id`, `onestock_password` 🔒 | site + `*`, tous les sites, `qualif` / `prod` | Compte de l'API OneStock (token via `POST /login`) |
| `onestock_api_root` | site + `*`, tous les sites | Racine de l'API OneStock (sinon URL du contexte) ; `/v3` ajouté si aucune version n'est précisée |
| `smtp_host`, `smtp_port`, `smtp_secure`, `smtp_user`, `smtp_password` 🔒, `smtp_from`, `smtp_bcc` | tous les sites | Serveur d'envoi |
| `email_subject`, `email_body` | tous les sites | Modèle d'email (`{{order_id}}`, `{{first_name}}`, `{{last_name}}`, `{{email}}`) |

🔒 chiffré par l'API Settings (`enc:v1:…`, AES-256-GCM), lu côté serveur uniquement : avec `decrypt=1`, et si une
valeur revient encore chiffrée (ou si l'API ne peut pas déchiffrer), elle est déchiffrée localement par
`lib/settings-secrets.js` (module fourni par l'application Extensions) avec `SETTINGS_ENCRYPTION_KEY`.

### Variables d'environnement Vercel

| Variable | Valeur |
| --- | --- |
| `SETTINGS_API_KEY` | Clé déclarée dans `SETTINGS_API_KEYS` du projet Extensions (obligatoire) |
| `SETTINGS_ENCRYPTION_KEY` | Même valeur que dans l'application Extensions (déchiffrement local des secrets) |
| `SETTINGS_API_URL` | Par défaut `https://extensions-lemon.vercel.app/api/settings` |
| `EXTENSION_ID` | `extension_id` utilisé hors contexte OneStock (défaut `invoice`) |
| `SETTINGS_ENVIRONMENT` | Environnement par défaut sans `api_url` (défaut `qualif`) |
| `SETTINGS_CACHE_TTL_MS` | Durée du cache des paramètres en ms (défaut `30000`, `0` = sans cache) |
| `EXTENSION_URL` | Origine https de production publiée dans le manifeste (défaut : origine du déploiement) |
| `EXTENSION_TEST_URL` | Origine https utilisée par les environnements OneStock hors production (facultatif) |

Côté application Extensions, `SETTINGS_API_KEYS` et `SETTINGS_ENCRYPTION_KEY` doivent être définies (sinon 503 /
`encryption_key_missing`). En local, mettre ces variables dans `.env.local` (voir `.env.example`).

## Logs des erreurs d'API

Toute erreur d'API est écrite dans les logs des fonctions Vercel (projet → **Logs**, rechercher `api_error`), au
format de l'onglet « Logs API » de l'application Extensions : une ligne JSON par erreur avec l'API, la méthode,
l'URL, le statut, la durée et les corps de requête / réponse, les valeurs sensibles (token, mot de passe, clé,
valeurs `enc:v1:`…) étant remplacées par `••••••••`.

| `api` | Erreurs journalisées |
| --- | --- |
| `Settings API` | Statut ≠ 2xx ou API injoignable, `decrypt_error`, échec du déchiffrement local |
| `OneStock API` | Statut ≠ 2xx ou API injoignable |
| `Facture` | Téléchargement de la facture en échec |
| `SMTP` | Connexion (`VERIFY`) ou envoi (`SEND`) en échec, avec hôte, port, mode TLS et utilisateur |
| `Extension` | Réponse d'erreur d'une route `/api/*` de l'application |

Dans l'écran, une erreur de l'API OneStock affiche aussi un bloc **« Détails (appel et retour) »** : méthode, URL et
corps envoyés (token masqué), statut et corps de la réponse.

Les erreurs que l'application rattrape (`already_exists` à l'initialisation, `decrypt=1` refusé puis relecture des
valeurs brutes) sont journalisées en `warn` avec `"handled": true`, les autres en `error`. Les appels à l'API
Settings apparaissent en plus, côté application Extensions, dans son onglet « Logs API ».

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

La commande, le site ID et l'URL de l'API viennent du contexte OneStock. **S'il ne fournit pas le site ou l'URL de
l'API**, l'écran propose de les saisir (mémorisés dans le navigateur, modifiables avec « Modifier »). Pour tester hors
OneStock :
`http://localhost:5173/?site_id=c00&order_id=ORD000001&extension_id=invoice&environment=qualif`.

## Manifeste OneStock Hub

L'extension publie son manifeste (schéma version 1, cf. `MANIFEST.md` du Hub) à
`https://<déploiement>/.well-known/onestock-extension.json`, en `application/json` sans redirection : fichier
statique généré au build (`dist/.well-known/`, origine tirée de `EXTENSION_URL`, sinon du domaine de production
Vercel `VERCEL_PROJECT_PRODUCTION_URL`), avec en secours la réécriture vers `api/manifest.js` (local, origine inconnue). Un administrateur du catalogue OneStock ajoute l'extension en collant cette
URL ; le Hub la relit chaque jour.

| Champ | Valeur |
| --- | --- |
| `id` | `com.onestock.invoice-email` (définitif) |
| `name` | `Facture`, comme l'extension déjà déclarée dans OneStock (**ne jamais changer** : clés de traduction du Back Office) |
| `version` | celle de `package.json` : **à augmenter à chaque modification du manifeste** |
| `category` | `Communication` |
| `urls.production` / `urls.test` | `EXTENSION_URL` / `EXTENSION_TEST_URL`, sinon l'origine du déploiement |
| `icon` | `/icon.png` (PNG 256 px) |
| `install_url` | racine du déploiement (`https://<host>`) : les `POST /` sont routés vers `api/hub.js` (`routes` de `vercel.json`) ; pas de `settings.url`, les `settings_updated` arrivent aussi à `install_url` |
| `requires.onestock_api` | `true` (compte API OneStock du site, token via `POST /login`) |
| `injection_points` | `bo.order.action`, nom `Facture`, slug `facture`, path `/`, rank `1` (identiques à OneStock) |
| `settings` | compte API OneStock (`onestock_user_id`, `onestock_password`, obligatoires), serveur SMTP et modèle d'email, avec **les mêmes clés que l'API Settings** |

`POST /` (routé vers `/api/hub`) reçoit les appels du Hub (`installed`, `updated`, `settings_updated`…). Le corps
est lu quel que soit son format : JSON, jeton signé JWS (`header.payload.signature`, non vérifié), ou JSON
enveloppant un jeton / `payload` / `data` ; les paramètres peuvent être un objet `{ clé: valeur }` ou une liste
`[{ key, value }]`. Le site et l'URL de l'API **viennent du contexte de l'iframe**, que le Hub ne connaît pas : les
valeurs sont gardées pour l'installation (API Settings, `site_id` vide, `environment` = `hub-install`,
`extension_id` = celui de l'appel, sinon `com.onestock.invoice-email`), puis **recopiées pour le site, l'extension et
l'URL d'API du contexte à la première ouverture** (avant les valeurs par défaut, sans écraser l'existant). Si l'appel
contient un `site_id`, elles sont enregistrées directement pour ce site.

**Diagnostic** : `GET /api/hub` indique ce que contenait le dernier appel du Hub (date, événement, type de contenu,
noms des champs et des paramètres reçus, paramètres enregistrés, avertissement éventuel), sans aucune valeur. Chaque
appel est aussi journalisé (`hub_callback`, secrets masqués).

## Déploiement

Importer le dépôt dans Vercel (framework Vite, sortie `dist/`, fonctions `api/`) ou `vercel deploy`.
Communiquer ensuite l'URL Vercel à votre contact OneStock pour déclarer l'extension avec un anchor `bo.order.action`
(path `/`), et définir `SETTINGS_API_KEY` dans les variables d'environnement du projet. `vercel.json` autorise l'affichage en iframe (`frame-ancestors *`).
