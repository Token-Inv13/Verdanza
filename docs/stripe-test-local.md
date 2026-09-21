# Stripe — checkout partagé en environnement local Test

Cette intégration est un parcours de test isolé, pas un moyen de paiement activé sur la boutique publique. Elle ne préjuge pas de l'autorisation commerciale de Stripe. Ne pas créer un autre compte ni modifier les déclarations d'activité pour contourner une restriction.

## Architecture et isolation

`stripe-test.html` charge un panier isolé puis le véritable `CheckoutPage` partagé, via les services de `src/stripe-test/checkoutConfiguration.ts`. Aucun fournisseur Firebase/Auth, analytics, email ou notification de l'application publique n'est monté. Le catalogue provient d'une copie Firestore locale. Le serveur réutilise `priceCheckout` pour les produits actifs, disponibilités, quantités, formats fixes, livraison et remises ; les montants fournis par le navigateur sont ignorés.

Seul le processus local `scripts/stripeTestServer.ts` expose les routes ci-dessous. Elles ne sont pas des fonctions Vercel déployées. Le serveur écoute `127.0.0.1:5195`, valide Host/Origin, refuse les API métier habituelles et utilise exclusivement le projet `demo-verdanza-stripe` à `127.0.0.1:8085`. Il refuse Vercel, NODE_ENV=production et toute clé autre que `sk_test_*`.

Les écritures sont limitées aux collections d'émulateur `stripeTestOrders` et `stripeTestEvents`. Chaque commande porte `isTestOrder: true`. Aucune réservation/décrémentation de stock, utilisation de coupon, facture, commande métier, émission GA4, email, SMS ou WhatsApp n'est déclenchée. Le test des effets métier réels reste une phase séparée avant toute future production.

## Routes locales

| Route | Méthode | Rôle |
|---|---|---|
| `/api/stripe-test/catalog` | GET | Catalogue de la copie locale |
| `/api/stripe-test/delivery-zones` | GET | Zones de la copie locale |
| `/api/stripe-test/quote` | POST | Calcul du panier côté serveur |
| `/api/stripe-test/checkout` | POST | Commande test puis Checkout hébergé, carte seulement |
| `/api/stripe-test/status` | POST | Lecture du statut avec jeton propre à la commande |
| `/api/stripe-test/resume` | POST | Réouvrir uniquement la session Test encore ouverte, après contrôle du jeton |
| `/api/stripe-test/cancel` | POST | Expiration explicite de la session ; le webhook constate l'annulation |
| `/api/stripe-test/webhook` | POST | Vérification de signature sur les octets bruts et traitement transactionnel |

Panier : `http://127.0.0.1:5195/stripe-test` ; formulaire partagé : `/stripe-test/checkout`.
Retour success : `http://127.0.0.1:5195/stripe-test/success?order_id=…`.
Retour cancel : `http://127.0.0.1:5195/stripe-test/cancel?order_id=…`.
Ces retours n'écrivent jamais le statut de paiement. Fermer le navigateur laisse la commande en attente jusqu'à l'expiration de la session (une heure).

Événements nécessaires : `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`. Il n'y a ni abonnement ni moyen de paiement différé dans ce pilote. La réception passe par un relais **Stripe CLI test** éphémère, sans destination publique permanente.

Statuts : `pending` → `payment_pending` → `paid`, `payment_failed` ou `cancelled`. Un échec peut être suivi d'une réussite sur la même session. Une commande payée ne régresse pas sur un événement ancien. La clé d'idempotence Stripe et le document de commande partagent un UUID ; le corps normalisé et un jeton d'accès sont hashés. Une transaction empêche les doubles validations, y compris avec des identifiants d'événement distincts. Les sessions sont relues côté Stripe et corrélées à la commande, au montant, à la devise et au PaymentIntent. Une création interrompue trop ancienne est refusée plutôt que recréée après expiration de l'idempotence Stripe.

