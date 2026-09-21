# Checkout partagé : préparation Stripe Test

Cette étape extrait les dépendances du formulaire, sans raccorder Stripe au checkout public et sans modifier le backend métier.

## Composition actuelle

`App.tsx` charge toujours la route `/checkout`, désormais via `checkout/ManualCheckoutPage.tsx`. Ce composant fournit à l'unique formulaire `pages/CheckoutPage.tsx` :

- le panier de `useCart()` et l'identité de `useAuth()` ;
- `quoteOrder` existant, donc `/api/quote-order` ;
- `submitManualOrder`, alias de `createCheckoutOrder`, donc `/api/create-order`, avec Auth, le contrat complet de réponse et les erreurs structurées actuelles ;
- les hooks publics `useCagnotteCheckout` et `useCheckoutAttempt`, sans modification de leurs contrôleurs, marqueurs de reprise ni règles d'acceptation ;
- les zones et données de secours existantes ;
- les analytics, le contexte anti-abus et la révocation analytics existants ;
- l'autocomplétion habituelle, les contacts et les bannières existantes ;
- les mêmes clés localStorage/sessionStorage et la même navigation success.

Le composant partagé reçoit trois props obligatoires : `cart`, `identity`, `dependencies`. Il n'a pas de services de production par défaut. La route publique sélectionne explicitement la composition manuelle ; aucun paramètre d'URL, localStorage ou indicateur Test ne change cette sélection.

`checkoutDependencies.ts` ne contient que des types. Les références aux types Auth, panier, analytics et requête serveur sont effacées à la compilation. `formatEuro` est extrait dans un module pur puis réexporté par `quoteService`, pour conserver les imports existants sans importer le transport manuel dans le formulaire partagé.

`AddressAutocomplete` accepte une fabrique `createSearch`. Sa valeur par défaut conserve le coordinateur externe existant. Le formulaire partagé reçoit explicitement cette fabrique depuis ses dépendances.

## Configuration locale raccordée

`stripe-test/checkoutConfiguration.ts` exporte `createLocalTestCheckoutConfiguration`. L'entrée locale `stripe-test/main.tsx` monte `StripeTestApp` avec un routeur indépendant. `/stripe-test/checkout` affiche le même `CheckoutPage` ; aucune copie du formulaire n'existe. L'application publique n'importe jamais cette fabrique.

Elle fournit :

- une identité invitée, sans objet utilisateur Firebase, et un formulaire initial fictif `@example.invalid` ;
- un catalogue et des zones provenant exclusivement des API de l'émulateur local ;
- analytics inactives, contacts/bannières externes absents, une suggestion d'adresse fictive d'Aix sans requête externe ;
- des clés exclusivement préfixées `verdanza:stripe-checkout-test:v1:` pour panier, coupon, tentative et résumé ;
- devis, soumission, statut et reprise via `/api/stripe-test/*` sur l'origine locale fixe ;
- carte uniquement et liens de navigation locaux. Les valeurs par défaut de ces options conservent les comportements publics.

L'échec du catalogue affiche une erreur, jamais un repli Firestore ou catalogue public. Aucun transport ni URL arbitraire ne peut être fourni à cette fabrique. Elle exige une compilation de développement et l'origine exacte `http://127.0.0.1:5195`. Les opérations de stockage et de données revérifient l'origine. Les requêtes refusent les redirections et n'envoient pas de cookies.

Ces garde-fous frontend ne remplacent pas les contrôles serveur : `demo-verdanza-stripe`, émulateur obligatoire, clé Test, serveur local, API métier exclues. Aucun booléen transmis par le client ne détermine la destination Firebase. Le serveur local ignore `.env` et la configuration Vite publique ; les connexions navigateur sont limitées par CSP à la même origine.

## Soumission et retours

Le résultat manuel `CheckoutOrderResult` conserve sa finalisation existante : résumé serveur, montant payable, cagnotte, statuts, analytics et navigation. Les soumissions incertaines et reprises restent gérées par le contrôleur public récent. Le résultat Test `{redirectUrl}` déclenche la redirection dédiée avant toute finalisation manuelle. Un verrou synchrone du formulaire empêche les doubles envois pendant le devis final et la soumission. L'adapter Test conserve un UUID et un jeton par tentative ; les essais identiques réutilisent la session, les changements de panier/coordonnées/sélection de cadeau créent une autre tentative. Le serveur contrôle aussi le fingerprint et l'idempotence Stripe.

L'adaptation est basée sur `2b4ca8003af7e11f8c796bbeff7021a303974963`. Les devis publics conservent l'email, les sélections promotionnelles, les cadeaux et la cagnotte. La cagnotte n'est pas disponible pour l'invité Test : hook inerte sans Auth, et refus serveur d'une demande `cagnotteUse`. Les sélections de cadeaux Test sont transmises au moteur de prix commun, qui lit uniquement l'émulateur. Aucun module métier public, concours, cagnotte ou Firebase Admin n'est remplacé par sa version ancienne.

`testCart.ts` réutilise les fonctions communes de formats fixes et de stock pour la présentation. Le prix définitif est recalculé par `priceCheckout` dans le serveur Test. Les écritures n'atteignent que `stripeTestOrders` et `stripeTestEvents` ; aucune fonction de finalisation métier de production n'est appelée.

Les retours Test lisent un statut serveur autorisé par un jeton hors URL. Seul le webhook signé confirme `paid`. Cancel conserve le panier et permet de reprendre la session encore ouverte ; expiration et commande inaccessible sont gérées sans création silencieuse de paiement. Voir [le guide local](./stripe-test-local.md).

`CheckoutSuccessPage.tsx` et `CheckoutCancelPage.tsx` publics sont inchangés et ne sont pas montés dans l'entrée locale Test.

## Vérifications

```powershell
npm run lint
npx tsc --noEmit -p tsconfig.app.json --incremental false
npx tsc --noEmit -p tsconfig.node.json --incremental false
npm run test:stripe-test:adapters
npm run test:stripe-test:ui
npm run typecheck:stripe-test
npm run test:checkout-payment-options
npm run build
```

Le test d'adapters utilise uniquement des réponses HTTP simulées, des stockages en mémoire et une compilation Vite sans serveur HTTP ni fichier d'environnement. Il vérifie les endpoints/payloads manuels, les erreurs, l'isolation du stockage, les tentatives Test, les redirections, le rejet d'autres origines et d'un build de production, ainsi que les imports runtime du formulaire et de la configuration locale.

Le test DOM affiche le véritable formulaire partagé pour les deux scénarios de référence, intercepte toutes les requêtes (y compris la redirection Stripe), vérifie le double envoi, cancel, success et le rafraîchissement. Aucun paiement réseau n'est effectué. Les tests serveur simulés utilisent un émulateur distinct sur `127.0.0.1:18087` ; voir le guide local.

Le build standard régénère `public/sitemap.xml` et écrit ses artefacts dans `dist`. Contrôler ensuite le diff du sitemap. Le prérendu existant bloque Firebase et les analytics. Les tests de commande existants utilisent des mocks. Aucun paiement ou effet métier réel n'est nécessaire à ces vérifications.
