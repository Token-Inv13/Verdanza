# Cagnotte V1 — contrat de raccordement Stripe

Ce document fixe le dernier palier, **Stripe Production + webhook réel + activation des deux gardes d’utilisation**. Il ne constitue ni une activation ni une preuve de paiement Stripe réel. Le verdict de qualification dépend des tests, revues, CI et Preview du lot associé. Base auditée : `498b64753ba9ea5855c5c6c50835284038cd0166`.

## Périmètre et invariants

- Acquisition : 5 % des produits éligibles réellement payés hors cagnotte, après remises ; arrondi au centime le plus proche, demi-centime supérieur.
- Utilisation : minimum du montant demandé, du disponible et de 20 % des produits éligibles après remises, plafond arrondi au centime inférieur. Livraison exclue du plafond et de l’acquisition.
- Code appliqué, promotion automatique appliquée, cadeau et gain concours bloquent l’utilisation ; la promotion est conservée et l’acquisition reste calculée sur le reliquat payé. Parrainage non qualifié bloqué ; avantage inconnu refusé. Un badge d’offre non atteinte n’est pas un avantage appliqué.
- Une demande positive aboutissant à zéro est refusée au commit : le client doit revenir explicitement à un nouveau devis sans cagnotte. Aucun plein tarif implicite.
- Aucun crédit ni réservation n’expire automatiquement. 72 h indique une revue manuelle, jamais un TTL ou une libération programmée.
- Le module Stripe Test reste isolé et continue de refuser `cagnotteUse`. Son comportement d’expiration des commandes de test n’est pas transposable au ledger Production.

## Montant canonique et création future

Toutes les valeurs de calcul sont des entiers sûrs en centimes EUR :

```text
externalPaymentCents = productsPaidCents + deliveryChargedCents
exactEuroCents(order.paymentAmount) = externalPaymentCents
```

`calculateExternalPaymentCents` dans `src/lib/orderFinancing.ts` est utilisé par le devis, la création de commande et la relecture du financement. Il refuse les valeurs négatives, fractions de centime, valeurs non finies et débordements. Le point d’entrée serveur pour le futur prestataire est `orderPaymentCents(order)` dans `api/_server/cagnotteOrders.ts` : il valide l’inscription et le snapshot persistés, dérive le montant et refuse un `paymentAmount` contradictoire. Pour les nouvelles commandes cagnotte, le futur adaptateur doit également exiger la présence de `paymentAmount` avant création Stripe ; la tolérance de relecture historique ne dispense pas de cette exigence.

| Produits après remises | Livraison | Disponible | Utilisé | Produits payés | Externe | Gain futur |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100,00 € | 0,00 € | ≥ 20,00 € | 20,00 € | 80,00 € | 80,00 € | 4,00 € |
| 100,00 € | 0,00 € | 5,00 € | 5,00 € | 95,00 € | 95,00 € | 4,75 € |
| 100,00 € | 5,49 € | ≥ 20,00 € | 20,00 € | 80,00 € | **85,49 €** | 4,00 € |
| 33,33 € | 5,49 € | 10,00 € | 6,66 € | 26,67 € | 32,16 € | 1,33 € |
| 100,00 € | 5,49 € | 10,00 € | 0,50 € demandé | 99,50 € | 104,99 € | 4,98 € |

La future création Stripe relit une commande autorisée côté serveur et son intention de réservation. Aucun `amount`, `paymentAmount`, statut payé, identifiant de bénéficiaire ou détail de prix transmis par le navigateur ne fait autorité. Ne pas recalculer Stripe depuis le panier, le total avant cagnotte, ni depuis une approximation flottante de `paymentAmount * 100`.

Persistances requises avant l’appel Stripe : commande, bénéficiaire, versions de programme/calcul, snapshot et réservation, montant externe attendu, identifiant interne opaque de tentative. Metadata minimale Stripe : `orderId` et `paymentAttemptId`. La correspondance interne doit aussi mémoriser le compte/environnement Stripe et les identifiants Session/PaymentIntent reçus. La metadata reçue seule ne prouve pas cette correspondance. Ne pas inclure de secret, jeton d’accès ou coordonnées client dans la metadata.

Une clé d’idempotence stable par tentative est réutilisée lors des reprises réseau. Une création au résultat inconnu conserve son état ; elle n’autorise pas une deuxième tentative indépendante. Le futur adaptateur doit gérer le crash entre création chez Stripe et persistance locale (intention durable, reprise/réconciliation), sans tenir une transaction Firestore ouverte pendant l’appel réseau.

