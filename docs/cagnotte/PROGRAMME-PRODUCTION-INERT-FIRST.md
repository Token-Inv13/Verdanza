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

## Suivi unique de consolidation de la PR #7

### État actuel au 13 septembre 2026

La référence distante annoncée pour la reprise était `d1780931a83f8163a68d1af3994a43e73c36de6b`. Après `git fetch origin`, elle correspond toujours au HEAD de `origin/codex/cagnotte-refund-admin-readiness-v1`. La base `origin/main` est `9074fbb162b7d3e2afac87e5e63f7debeba21aa4`. La PR #7 est ouverte, non brouillon, sans auto-merge, `MERGEABLE/CLEAN`, avec ses trois checks distants verts sur ce HEAD historique.

Le worktree examiné est `C:\Users\token\Documents\DEV\verdanza-fidelite-integration`, sur `codex/cagnotte-refund-admin-readiness-v1`. Il était propre et aligné à `0/0` avec la branche distante avant cette consolidation. Les changements ci-dessous sont uniquement locaux et non commités. Ils concernent le service remboursement/correction, le contrôleur et le panneau administrateur, les tests associés, les assertions de readiness/sécurité et l'exécution explicite de l'émulateur. Aucun autre chantier local n'a été incorporé.

Les sections précédentes de ce document décrivent l'architecture inert-first livrée historiquement. La présente section constitue l'état de suivi actuel de la consolidation ; les anciens commentaires GitHub non marqués résolus ne remplacent pas cette vérification du code courant.

### Familles closes dans le candidat local

| Famille | Cause racine observée | Correction locale | Preuve actuelle |
|---|---|---|---|
| A — parité métier et idempotence | Le chemin correction n'appliquait pas toutes les preuves de paiement, d'acquisition, d'annulation, de paiement mixte et de journal utilisées par le remboursement ; le rejeu exact passait trop tard. | Validations communes réutilisées par les deux chemins, journal canonique contrôlé avant toute nouvelle écriture et retour idempotent d'une correction exacte avant les préconditions réservées aux nouvelles écritures. | Rejets sans écriture sur paiement, montant mixte, annulation et mouvement historique incohérents ; rejeu exact déjà enregistré conservé sans écriture malgré une précondition devenue invalide. |
| B — reprise incertaine | Un plafond produit pouvait masquer une preview périmée et `refund_validation_failed` n'était pas classé à partir d'une preuve serveur suffisante. | Versions de preview contrôlées avant les plafonds ; résolution terminale limitée au rejeu exact et aux réponses non incertaines explicitement sûres. Les erreurs réseau, réponses mal formées et autres 4xx restent gelées sans preuve. | Course de plafond produit renvoie `refund_preview_stale` sans second événement ; reprise remboursement/correction libérée après rejet certain ; un autre 4xx reste incertain. |
| C — synchronisation UI | Certains rejets définitifs ne résolvaient que l'instance source et l'événement `storage` ne synchronise pas deux panneaux de la même page. | Canal partagé avec résolution locale puis notification des pairs ; même chemin pour remboursement, correction et reprise. Le mécanisme `storage` inter-onglets reste en place. | Test mobile/desktop de même page et suites existantes multi-onglets/rechargement passent. |
| D — reproductibilité | `npm run verify` téléchargeait implicitement l'émulateur via `test:order-refunds`, et une seconde assertion de sécurité imposait encore cet ancien contrat. | `test:order-refunds` utilise uniquement le JAR préparé et vérifie son empreinte ; absence ou empreinte invalide donne la commande explicite `npm run prepare:cagnotte-firestore-emulator`. Les workflows CI conservent une étape de préparation réseau distincte avant `verify`. | Échec test-first de l'assertion résiduelle observé, assertion corrigée, puis vérification complète sans téléchargement implicite. |

Les reproductions ont d'abord échoué sur : l'absence de notification locale partagée, la reprise certaine de `refund_validation_failed`, l'ancien contrat de préparation implicite et la course preview/plafond produit. Elles passent après correction.

### Validation locale actuelle

`npm run verify` a été exécuté intégralement le 13 septembre 2026 et a réussi. Il couvre notamment :

- sécurité locale, lint et typechecks application/API ;
- 67 contrôles stockage/contrôleur administrateur ;
- 37 contrôles d'interface administrateur ;
- 5 contrôles de diagnostic du processus émulateur ;
- 157 scénarios HTTP/Firestore de remboursement et correction sur l'émulateur officiel `1.22.0` lié uniquement à `127.0.0.1:18085`, ensuite arrêté ;
- readiness production, sept gardes fermés, tests cœur, build local, 83 fichiers prerender et audits locaux.

Aucun test demandé n'est bloqué. `npm run verify:full` n'a pas été exécuté : le critère demandé pour cette consolidation est `npm run verify`, et les suites étendues étrangères au lot n'ont pas été ajoutées au périmètre. Aucun test n'a utilisé Firebase Production et aucune opération bancaire n'a été effectuée.

### Signalements et critère de sortie

Les 40 fils de revue existants ont été relus sans modification : 34 sont déjà couverts sur le HEAD distant par le code et les tests antérieurs, 5 correspondent aux causes racines corrigées dans le candidat local (journal avant mutation, préparation explicite, plafond produit/preview, parité correction, synchronisation même page) et 1 ancien signalement demandant un téléchargement automatique est désormais non applicable car le contrat validé exige une préparation réseau explicite. Aucun fil n'a été marqué résolu et aucune revue automatique n'a été relancée.

Aucun défaut bloquant ne reste dans le candidat local après `npm run verify`. Aucune amélioration hors périmètre n'a été implémentée ni identifiée comme nécessaire à l'intégrité de ce lot.

La PR distante #7 reste **NON PRÊTE pour revue de fusion** tant que ces changements locaux ne sont pas commités et poussés sous autorisation explicite, puis validés par la CI distante sur le nouveau SHA. Son état vert actuel prouve seulement le HEAD historique `d1780931a83f8163a68d1af3994a43e73c36de6b`. Le critère de sortie est : revue du diff local, commit et push autorisés, CI complète verte sur le nouveau HEAD, conservation des sept gardes fermés, puis décision humaine de fusion séparée.

### Complément — résolution concluante par inspection

Le signal P2 postérieur à la publication du candidat `7a524833c584674d5abea5365ad6fe13547e0792` a révélé qu'une inspection retrouvant l'opération enregistrée nettoyait seulement l'instance source. La suppression durable n'émettant aucun événement `storage` dans le même document, le panneau mobile ou bureau pair pouvait rester verrouillé.

Après preuve serveur et persistance terminale réussie, `applyInspection` nettoie désormais l'état local puis utilise le canal partagé existant pour demander la réconciliation des autres instances de la même commande. Une inspection absente, non concordante, en échec ou dont la résolution ne peut pas être persistée ne publie rien et conserve les protections.

Le test interactif intégré à `test:cagnotte-admin-ui`, lui-même appelé par `verify`, monte réellement les deux panneaux avec API et authentification simulées et réseau externe bloqué. Il couvre remboursement, correction, cas non concluants, échec de persistance, isolation d'une autre commande et stabilisation sans mutation ni boucle. Avant correction, il échouait parce que le panneau pair restait verrouillé ; il passe après correction.