## Exécution Windows

Prérequis : Node, Java 21 et les dépendances npm. La dépendance serveur `stripe` est utilisée pour le protocole API et la vérification officielle des signatures ; aucun SDK carte n'est ajouté au frontend.

Préparer un dossier privé hors dépôt, ACL limitées à votre utilisateur et SYSTEM, contenant `stripe-test.key` (clé secrète test). Ne jamais mettre de clé dans une commande, un log, une capture ou une variable `VITE_*`.

Dans des terminaux séparés, depuis la racine :

```powershell
# 1. Émulateur, aucune connexion Firebase Production
./scripts/stripeTestLocal.ps1 -Mode emulator

# 2. Relais Stripe TEST, imprime uniquement un secret masqué
./scripts/stripeTestLocal.ps1 -Mode listen -SecretDirectory <dossier-prive>

# 3. Charger une copie préalablement autorisée du catalogue, puis démarrer
./scripts/stripeTestLocal.ps1 -Mode catalog -SecretDirectory <dossier-prive> -CatalogSnapshot <copie-privee.json>
./scripts/stripeTestLocal.ps1 -Mode server -SecretDirectory <dossier-prive>
```

Le relais écrit `webhook-test.key` dans le dossier privé. Variables serveur : `STRIPE_TEST_ENABLED=true`, `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085`. Aucune variable Vercel ou clé publique frontend n'est nécessaire.

La capture source est une action distante **en lecture seule**, à exécuter uniquement sur autorisation explicite :

```powershell
node --import tsx scripts/stripeTestCatalog.ts capture-readonly <nouvelle-copie-privee.json>
```

Elle utilise `.env.local`, lit seulement produits, zones de livraison et promotions automatiques hors concours, et refuse d'écraser une copie existante. Aucune donnée client ni commande n'est copiée. L'émulateur est volatil : relancer le chargement du catalogue après un arrêt. Ne pas charger la copie dans une base réelle.

Ouvrir `http://127.0.0.1:5195/stripe-test`. L'interface expose les grammes, les formats fixes, Colissimo et la livraison locale. Pour la livraison locale, saisir puis sélectionner « 1 rue du Test local » : les coordonnées d'Aix sont simulées, sans appel externe. Le champ fournisseur conserve le contrat historique `geoplateforme_ban` uniquement dans cette fixture ; il ne constitue pas une vérification réelle d'adresse. Le checkout public reste inchangé.

