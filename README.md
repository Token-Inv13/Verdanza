# Verdanza CBD

Base e-commerce Verdanza : boutique CBD premium, livraison postale, livraison express locale a Aix-en-Provence, panier local, cockpit admin connectable Firestore, et preparation Firebase/Stripe.

## Stack

- React + Vite + TypeScript
- Tailwind CSS
- React Router
- Firebase client prepare : Auth, Firestore, Storage, Analytics optionnel
- Stripe client prepare via `loadStripe`
- Architecture compatible Vercel

## Installation

```bash
npm install
npm run dev
```

## Variables d'environnement

Copier `.env.example` vers `.env.local` puis renseigner les valeurs locales. Ne jamais versionner `.env.local`.

La cle `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` doivent rester cote serveur uniquement. Elles ne doivent jamais etre exposees en variable `VITE_`.

## Scripts

```bash
npm run lint
npm run typecheck:api
npm run build
npm run seed:products -- --yes
npm run seed:admin -- --yes
npm run seed:admin-auth -- --yes
```

## Stripe Checkout

Le flux Stripe Checkout reel est implemente en Phase 3 :

- `api/create-checkout-session.ts` recoit uniquement `productId`, `quantity`, livraison et informations client.
- Le serveur relit les produits Firestore, refuse les produits inactifs, verifie le stock et recalcule tous les prix.
- Une commande Firestore est creee en `paymentStatus: pending` et `orderStatus: pending`.
- Une session Stripe Checkout est creee, puis `stripeSessionId` est stocke sur la commande.
- `api/stripe-webhook.ts` verifie la signature Stripe, traite `checkout.session.completed`, passe la commande en paiement confirme, decremente le stock et cree les mouvements de stock.
- Le webhook est idempotent via `stripeEventIds` et ne deduit pas le stock deux fois si une commande est deja payee.

Variables requises :

```env
VITE_STRIPE_PUBLIC_KEY=""
STRIPE_SECRET_KEY=""
STRIPE_WEBHOOK_SECRET=""
VITE_APP_URL=""
```

Variables Firebase Admin serveur, au choix :

```env
FIREBASE_PROJECT_ID=""
FIREBASE_CLIENT_EMAIL=""
FIREBASE_PRIVATE_KEY=""
```

Ou :

```env
FIREBASE_SERVICE_ACCOUNT_BASE64=""
```

Ne jamais exposer `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` ou une cle Firebase Admin avec le prefixe `VITE_`.

### Test Stripe

En local avec Stripe CLI :

```bash
stripe login
stripe listen --forward-to localhost:5173/api/stripe-webhook
```

Copier le webhook secret affiche dans `STRIPE_WEBHOOK_SECRET`.

Pour tester un paiement :

1. Seeder les produits Firestore depuis l'admin.
2. Ajouter un produit au panier.
3. Completer `/checkout`.
4. Payer avec une carte test Stripe, par exemple `4242 4242 4242 4242`.
5. Verifier `/checkout/success`.
6. Verifier dans l'admin que la commande est visible, payee, en preparation, et que le stock a baisse.

Avec le serveur Vite seul, les fonctions `/api` ne sont pas executees comme sur Vercel. Utiliser Vercel local/dev ou deployer sur Vercel pour tester les routes serverless de bout en bout.

## Firebase

Les collections prevues sont documentees dans les types TypeScript : `products`, `categories`, `orders`, `customers`, `stockMovements`, `deliveryZones`, `coupons`, `settings`, `adminUsers`, `supplierProducts`, `labReports`.

Les fichiers JSON de service account Firebase sont ignores par `.gitignore`.

### Phase 2 Firestore

La couche Firestore est dans `src/services/`.

- `productsService` lit les produits actifs cote public, lit tous les produits cote admin, et retombe sur `src/data/products.ts` si Firestore est vide ou indisponible.
- `deliveryZonesService` lit les zones Firestore avec fallback local.
- `ordersService` prepare la collection `orders` et garde les commandes mockees si aucune commande Firestore n'existe.
- `stockMovementsService` prepare les mouvements de stock.
- `adminUsersService` verifie les droits admin via la collection `adminUsers`.

Le seed initial est manuel et non destructif : bouton `Seed manuel Phase 1` dans l'admin. Il utilise `setDoc(..., { merge: true })` et ne supprime aucune donnee Firestore.

### Bootstrap admin

Les routes `/admin` utilisent Firebase Auth. Un utilisateur connecte doit aussi exister dans `adminUsers` avec `isActive: true`.

Pour le premier admin, creer manuellement un document dans Firestore depuis la console Firebase ou un environnement serveur controle :

```json
{
  "email": "admin@example.com",
  "role": "owner",
  "isActive": true
}
```

