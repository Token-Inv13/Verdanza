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

### Regles Firestore

`firestore.rules` prepare :

- lecture publique des produits actifs uniquement ;
- ecriture produits admin uniquement ;
- commandes visibles par admin ou par le client concerne ;
- stocks, settings, coupons, fournisseurs et rapports modifiables admin uniquement ;
- acces `adminUsers` reserve aux admins.

## Phase 4 prevue

- Emails transactionnels et notifications.
- Remboursements Stripe automatiques.
- Historique detaille des statuts de commande.
- Optimisation du bundle et code-splitting admin.

## Deploiement Vercel

Parametres du projet :

- Framework Preset : `Vite`
- Root Directory : `./`
- Install Command : `npm install`
- Build Command : `npm run build`
- Output Directory : `dist`

Variables client :

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
```

Variables serveur :

```env
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
FIREBASE_SERVICE_ACCOUNT_BASE64=
```

Rappels :

- ne jamais versionner `.env.local` ;
- ne jamais exposer de cle serveur avec le prefixe `VITE_` ;
- configurer le webhook Stripe apres le premier deploy Vercel ;
- tester localement avec `npm run lint`, `npm run typecheck:api`, `npm run build`.