Utiliser seulement les [cartes officielles Stripe](https://docs.stripe.com/testing) : `4242 4242 4242 4242` pour une réussite, `4000 0000 0000 0002` pour un refus, une date future et un CVC fictif. Exemple : 3 g de Golden Static → Colissimo → 21,99 EUR ; ou un format Cookie Kush 30 EUR / 7 g → adresse fictive d'Aix → livraison locale → 30 EUR. Conserver le règlement par carte, valider la conformité, puis le formulaire. Sur Stripe, employer `checkout-test@example.invalid`, « Client Test », 12/34 et 123. Aucun envoi réel ni livraison ne résulte des tests.

Success interroge le serveur toutes les 1,5 seconde jusqu'au statut terminal. `paid` et `paidTransitions: 1` prouvent la validation unique par le webhook. Un retour anticipé affiche l'attente. Cancel conserve le panier ; le bouton de reprise réutilise la session ouverte, sans nouvelle commande. Une session expirée ne peut pas être reprise. « Nouvel essai test » ouvre explicitement une autre tentative. Le panier reste également disponible après succès pour faciliter les essais ; un nouvel essai est volontaire.

Les jetons d'accès aux commandes et tentatives sont locaux et préfixés `verdanza:stripe-checkout-test:v1:`. Ce ne sont pas des clés Stripe. Effacer ce stockage fait perdre l'accès navigateur aux anciens statuts, sans modifier leur paiement. Les URL de retour ne contiennent aucun jeton.

Le serveur Vite local ignore les fichiers `.env` et la configuration de production. Sa CSP limite les connexions navigateur à sa propre origine. Les endpoints manuels retournent 404. Le résultat Test `{redirectUrl}` interrompt la finalisation manuelle du formulaire avant analytics, résumé et navigation publics.

## Validation

```powershell
npm run lint
npx tsc --noEmit -p tsconfig.app.json --incremental false
npx tsc --noEmit -p tsconfig.node.json --incremental false
npm run typecheck:api
npm run typecheck:stripe-test
npm run test:stripe-test # émulateur de validation sur 18087 ; Stripe simulé
npm run test:stripe-test:http # handler HTTP, SDK Stripe simulé, signature réelle locale
npm run test:stripe-test:adapters
npm run test:stripe-test:ui # vrai DOM, toutes les requêtes interceptées
npm run test:checkout-payment-options
npm run build
git diff --check
```

`npm run build` régénère `public/sitemap.xml`, puis écrit `dist/` et les fichiers de compilation temporaires. Contrôler ensuite le diff du sitemap. L'entrée Stripe test n'est pas incluse dans le build de production. Les tests Stripe vérifient concurrence, montant falsifié, accès, signatures, replays, statuts, absence d'effets métier et refus du Live. Le contrôle des secrets doit vérifier les fichiers ajoutés/modifiés, les fichiers suivis et `dist/`, sans imprimer les correspondances.

Arrêter les trois processus quand les essais sont terminés. Les clés temporaires peuvent ensuite être supprimées localement sans révoquer ni modifier les identifiants du compte. Pour auditer de nouveau, redémarrer le relais et le serveur avec les secrets appropriés. Un éventuel passage Live nécessite une décision commerciale séparée, l'autorisation de Stripe et une nouvelle conception/revue du traitement métier ; les garde-fous ne doivent pas être simplement désactivés.

## Validation sur la base distante actuelle

Base : `2b4ca8003af7e11f8c796bbeff7021a303974963`. Les règles publiques récentes de cagnotte, cadeaux et concours sont conservées. L'invité Test ne peut pas utiliser de cagnotte ; les demandes correspondantes sont refusées. Les fixtures locales peuvent ouvrir une zone fictive pour tester Aix, sans changer la zone de secours publique (désactivée par défaut).

Les tests serveur automatisés utilisent un émulateur séparé sur le port **18087**, projet `demo-verdanza-stripe`, afin de laisser l'instance des essais manuels sur 8085 intacte. Après préparation du prérequis officiel existant (`npm run prepare:cagnotte-firestore-emulator`), lancer dans un terminal séparé :

```powershell
java -jar node_modules/.cache/cagnotte/cloud-firestore-emulator-v1.22.0.jar --host 127.0.0.1 --port 18087 --project_id demo-verdanza-stripe --single_project_mode true --single_project_mode_error true --rules firestore.stripe-test.rules
```

Puis lancer séquentiellement `npm run test:stripe-test` et `npm run test:stripe-test:http`. Les produits, zones et coupons de validation sont synthétiques. Aucun secret Stripe réel n'est nécessaire : les SDK utilisés pour les signatures ont des valeurs de fixture et les sessions sont simulées. Arrêter uniquement cet émulateur de validation après les tests. Les scripts de lancement manuel conservent les ports 8085/5195.

Les suites publiques pertinentes sont `test:cagnotte`, `test:cagnotte-checkout-ui`, `test:cagnotte-checkout-use`, `test:cagnotte-checkout-client`, `test:gift-promotions`, `test:contests` et `test:firebase-admin-compatibility`. Les runners cagnotte utilisent leur propre port 18085 et refusent un port déjà occupé. Le test concours doit être exécuté à la date courante : un échec éventuel est comparé à la même base sans Stripe, jamais corrigé dans ce chantier.
