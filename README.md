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
```

- Le navigateur n'appelle jamais OneStock directement : tous les appels passent par `POST /api/onestock-proxy`
  `{ method, path, body, site_id, api_url }`. Le proxy ajoute `site_id` et le token, et utilise
  `POST` + `X-HTTP-Method-Override: GET` pour les routes GET à body.
- `api/send-invoice` relit la commande côté serveur : seules les factures de la commande peuvent être envoyées.
- L'URL de l'API est, par ordre de priorité : celle forcée dans les paramètres, celle reçue du contexte (`api_url`),
  sinon `https://{site_id}.api.qualif.onestock-retail.com` (ou `api.onestock-retail.com` en production).

## Paramètres

Accessibles via le bouton « Paramètres », masqué juste à gauche de « Envoyer la facture » (il apparaît au survol). Le système de fichiers Vercel n'étant pas persistant, les paramètres sont enregistrés dans le navigateur
(localStorage) et envoyés avec chaque appel :

- **API OneStock** : token, ou identifiant / mot de passe (token obtenu par `POST /login` et mis en cache), version,
  site ID par défaut, environnement, URL forcée ;
- **SMTP** : hôte, port, TLS, utilisateur, mot de passe, expéditeur, copie cachée (bouton « Tester le SMTP ») ;
- **Modèle d'email** : objet et message, variables `{{order_id}}`, `{{first_name}}`, `{{last_name}}`, `{{email}}`.

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
npm test           # tests unitaires (lecture de la commande, proxy)
npm run typecheck
```

La commande et le site ID viennent uniquement du contexte OneStock. Pour tester hors OneStock : `http://localhost:5173/?site_id=c00&order_id=ORD000001`.

## Déploiement

Importer le dépôt dans Vercel (framework Vite, sortie `dist/`, fonctions `api/`) ou `vercel deploy`.
Communiquer ensuite l'URL Vercel à votre contact OneStock pour déclarer l'extension avec un anchor `bo.order.action`
(path `/`). `vercel.json` autorise l'affichage en iframe (`frame-ancestors *`).
