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

Un setting est identifié par `key` + `site_id` + `extension_id` + `environment` :

- `site_id` et `extension_id` viennent du contexte OneStock ; `environment` est déduit de `api_url`
  (`*.api.qualif.onestock-retail.com` ou `api-qualif.onestock-retail.com` → `qualif`, sinon `prod`), ou forcé par
  `?environment=` ;
- à la lecture, la priorité est : ce site + cette extension → ce site + `*` → tous les sites (`site_id` vide puis
  `*`) + cette extension → tous les sites + `*` → valeur par défaut ;
- **repli prod → qualif** : en `prod`, une clé sans valeur dans aucun des niveaux ci-dessus est reprise de `qualif`
  (même ordre). Les écritures restent dans l'environnement courant, et la première connexion ne crée pas en `prod`
  une clé qui existe déjà en `qualif` ;
- **token OneStock par `POST {url}/login`** : le token est obtenu avec le compte API du site,
  `{ "password", "site_id", "user_id" }`, sur la même URL que les autres appels (`…/v3/login`). Il est gardé en
  mémoire de l'instance (par URL, site et compte) et redemandé une fois sur un 401. Le compte (`onestock_user_id`,
  `onestock_password`) est un paramètre : **un compte par `site_id` et URL d'API**, enregistré avec `site_id` = le
  site, `extension_id` = `*` et `environment` = l'origine de l'URL de l'API (`onestock_api_root`, sinon l'`api_url`
  du contexte, ex. `https://c00.api.qualif.onestock-retail.com`). Il est **demandé à l'installation par le Hub**
  (champs `onestock_user_id` et `onestock_password` du manifeste) et modifiable depuis la page de l'installation ;
  il est aussi saisissable dans l'écran Paramètres, le Hub n'envoyant pas toujours d'appel à l'installation. Il n'est
  jamais créé automatiquement ;
- à l'écriture, `onestock_api_root` est enregistré pour le site et toutes les extensions (`*`), les autres
  pour le site et cette extension. Seuls les champs modifiés sont écrits (`PUT /api/settings/item?upsert=1`) ;
  un secret laissé vide conserve la valeur enregistrée.

**Première connexion** : à l'ouverture, les clés qui n'existent à aucun niveau sont créées (`POST /api/settings`)
avec leur valeur par défaut, `onestock_api_root` prenant l'URL d'API reçue du contexte. Les secrets
(`smtp_password`) et le compte API OneStock ne sont pas créés : l'app signale si le compte du site est à saisir.

| Clé | Niveau | Rôle |
| --- | --- | --- |
| `onestock_user_id`, `onestock_password` 🔒 | site, `*`, environnement = origine de l'URL d'API | Compte de l'API OneStock (token via `POST /login`) |
| `onestock_api_root` | site, `*` | Racine de l'API OneStock (sinon URL du contexte) ; `/v3` ajouté si aucune version n'est précisée |
| `smtp_host`, `smtp_port`, `smtp_secure`, `smtp_user`, `smtp_password` 🔒, `smtp_from`, `smtp_bcc` | site, extension | Serveur d'envoi |
| `email_subject`, `email_body` | site, extension | Modèle d'email (`{{order_id}}`, `{{first_name}}`, `{{last_name}}`, `{{email}}`) |

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

La commande et le site ID viennent uniquement du contexte OneStock. Pour tester hors OneStock :
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

`POST /` (routé vers `/api/hub`) reçoit les appels du Hub (`installed`, `updated`, `settings_updated`…) : il les journalise
(`hub_callback`, secrets masqués) et enregistre dans l'API Settings les paramètres reçus en clair, pour le site et
l'environnement indiqués par l'appel ; le compte API OneStock est rangé pour le `site_id` et l'URL d'API (`api_url`)
de l'appel. Si l'appel ne contient pas de `site_id`, le compte n'est pas enregistré (avertissement `warning` dans la
réponse et les logs), le reste l'est et l'installation n'est pas annulée. **Provisoire** : il a été écrit sans `CALLBACKS.md` ; la signature des appels
n'est pas vérifiée et les champs du corps sont lus de façon défensive. Aucune `callback_encryption_key` n'est
déclarée : le Hub envoie donc les paramètres en clair dans l'appel signé (avec un avertissement à la validation).

## Déploiement

Importer le dépôt dans Vercel (framework Vite, sortie `dist/`, fonctions `api/`) ou `vercel deploy`.
Communiquer ensuite l'URL Vercel à votre contact OneStock pour déclarer l'extension avec un anchor `bo.order.action`
(path `/`), et définir `SETTINGS_API_KEY` dans les variables d'environnement du projet. `vercel.json` autorise l'affichage en iframe (`frame-ancestors *`).
