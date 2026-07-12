# Phase Analytics 2 - Purchase GA4 serveur

## Objectif

Envoyer l'evenement GA4 `purchase` uniquement cote serveur, apres confirmation administrative d'un vrai paiement, sans achat client-side et sans changement GTM. La preference de paiement exprimee au checkout est separee de la methode finale confirmee par l'administration.

## Cause confirmee

La phase Analytics 1 mesurait le parcours client et `order_submitted`, mais aucun `purchase` ne devait partir au moment de la soumission de commande car les commandes Verdanza sont creees avec `paymentStatus: "to_confirm"`. Le signal `purchase` doit donc etre declenche uniquement quand l'admin fait passer une commande reelle a `paid`.

## Donnees conservees

Lors de la soumission checkout, si le consentement Analytics est actif et que GA4 retourne un vrai `client_id`, la commande stocke :

- `analytics.consentGrantedAtSubmission`
- `analytics.consentCapturedAt`
- `analytics.clientId`
- `analytics.sessionId` si disponible
- `analytics.purchaseStatus`
- un hash de jeton de revocation

Le jeton brut de revocation est renvoye uniquement au navigateur et n'est pas stocke en clair.

## Revocation avant paiement

Si l'utilisateur retire son consentement avant la confirmation du reglement, le navigateur appelle `/api/revoke-order-analytics` pour neutraliser l'achat Analytics encore en attente. L'endpoint repond de facon generique et ne revele pas l'existence d'une commande.

## Envoi serveur

Quand `/api/update-order-status` fait passer une commande a `paymentStatus: "paid"`, l'admin doit fournir `finalPaymentMethod`. Une entree deterministe est creee dans `analyticsOutbox` avec l'identifiant `purchase_{orderId}`. Apres commit Firestore, le serveur envoie `purchase` via Measurement Protocol GA4 avec :

- `transaction_id`
- `currency: "EUR"`
- `value` limite a la valeur produits apres remise
- `shipping`
- `coupon` si present
- `items`
- `client_id`
- `session_id` si disponible
- `payment_method`, base uniquement sur `finalPaymentMethod`
- consentement publicitaire refuse

Les donnees personnelles client ne sont pas incluses.

## Preference client et paiement final

Le checkout peut enregistrer `preferredPaymentMethod` avec les valeurs stables suivantes :

- `card_payment_link`
- `cash_on_delivery`
- `bank_transfer`
- `confirm_with_verdanza`

L'ancienne valeur `local_delivery_payment` reste acceptee comme alias et est normalisee vers `cash_on_delivery` pour les nouvelles commandes. Le virement reste desactive tant qu'il n'est pas operationnel. Les especes sont reservees a `deliveryMethod: "local_express"`.

Le champ `finalPaymentMethod` est renseigne par l'administration avant ou au moment de `paymentStatus: "paid"` :

- `card_payment_link`
- `cash_on_delivery`
- `bank_transfer`
- `other`

`preferredPaymentMethod` n'est jamais utilise comme methode finale dans le payload `purchase`.

## Evenement payment_link_sent

Quand un lien de paiement est marque comme envoye par l'administration, Verdanza enregistre un evenement operationnel `payment_link_sent` sans URL de lien, reference sensible, email, telephone ou nom client. Cet evenement n'est pas un `purchase`.

## Deduplication et reprise

Une commande dont `analytics.purchaseStatus` est deja `sent` n'est pas renvoyee. En cas d'echec GA4, la commande reste payee et le statut Analytics passe a `failed`, avec un code d'erreur technique sans secret. L'admin peut relancer via `/api/retry-order-purchase-analytics` pour les commandes payees, consenties, non revoquees et non envoyees.

## Variables d'environnement serveur

- `GA4_MEASUREMENT_ID=G-E9XNP7BJ2Y`
- `GA4_API_SECRET`
- `GA4_MP_HOST=region1.google-analytics.com`

Le secret GA4 n'est pas journalise, retourne, ni commite.

## Validation locale

Script dedie :

```bash
npm run audit:analytics-purchase
```

Ce script valide le payload, l'absence de PII, l'eligibilite, la revocation, la deduplication, l'envoi vers un endpoint mock et l'absence de `purchase` dans le client.