L'identifiant du document peut etre l'UID Firebase Auth ou l'email exact. Les regles Firestore fournies dans `firestore.rules` bloquent la creation du premier admin depuis le client afin d'eviter une elevation de privileges.

## Authentification client

L'authentification client utilise Firebase Auth et supporte :

- email / mot de passe ;
- Google Auth ;
- reset mot de passe depuis `/connexion` ;
- espace compte protege.

Routes publiques :

- `/connexion` ;
- `/inscription`.

Routes compte protegees :

- `/compte` ;
- `/compte/commandes` ;
- `/compte/profil`.

Lorsqu'un utilisateur se connecte ou s'inscrit, l'application cree ou met a jour `customers/{uid}` avec :

- `uid` ;
- `email` ;
- `displayName` ;
- `phone` ;
- `createdAt` ;
- `updatedAt` ;
- `loyaltyPoints: 0` ;
- `orderCount: 0` ;
- `totalSpent: 0` ;
- `role: "customer"`.

Le checkout invite reste possible. Si le client est connecte, le frontend transmet un ID token Firebase a `/api/create-checkout-session`. La fonction serverless verifie ce token avec Firebase Admin et rattache la commande a `customerId = uid`. Les commandes client sont ensuite visibles dans `/compte/commandes` uniquement pour ce `uid`.

La base fidelite est preparee cote donnees seulement. Aucune promesse fidelite complete n'est affichee publiquement.

## Bootstrap admin Auth

Le document Firestore `adminUsers/token.invest13@gmail.com` donne les droits admin, mais l'utilisateur Firebase Auth doit aussi exister pour pouvoir se connecter.

Commande :

```bash
BOOTSTRAP_ADMIN_EMAIL="token.invest13@gmail.com" npm run seed:admin-auth -- --yes
```

Sur PowerShell :

```powershell
$env:BOOTSTRAP_ADMIN_EMAIL="token.invest13@gmail.com"; npm run seed:admin-auth -- --yes
```

Pour definir ou reinitialiser un mot de passe temporaire localement :

```powershell
$env:BOOTSTRAP_ADMIN_EMAIL="token.invest13@gmail.com"
$env:BOOTSTRAP_ADMIN_TEMP_PASSWORD="mot-de-passe-temporaire-local"
npm run seed:admin-auth -- --yes
```

Precautions :

- ne jamais coder le mot de passe dans le repo ;
- ne jamais afficher le mot de passe dans les logs ;
- ne jamais stocker le mot de passe dans Firestore ;
- ne jamais versionner `.env.local` ou un service account Firebase ;
- si le compte existe deja, utiliser aussi `Mot de passe oublie` sur `/admin` ou `/connexion`.

## Seed Firestore production

Le seed production doit etre execute depuis un environnement local controle avec Firebase Admin. Il ne doit jamais passer par le client public.

Prerequis :

- `.env.local` ignore par Git ;
- variables Firebase Admin presentes :
  - `FIREBASE_SERVICE_ACCOUNT_BASE64`, ou
  - `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` ;
- acces Vercel CLI au projet `verdanza`, si les variables sont tirees depuis Vercel.

Recuperer les variables production Vercel, si necessaire :

```bash
npx vercel env pull .env.local --environment=production --scope token-inv13s-projects
```

Seeder les produits initiaux :

```bash
npm run seed:products -- --yes
```

Le script :

- lit `src/data/products.ts` ;
- ecrit dans `products` avec `setDoc(..., { merge: true })` ;
- ne supprime aucun document ;
- preserve le stock Firestore existant quand un produit existe deja ;
- cree les produits absents avec leur stock placeholder initial ;
- verifie que chaque produit seed est actif, a un slug et un stock numerique ;
- affiche seulement un resume sans secret.

Creer le premier admin :

```bash
BOOTSTRAP_ADMIN_EMAIL="admin@example.com" npm run seed:admin -- --yes
```

Sur PowerShell :

```powershell
$env:BOOTSTRAP_ADMIN_EMAIL="admin@example.com"; npm run seed:admin -- --yes
```

Optionnellement, `BOOTSTRAP_ADMIN_UID` peut etre fourni si l'UID Firebase Auth est connu. Sinon le document est cree avec l'email comme identifiant, ce qui est supporte par `adminUsersService` et `firestore.rules`.

Precautions :

- ne jamais commiter `.env.local` ;
- ne jamais commiter un service account Firebase ;
- ne jamais afficher les cles Firebase Admin ou Stripe ;
- verifier le `projectId` affiche par le script avant de valider le resultat ;
- ne pas relancer le seed produits pour corriger un stock commercial sans verifier les valeurs existantes.

Verification apres seed :

1. `npm run seed:products -- --yes` doit afficher 9 produits verifies.
2. `POST /api/create-checkout-session` ne doit plus retourner `Produit introuvable ou catalogue Firestore non initialise.`
3. La boutique production doit afficher les produits depuis Firestore ou fallback local, avec IDs compatibles panier/API.
4. L'admin connecte doit acceder aux produits et commandes si son document `adminUsers/{email}` ou `adminUsers/{uid}` est actif.