## Devis et réservation

Le serveur refait les prix, avantages et disponibilité transactionnelle au commit. L’acceptation porte sur version, fingerprint, cagnotte proposée et payable externe. Panier, livraison, promo, cadeau ou montant modifiés invalident l’ancienne acceptation. Une évolution du wallet qui change la proposition impose une nouvelle acceptation ; une hausse sans changement des conditions acceptées ne la rend pas artificiellement invalide.

Le devis n’a pas de TTL arbitraire : « périmé » signifie que les conditions recalculées ne correspondent plus. La réservation transfère exactement `available` vers `reserved`. Même `checkoutRequestId` : replay identique, conflit si contenu différent ; requêtes concurrentes distinctes : contrôle du disponible dans la transaction. Aucun appel Stripe ne contourne ce service de création.

## Webhook futur : autorité, ordre et idempotence

Seul un webhook Stripe authentifié confirme un paiement carte. Vérifier la signature sur le corps brut avec le secret de l’endpoint attendu, puis le compte, `livemode`, la devise EUR, les identifiants persistés, le statut effectivement payé et le montant encaissé. Le retour navigateur, la page succès, un polling client ou un admin déclaratif ne constituent pas une confirmation carte.

Contrat Checkout retenu : `checkout.session.completed` ne confirme que si `payment_status=paid` ; `checkout.session.async_payment_succeeded` doit satisfaire les mêmes vérifications. Une Session terminée mais impayée reste en attente. Les autres événements ne doivent pas ajouter une deuxième voie de consommation ; un futur autre adaptateur doit définir explicitement son événement d’autorité avant activation.

Le montant Stripe vérifié doit être égal à `orderPaymentCents(order)` et au montant enregistré pour la tentative. Tout écart, devise/environnement/identifiant incohérent ou snapshot invalide entraîne **refus de confirmation et revue**, sans écriture métier de paiement ni de cagnotte.

Dédupliquer `event.id` durablement et rendre la transition commande/intention idempotente même si deux événements différents annoncent le même paiement. Utiliser la composition métier de confirmation existante (`api/_server/cagnotteOrders.ts` et services de commande), qui consomme la réservation et inscrit une seule acquisition pending. Jamais d’écriture directe de wallet depuis le webhook.

Une réponse `2xx` n’est permise qu’après traitement durable ou enregistrement durable pour reprise. Ne pas marquer l’événement traité avant le commit métier ; une panne entre réception et traitement doit être rejouable. Les événements retardés ou reçus hors ordre ne régressent pas un paiement déjà confirmé.

## Décision sur la réservation

| Signal | Décision V1 |
| --- | --- |
| Webhook de succès authentifié, payé, montant et correspondance exacts, commande encore valide | Consommer une seule fois ; gain pending sur `productsPaidCents` |
| `completed` impayé, paiement échoué, `async_payment_failed` | Conserver ; informer/revoir l’état, pas de consommation |
| Retour `cancel_url`, onglet fermé, Session expirée | Conserver ; aucun de ces signaux ne suffit seul à libérer |
| Webhook retardé, création interrompue, état réseau inconnu | Conserver, reprendre la même tentative et vérifier côté prestataire |
| Réservation âgée de 72 h | Conserver et proposer une revue manuelle |
| Annulation métier explicite après vérification fiable de non-paiement et impossibilité de paiement ultérieur de la tentative | Libérer par le service d’annulation existant, stock restauré une seule fois ; aucun gain |
| Succès tardif après annulation métier | Refuser la confirmation automatique ; rapprochement manuel du paiement, sans recrédit/débit implicite |

Avant libération, le futur raccord doit empêcher une Session encore payable de réussir ultérieurement, contrôler toutes les tentatives et traiter la course paiement/annulation. Un événement d’expiration isolé ne prouve pas que toute la commande est impayée. Les états de lien `sending` ou `unknown` empêchent une conclusion automatique ; la revue actuelle exige une vérification explicite et récente de non-paiement.

## Livraison, remboursement et régularisation

Après paiement, la livraison libère le gain pending vers available une seule fois. Le crédit utilisé reste consommé. Une annulation avant paiement restitue le réservé sans acquisition.

