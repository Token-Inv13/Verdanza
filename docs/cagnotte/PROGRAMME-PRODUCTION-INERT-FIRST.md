# Programme cagnotte Production — socle inert-first

Ce socle ajoute les contrats nécessaires à un futur programme Production sans l'activer. Les entrées normales `CAGNOTTE_SERVER_PROGRAM` et `CAGNOTTE_RESERVATION_PROGRAM` restent littéralement à `null`. Aucun résolveur n'est connecté à `process.env` et aucune date de lancement n'est définie.

## Acquisition

Le résolveur pur reconnaît trois modes :

- `off` : aucun programme opérationnel ;
- `drain` : aucune nouvelle inscription, mais les commandes déjà inscrites terminent paiement, livraison, disponibilité, annulation, remboursement et régularisation ;
- `accrue` : nouvelles inscriptions autorisées à partir d'un instant approuvé.

`newAccrualsEnabled` contrôle uniquement la création d'un nouvel enrollment. Une commande inscrite ne doit jamais perdre son gain parce que le programme passe ensuite en `drain`.

## Réservation

Le contrat de réservation est indépendant du contrat d'acquisition :

- `off` : aucun programme de réservation opérationnel ;
- `drain` : aucun nouvel intent ni nouvelle réservation, mais `consume`, `release` et `cancel` restent autorisés sur les réservations existantes ;
- `reserve` : nouveaux intents et réservations autorisés.

Cette séparation permet une première phase commerciale avec acquisition des 5 % et sans utilisation du solde. Les routes checkout reçoivent donc deux dépendances distinctes : `accrualProgram` et `reservationProgram`.

## Garde Production

Un programme Production ne peut être construit que par le résolveur pur avec :

- l'environnement explicite `production` ;
- le projet Firebase Admin exact `verdanza-1f621` ;
- une date entière sûre et non négative fournie par un futur gate autorisé ;
- un mode connu.

Une configuration partielle, inconnue, locale, Preview ou associée à un autre projet échoue fermée. Les fixtures `local_test` conservent leur fonctionnement sans dépendre d'un credential Firebase.

## Rollback

Après lancement, le rollback normal passe d'abord l'acquisition et la réservation en `drain`, puis ferme les affichages. `off` ou `null` ne doit pas remplacer `drain` tant que des commandes inscrites ou des réservations existent. Les wallets, mouvements, accruals, réservations et remboursements restent conservés.

## Rate-limit des créations de commande

Le limiteur public conserve `fail_open` comme politique par défaut. Les routes contact, concours et blog, ainsi que les commandes historiques qui ne peuvent produire aucune mutation cagnotte, gardent donc leur comportement de disponibilité antérieur.

`create-order` sélectionne `fail_closed` uniquement lorsqu'un UID a été vérifié côté serveur et que les programmes injectés autorisent réellement une nouvelle inscription ou une nouvelle réservation à l'heure unique de l'opération. Une absence de secret, de signal ou de stockage du limiteur renvoie alors `503 checkout_security_unavailable` avant toute écriture métier. Une saturation normale reste un `429` et un identifiant de tentative réutilisé avec un autre payload reste un `409`.

La décision ne dépend d'aucun UID, `customerId` ou état cagnotte fourni par le client. Les compteurs existants restent dans `securityRateLimits` avec leurs signaux HMAC ; aucune IP, adresse e-mail ou UID brut n'est ajouté aux documents ou aux logs. L'UID vérifié sert uniquement à déterminer l'éligibilité en mémoire et aucun nouveau quota UID n'est introduit.

## Remboursements et outils administratifs

L'ordre d'ouverture futur reste strict : ouvrir d'abord l'API de remboursement, vérifier son refus des commandes historiques et son inspection des commandes inscrites, puis ouvrir l'interface administrateur. L'acquisition ne vient qu'après validation de ce parcours : **refunds API → admin UI → acquisition**. `ORDER_REFUNDS_ENABLED` et `CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED` restent à `false` dans le socle livré.

`inspect`, `preview` et `preview_correction` ne produisent aucune écriture. `record_confirmed` enregistre une déclaration externe déjà confirmée et `record_correction` la corrige avec une référence idempotente. Aucune de ces actions ne contacte un prestataire de paiement, ne déclenche de remboursement bancaire et n'envoie d'e-mail. Le montant financier déclaré reste séparé de la restitution de crédit et de la correction du gain.

Une commande sans snapshot serveur `cagnotte` reste historique : le panneau n'est pas monté et l'API répond `refund_historical_order_not_supported` sans écriture. Pour une commande inscrite, l'inspection expose l'inscription, le droit d'acquisition, le portefeuille global, la réservation, l'historique effectif et un journal de mouvements filtré. Le panneau distingue explicitement le gain de la commande du solde global du client. Il utilise `/api/order-refunds` et les transitions historiques de `/api/update-order-status`; il ne dépend ni de `/api/cagnotte` ni du secret de curseur de lecture.

Après une réponse réseau incertaine à une mutation, l'opérateur ne change pas la référence métier. L'interface bloque la nouvelle soumission et impose une nouvelle inspection de la commande. L'opérateur vérifie l'historique, puis reprend exactement la même opération : l'idempotence permet de retrouver une écriture déjà validée sans double effet.

Les événements `cagnotte_refund_recorded`, `cagnotte_refund_correction_recorded` et `cagnotte_correction_requires_review` contiennent seulement un hash de commande, un identifiant interne, une version, les deltas en centimes et le résultat d'idempotence. Ils excluent identité, coordonnées, jetons et références externes brutes.

## Drain après incident

En cas d'incident, fermer d'abord l'interface administrateur puis l'API de remboursement pour empêcher de nouvelles déclarations. Passer ensuite l'acquisition et la réservation en `drain` afin que les commandes et réservations déjà engagées puissent terminer leurs transitions terminales. Conserver les commandes, wallets, accruals, réservations, mouvements et déclarations de remboursement. Après diagnostic, inspecter chaque commande concernée et rapprocher les références idempotentes avant toute reprise ; ne jamais recréer une référence pour masquer une réponse perdue.

## Prérequis encore fermés

Avant la lecture client, un gate séparé devra encore créer `CAGNOTTE_READ_CURSOR_SECRET` dans les scopes autorisés. Les ouvertures API refund, interface admin, lecture, acquisition et réservation restent des décisions distinctes.

Ce document ne constitue ni une activation, ni une décision de lancement, ni une configuration Vercel ou Firebase.