## Validation paiement reel

URL production :

```text
https://verdanza-opal.vercel.app
```

Procedure :

1. Ouvrir la production et valider l'age gate.
2. Ajouter un produit actif au panier.
3. Ouvrir `/checkout`.
4. Saisir un client test et choisir la livraison postale.
5. Verifier la redirection Stripe Checkout.
6. Payer avec la carte test Stripe `4242 4242 4242 4242`, une date future et un CVC quelconque.
7. Verifier le retour `/checkout/success`.
8. Verifier dans Firestore :
   - commande creee dans `orders` ;
   - `paymentStatus: "paid"` ;
   - `orderStatus: "preparing"` ;
   - `stripeSessionId`, `stripePaymentIntentId` et `stripeEventIds` renseignes ;
   - stock produit decremente ;
   - mouvement cree dans `stockMovements`.
9. Verifier dans `/admin` que la commande apparait, que les infos client et produits sont correctes, puis tester la modification de statut et la note interne.

Webhook Stripe :

- l'evenement attendu est `checkout.session.completed` ;
- l'endpoint production est `/api/stripe-webhook` ;
- une signature invalide doit retourner `400 Invalid Stripe signature.` ;
- le traitement est idempotent via `stripeEventIds` et `paymentStatus: "paid"`.

### Regles Firestore

`firestore.rules` prepare :

- lecture publique des produits actifs uniquement ;
- ecriture produits admin uniquement ;
- commandes visibles par admin ou par le client concerne ;
- stocks, settings, coupons, fournisseurs et rapports modifiables admin uniquement ;
- acces `adminUsers` reserve aux admins.

## Phase 4 - emails, suivi commande et remboursements

Emails transactionnels :

- les emails sont envoyes cote serveur via Resend ;
- `RESEND_API_KEY` et `EMAIL_FROM` sont requis pour envoyer ;
- `ADMIN_NOTIFICATION_EMAIL` recoit la notification interne de nouvelle commande payee ;
- si les variables email sont absentes, le checkout et le webhook continuent sans bloquer le paiement ;
- aucun secret email n'est expose cote client.

Evenements envoyes :

- confirmation client apres `checkout.session.completed` ;
- notification admin apres paiement confirme ;
- email client lors d'un changement de statut admin ;
- email client apres remboursement Stripe initie.

Historique de statut :

- chaque commande contient `statusHistory` ;
- la creation ajoute `pending` ;
- le webhook Stripe ajoute `preparing` apres paiement ;
- l'admin ajoute une entree a chaque changement de statut ;
- les clients voient le suivi dans `/compte/commandes` sans note interne.

Remboursements :

- l'endpoint serveur `/api/refund-order` exige un token Firebase admin valide ;
- seules les commandes `paymentStatus: "paid"` avec `stripePaymentIntentId` sont remboursables ;
- l'admin peut choisir de remettre le stock en place ;
- un mouvement `stockMovements` de type `return` est cree si le restock est active ;
- la commande passe en `paymentStatus: "refunded"` et `orderStatus: "refunded"`.

Verification Phase 4 :

1. Configurer `RESEND_API_KEY`, `EMAIL_FROM` et `ADMIN_NOTIFICATION_EMAIL` dans Vercel Production et Preview.
2. Payer une commande test Stripe.
3. Verifier que le webhook conserve `paymentStatus: "paid"`, `orderStatus: "preparing"`, le decrement stock et `stockMovements`.
4. Verifier que `statusHistory` contient `pending` puis `preparing`.
5. Se connecter admin, changer le statut, puis verifier la nouvelle entree `statusHistory`.
6. Verifier `/compte/commandes` avec le compte client lie a la commande.
7. Tester `/api/update-order-status` et `/api/refund-order` sans token : les endpoints doivent refuser.

## Deploiement Vercel

Parametres du projet :

- Framework Preset : `Vite`
- Root Directory : `./`
- Install Command : `npm install`
- Build Command : `npm run build`
- Output Directory : `dist`

Variables a ajouter dans Vercel, en `Production` et `Preview` :

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
VITE_STRIPE_PUBLIC_KEY=
VITE_APP_URL=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
FIREBASE_SERVICE_ACCOUNT_BASE64=
RESEND_API_KEY=
EMAIL_FROM=
ADMIN_NOTIFICATION_EMAIL=
```

Rappels :

- ne jamais versionner `.env.local` ;
- ne jamais exposer de cle serveur avec le prefixe `VITE_` ;
- configurer le webhook Stripe apres le premier deploy Vercel ;
- tester localement avec `npm run lint`, `npm run typecheck:api`, `npm run build`.