Stripe rembourse uniquement la part financière encaissée, déduction faite des remboursements financiers précédents. Le ledger traite séparément la restitution de cagnotte utilisée et l’annulation proportionnelle du gain, via les services de remboursement existants. Exemple intégral : 100 € produits, 5 € cagnotte, 95 € encaissés → au maximum 95 € remboursés chez Stripe, 5 € restitués en cagnotte et 4,75 € de gain annulés. Le futur adaptateur devra persister l’identifiant de remboursement et reprendre une réponse réseau inconnue sans duplication.

Les remboursements partiels suivent les répartitions et limites du moteur existant. Si le gain a déjà été utilisé, la régularisation reste interne : aucune dette financière client ; les gains suivants la compensent. Le journal demeure append-only, sans réécriture rétroactive.

## Couverture locale et comparaison checkout

Le wrapper `src/checkout/ManualCheckoutPage.tsx` injecte désormais les services réels dans `src/pages/CheckoutPage.tsx`. Comparaison ciblée avec `2b4ca800` (avant Stripe Test) : mêmes contrôleurs d’acceptation/tentative, identité authentifiée, services quote/createOrder et clés de stockage de la voie manuelle. Stripe Test injecte des dépendances isolées et aucune cagnotte active.

| Sujet | Preuve exécutable |
| --- | --- |
| A/B/C, centimes, <1 €, zéro, plafond, wallet, contrat montant, avantage inconnu, badge inactif | `scripts/testCagnotteStripeHandoff.ts`, exécuté par `test:cagnotte-checkout-use` |
| Prix serveur, devis altéré/périmé, auth, promos, création/réservation concurrente et reprise | `test:cagnotte-checkout-use`, `test:cagnotte-checkout-client` |
| Formulaire partagé réel avec flag local true, invité/connecté, montant/max, acceptation, wallet, abandon, bouton et verrouillage | `test:cagnotte-checkout-ui`, dont `scripts/testCagnotteCheckoutPage.tsx` (réseau intercepté) |
| Réservation, replay, concurrence et conservation du solde | `test:cagnotte-reservations` |
| Paiement simulé, livraison, annulation et stock | `test:cagnotte-orders`, `test:cagnotte-checkout-use`, `test:cagnotte-v1-recipe` |
| Restitution, remboursements partiels, régularisation et journal | `test:order-refunds`, `test:cagnotte-regularization`, `test:cagnotte-v1-recipe` |
| 72 h et états incertains de lien | `test:cagnotte-payment-links`, `test:cagnotte-admin-reviews` |
| Mes avantages, compartiments et libellés de mouvements | `test:cagnotte-presentation`, `test:cagnotte-v1-recipe` |
| Contrôle d’accès, règles et isolation | `test:cagnotte-security`, suites Stripe Test/adapters/HTTP/UI et `typecheck:stripe-test` |

Ces tests simulent le paiement ; ils ne prouvent pas la réception d’un webhook Stripe Production. Exécuter également `npm run verify` et `git diff --check`. Les suites transactionnelles cagnotte utilisent leur runner possédant l’émulateur ; les suites Stripe Checkout/HTTP requièrent un émulateur séparé `127.0.0.1:18087`, projet `demo-verdanza-stripe`, sans catalogue Production.

## Conditions de sortie du dernier palier

Le prochain lot doit implémenter le raccord et sa reprise durable, vérifier signatures et montants réels, les replays/concurrences, échecs/expiration/incertitudes, annulation et remboursements du prestataire. Il doit obtenir une autorisation explicite pour les opérations réelles et pour l’activation coordonnée des deux gardes. Ce lot ne modifie aucune variable Production, règle/index Firebase ou donnée métier.

État à préserver : `CAGNOTTE_ACCRUAL_MODE=accrue`, lecture serveur et Mes avantages actifs, `CAGNOTTE_RESERVATION_MODE=off`, `VITE_CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED=false` ou absent, refunds et admin tools actifs. Ne pas interpréter une CI verte ou un déploiement READY comme une validation métier Stripe réel.

Références Stripe officielles consultées pour le contrat fournisseur : [webhooks et signature du corps brut](https://docs.stripe.com/webhooks), [fulfillment Checkout](https://docs.stripe.com/checkout/fulfillment), [idempotence API](https://docs.stripe.com/api/idempotent_requests). Les règles de conservation/libération et les limites de remboursement ci-dessus sont le contrat Verdanza.
