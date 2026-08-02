# Protection des factures annulées et restauration des promotions

Date : 2 août 2026
Périmètre : code et tests uniquement
Branche : `main`

## Résultat

Les deux défauts applicatifs sont corrigés sans migration ni écriture sur les données historiques.

- Une facture annulée, invalidée, au paiement annulé, ou liée à une commande annulée, supprimée ou introuvable est refusée avant tout appel à Resend.
- Après acceptation par Resend, une transaction relit la facture et la commande avant d'enregistrer le statut `sent`. Une annulation concurrente ne peut donc plus être écrasée.
- L'annulation d'une commande restaure le coupon principal et tous les `couponId` uniques de `appliedPromotions` dans la même transaction que le stock, la facture et le marqueur d'idempotence.

## Causes historiques

### Facture

La branche `sendEmail` chargeait la facture, appelait Resend, puis exécutait une mise à jour Firestore inconditionnelle vers `sent`. Elle ne vérifiait ni l'état documentaire de la facture, ni l'état de la commande liée, ni une éventuelle annulation survenue pendant l'appel externe.

### Promotions

La restauration était imbriquée dans la condition `!stockRestoredAt`, ne traitait qu'un identifiant principal, et utilisait `set(..., { merge: true })` avec `FieldValue.increment(-1)`. Une promotion automatique de `appliedPromotions` pouvait donc rester comptabilisée ; un coupon absent pouvait être recréé ; un compteur pouvait devenir négatif.

## Envoi de facture : avant et après

Avant :

1. lecture de la facture ;
2. appel Resend ;
3. écriture inconditionnelle de `status: sent`.

Après :

1. lecture de la facture et de la commande liée ;
2. application de la politique d'envoi partagée ;
3. refus HTTP `409` avec code synthétique et message sans donnée client en cas de conflit ;
4. appel Resend uniquement si le document est envoyable ;
5. transaction Firestore relisant la facture et la commande ;
6. écriture de `sent`, `sentAt` et `sentTo` uniquement si les états sont encore envoyables.

La fonction Resend possède aussi une garde documentaire de défense en profondeur. Aucun nouveau `providerId` n'est enregistré.

## Protection concurrente

Si une annulation intervient pendant l'appel Resend, la transaction finale échoue avec un conflit et ne remet pas la facture à `sent`. Un e-mail déjà accepté par Resend ne peut pas être rappelé : cette limite externe est conservée et explicitement documentée, tandis que l'état Firestore reste annulé.

## Interface Admin

Le bouton `Envoyer` est désactivé selon la même politique que le serveur. Une facture annulée affiche `Facture annulée — envoi indisponible`. Les factures liées à une commande annulée, supprimée ou introuvable affichent également la raison du blocage. Le bouton PDF et la consultation restent disponibles.

## Restauration des promotions

Le coupon principal est résolu dans l'ordre `promoId`, `couponCode`, `promoCode`. Les identifiants `couponId` de `appliedPromotions` sont ajoutés, normalisés et dédupliqués. Chaque document existant est lu dans la transaction puis reçoit :

`usedCount = Math.max(0, usedCount - 1)`

Les coupons inactifs ou archivés sont restaurés sans modifier `maxUses`, dates, statut ou contenu commercial. Un coupon absent n'est jamais recréé et ne bloque ni le stock ni l'annulation.

## Idempotence et audit

Le marqueur principal est `promotionsRestoredAt`, distinct de `stockRestoredAt`. Les champs suivants sont écrits dans la transaction :

- `restoredPromotionIds` ;
- `missingPromotionIds` ;
- `promotionRestoration.requestedPromotionIds` ;
- `promotionRestoration.alreadyRestoredPromotionIds` pour la compatibilité avec l'ancien `couponRestoredAt` ;
- `promotionRestoration.restoredAt` ;
- `promotionRestoration.restoredByUid` ;
- `linkedInvoiceCancellation` avec l'identifiant, le résultat, la date et l'UID administrateur.

Une seconde annulation ne décrémente aucun coupon. L'ancien marqueur `couponRestoredAt` empêche aussi de décrémenter une deuxième fois le coupon principal d'une commande historique, tout en permettant de traiter d'éventuelles promotions automatiques distinctes.

## Facture liée lors de l'annulation

- brouillon ou facture envoyée : passage à `cancelled`, comportement existant préservé ;
- facture déjà annulée : aucune seconde écriture sur la facture ;
- commande sans facture : annulation possible ;
- facture liée absente : trace `missing` sur la commande, sans création ;
- aucun avoir automatique n'est créé.

La décision comptable concernant une facture déjà envoyée reste hors de ce correctif.

## Tests

Le script `npm run test:order-cancellation-consistency` couvre 24 scénarios, dont les 22 cas demandés : états de facture, refus avant envoi, HTTP 409, course Resend/annulation, Admin, coupon principal, promotions automatiques, FLEURS20 comme snapshot, doublons, compteurs, coupon absent/archivé, ancienne commande, idempotence, cohérence stock/facture et rollback atomique.

Validations exécutées :

- `npm run lint` : réussi ;
- `npm run build` : réussi, sitemap de 38 URL ;
- `npm run typecheck:api` : réussi ;
- `npm run test:order-cancellation-consistency` : 24/24 ;
- `npm run test:order-reliability` : 12/12 ;
- `npm run test:customer-invoices` : réussi ;
- `npm run test:promotions` : réussi ;
- `npm run test:accounting-periods` : 47 assertions ;
- `npm run test:catalog` : 12/12 ;
- `npm run test:admin-archives` : réussi ;
- `npm run audit:runtime` : réussi avec le serveur preview attendu ;
- `npm run audit:performance` : réussi.

Le premier lancement isolé de `audit:runtime` a reproduit la limite connue du harnais lorsqu'aucun serveur n'écoute sur `127.0.0.1:4173` (`ERR_CONNECTION_REFUSED`). Le même audit a réussi après démarrage du preview local, sans modification de code.

## Limites et régularisation future

Ce correctif ne régularise aucune commande, facture ou promotion historique. Une régularisation future de `CCg…`, `VER-2026-0009` ou `FLEURS20.usedCount` devra faire l'objet d'une opération séparée, avec sauvegarde, validation métier/comptable explicite, journal des écritures et procédure de retour arrière. `JRP…`, le compteur de factures et `VER-2026-0008` restent hors périmètre.
