# Fiabilisation des liens de paiement

Date : 2 août 2026
Périmètre : envoi par e-mail depuis l’administration Verdanza
Branche : `main`

## Cause racine

L’endpoint appelait Resend avant toute réservation persistée. Sa clé d’idempotence contenait en outre `Date.now()`. Deux requêtes issues d’un double clic, d’un retry HTTP ou d’une réponse perdue pouvaient donc utiliser deux clés différentes et produire deux e-mails.

## Architecture livrée

- L’interface crée un UUID `paymentLinkRequestId` par intention d’envoi.
- Un retry technique conserve cet UUID ; seul un renvoi volontaire confirmé crée un nouvel UUID.
- Le serveur authentifie l’administrateur, valide l’état de la commande puis réserve atomiquement l’intention dans `paymentLinkRequests` avant tout appel à Resend.
- Le document déterministe est dérivé de la commande et de l’UUID. Il conserve le fingerprint SHA-256 du lien, le fingerprint complet du payload, le montant, la devise, le canal, le statut, le bail, le nombre d’essais, les dates, l’identifiant prestataire et un code d’erreur synthétique.
- Aucun lien complet, e-mail client ou secret n’est journalisé par ce flux.

## Idempotence et bail

La clé Resend est désormais stable :

`payment-link-{orderId}-{paymentLinkRequestId}`

Une intention passe par `pending`, `sending`, `sent`, `failed` ou `unknown`. Le bail `sending` dure 60 secondes : une requête concurrente retourne l’état existant sans rappeler Resend. Une intention déjà `sent` est également retournée telle quelle. Un même UUID présenté avec un lien, montant, devise, canal ou type d’intention différent reçoit HTTP 409.

Les résultats `timeout`, `network_error` et erreurs HTTP potentiellement ambiguës deviennent `unknown`. Leur retry conserve le même UUID et donc la même clé Resend. Une erreur certaine, telle qu’un refus prestataire ou une configuration absente, devient `failed`.

## Cohérence de la commande

- `paymentLinkSent` et `paymentStatus: payment_link_sent` ne sont écrits qu’après un succès prestataire confirmé.
- La commande est relue après l’appel prestataire.
- Si elle a été annulée, supprimée ou réglée pendant l’appel, l’intention devient `unknown`, l’identifiant prestataire est conservé et la commande n’est pas marquée comme envoyée.
- Les commandes déjà annulées, supprimées ou réglées sont refusées avant Resend.
- L’événement opérationnel `payment_link_sent` conserve son schéma et n’est écrit que lors de la finalisation confirmée.

## Expérience Admin

- Le bouton est désactivé pendant l’appel et protégé immédiatement contre le double clic.
- Après un premier succès, l’action devient explicitement `Renvoyer le lien` et demande confirmation.
- Un retry d’un statut `failed`, `unknown` ou `sending` reprend la même intention, y compris après rechargement lorsque le lien sélectionné est inchangé.
- Le dernier statut, le nombre d’essais et l’historique des intentions sont affichés sans donnée sensible.

## Vérifications automatisées

- `npm run lint` : OK
- `npm run build` : OK, 38 URL dans le sitemap et 66 fichiers HTML pré-rendus
- `npm run typecheck:api` : OK
- `npm run test:payment-link-reliability` : OK
- `npm run test:order-reliability` : OK, 12/12
- `npm run test:customer-invoices` : OK
- `npm run test:order-cancellation-consistency` : OK, 24/24
- `npm run audit:runtime` : OK avec le serveur de preview local attendu sur le port 4173
- `npm run audit:performance` : OK avec le même serveur local

Le test dédié couvre : deux POST simultanés, réponse HTTP perdue, timeout suivi d’un retry avec la même clé, conflit de payload, succès prestataire unique, renvoi volontaire avec nouvel UUID, annulation pendant l’appel, commande déjà réglée/annulée/supprimée, absence de doublon Resend et absence de lien complet, PII ou secret dans les logs.

## Production

- Commit : à renseigner après publication
- Déploiement Vercel : à renseigner après publication
- Statut : à renseigner après publication
- Validation sans envoi : à renseigner après publication

Aucun e-mail ni lien de paiement réel n’a été envoyé pendant les tests ou la validation.

## Limites restantes

- Après un résultat `unknown`, un opérateur doit conserver la même intention et peut devoir vérifier l’état chez le prestataire. L’application ne prétend jamais qu’un envoi ambigu a échoué avec certitude.
- La déduplication côté Resend est limitée à sa fenêtre d’idempotence. L’outbox locale conserve durablement l’état `sent` et empêche néanmoins un retry applicatif ultérieur de rappeler le prestataire pour la même intention.
- Si Resend confirme l’envoi mais que la commande est annulée juste avant la finalisation, l’e-mail ne peut pas être rappelé ; l’état `unknown` et l’identifiant prestataire rendent cette course visible sans falsifier `paymentLinkSent`.
