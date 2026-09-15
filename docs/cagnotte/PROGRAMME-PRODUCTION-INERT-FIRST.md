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

## Historique — consolidation de la PR #7

### État historique avant fusion (13 septembre 2026)

La référence distante annoncée pour la reprise était `d1780931a83f8163a68d1af3994a43e73c36de6b`. Après `git fetch origin`, elle correspond toujours au HEAD de `origin/codex/cagnotte-refund-admin-readiness-v1`. La base `origin/main` est `9074fbb162b7d3e2afac87e5e63f7debeba21aa4`. La PR #7 est ouverte, non brouillon, sans auto-merge, `MERGEABLE/CLEAN`, avec ses trois checks distants verts sur ce HEAD historique.

Le worktree examiné est `C:\Users\token\Documents\DEV\verdanza-fidelite-integration`, sur `codex/cagnotte-refund-admin-readiness-v1`. Il était propre et aligné à `0/0` avec la branche distante avant cette consolidation. Les changements ci-dessous sont uniquement locaux et non commités. Ils concernent le service remboursement/correction, le contrôleur et le panneau administrateur, les tests associés, les assertions de readiness/sécurité et l'exécution explicite de l'émulateur. Aucun autre chantier local n'a été incorporé.

Les sections précédentes de ce document décrivent l'architecture inert-first livrée historiquement. Cette section conserve l'état de la consolidation avant fusion ; l'état courant est documenté plus bas dans « État courant — recette locale V1 et préparation de l'ouverture ».

### Familles closes dans le candidat local

| Famille | Cause racine observée | Correction locale | Preuve actuelle |
|---|---|---|---|
| A — parité métier et idempotence | Le chemin correction n'appliquait pas toutes les preuves de paiement, d'acquisition, d'annulation, de paiement mixte et de journal utilisées par le remboursement ; le rejeu exact passait trop tard. | Validations communes réutilisées par les deux chemins, journal canonique contrôlé avant toute nouvelle écriture et retour idempotent d'une correction exacte avant les préconditions réservées aux nouvelles écritures. | Rejets sans écriture sur paiement, montant mixte, annulation et mouvement historique incohérents ; rejeu exact déjà enregistré conservé sans écriture malgré une précondition devenue invalide. |
| B — reprise incertaine | Un plafond produit pouvait masquer une preview périmée et `refund_validation_failed` n'était pas classé à partir d'une preuve serveur suffisante. | Versions de preview contrôlées avant les plafonds ; résolution terminale limitée au rejeu exact et aux réponses non incertaines explicitement sûres. Les erreurs réseau, réponses mal formées et autres 4xx restent gelées sans preuve. | Course de plafond produit renvoie `refund_preview_stale` sans second événement ; reprise remboursement/correction libérée après rejet certain ; un autre 4xx reste incertain. |
| C — synchronisation UI | Certains rejets définitifs ne résolvaient que l'instance source et l'événement `storage` ne synchronise pas deux panneaux de la même page. | Canal partagé avec résolution locale puis notification des pairs ; même chemin pour remboursement, correction et reprise. Le mécanisme `storage` inter-onglets reste en place. | Test mobile/desktop de même page et suites existantes multi-onglets/rechargement passent. |
| D — reproductibilité | `npm run verify` téléchargeait implicitement l'émulateur via `test:order-refunds`, et une seconde assertion de sécurité imposait encore cet ancien contrat. | `test:order-refunds` utilise uniquement le JAR préparé et vérifie son empreinte ; absence ou empreinte invalide donne la commande explicite `npm run prepare:cagnotte-firestore-emulator`. Les workflows CI conservent une étape de préparation réseau distincte avant `verify`. | Échec test-first de l'assertion résiduelle observé, assertion corrigée, puis vérification complète sans téléchargement implicite. |

Les reproductions ont d'abord échoué sur : l'absence de notification locale partagée, la reprise certaine de `refund_validation_failed`, l'ancien contrat de préparation implicite et la course preview/plafond produit. Elles passent après correction.

### Validation locale historique

`npm run verify` a été exécuté intégralement le 13 septembre 2026 et a réussi. Il couvre notamment :

- sécurité locale, lint et typechecks application/API ;
- 67 contrôles stockage/contrôleur administrateur ;
- 37 contrôles d'interface administrateur ;
- 5 contrôles de diagnostic du processus émulateur ;
- 157 scénarios HTTP/Firestore de remboursement et correction sur l'émulateur officiel `1.22.0` lié uniquement à `127.0.0.1:18085`, ensuite arrêté ;
- readiness production, sept gardes fermés, tests cœur, build local, 83 fichiers prerender et audits locaux.

Aucun test demandé n'est bloqué. `npm run verify:full` n'a pas été exécuté : le critère demandé pour cette consolidation est `npm run verify`, et les suites étendues étrangères au lot n'ont pas été ajoutées au périmètre. Aucun test n'a utilisé Firebase Production et aucune opération bancaire n'a été effectuée.

### Signalements et critère de sortie historique

Les 40 fils de revue existants ont été relus sans modification : 34 sont déjà couverts sur le HEAD distant par le code et les tests antérieurs, 5 correspondent aux causes racines corrigées dans le candidat local (journal avant mutation, préparation explicite, plafond produit/preview, parité correction, synchronisation même page) et 1 ancien signalement demandant un téléchargement automatique est désormais non applicable car le contrat validé exige une préparation réseau explicite. Aucun fil n'a été marqué résolu et aucune revue automatique n'a été relancée.

Aucun défaut bloquant ne reste dans le candidat local après `npm run verify`. Aucune amélioration hors périmètre n'a été implémentée ni identifiée comme nécessaire à l'intégrité de ce lot.

La PR distante #7 reste **NON PRÊTE pour revue de fusion** tant que ces changements locaux ne sont pas commités et poussés sous autorisation explicite, puis validés par la CI distante sur le nouveau SHA. Son état vert actuel prouve seulement le HEAD historique `d1780931a83f8163a68d1af3994a43e73c36de6b`. Le critère de sortie est : revue du diff local, commit et push autorisés, CI complète verte sur le nouveau HEAD, conservation des sept gardes fermés, puis décision humaine de fusion séparée.

### Complément — résolution concluante par inspection

Le signal P2 postérieur à la publication du candidat `7a524833c584674d5abea5365ad6fe13547e0792` a révélé qu'une inspection retrouvant l'opération enregistrée nettoyait seulement l'instance source. La suppression durable n'émettant aucun événement `storage` dans le même document, le panneau mobile ou bureau pair pouvait rester verrouillé.

Après preuve serveur et persistance terminale réussie, `applyInspection` nettoie désormais l'état local puis utilise le canal partagé existant pour demander la réconciliation des autres instances de la même commande. Une inspection absente, non concordante, en échec ou dont la résolution ne peut pas être persistée ne publie rien et conserve les protections.

Le test interactif intégré à `test:cagnotte-admin-ui`, lui-même appelé par `verify`, monte réellement les deux panneaux avec API et authentification simulées et réseau externe bloqué. Il couvre remboursement, correction, cas non concluants, échec de persistance, isolation d'une autre commande et stabilisation sans mutation ni boucle. Avant correction, il échouait parce que le panneau pair restait verrouillé ; il passe après correction.

## État courant — recette locale V1 et préparation de l'ouverture

La PR #7 a été fusionnée par squash dans `main` au commit `71c6d7a3f8dd8b87ae81c3350779aae7c4e59963`. La présente recette part exactement de ce commit dans le worktree `C:\Users\token\Documents\DEV\verdanza-fidelite-integration`, sur la branche locale `codex/cagnotte-recette-v1`. La branche historique `codex/cagnotte-refund-admin-readiness-v1` et les autres worktrees sont conservés.

Cette phase ajoute uniquement des preuves de test, des fixtures, le raccord minimal du runner et cette mise à jour documentaire. Elle ne modifie aucun calcul, service métier, garde, lockfile, secret, paramètre Firebase/Vercel ou donnée distante. Elle ne constitue ni une activation, ni une décision commerciale de lancement.

### Isolation et environnement de recette

La recette utilise exclusivement le projet fictif `demo-verdanza-cagnotte`, l'environnement `local_test`, des clients, administrateurs, produits et commandes synthétiques, et l'émulateur Firestore lié à `127.0.0.1:18085`. Le runner refuse un port déjà occupé, n'adopte aucun processus existant et arrête seulement le processus Java qu'il a créé. Il utilise le JAR Firestore déjà préparé, de SHA-256 `9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c`, sans téléchargement implicite.

L'authentification est simulée et les actions externes sont neutralisées. Aucun compte réel, Firebase distant, paiement, remboursement bancaire, e-mail, SMS, Analytics distant ou IndexNow n'est appelé. Les handlers HTTP, services de cagnotte, transitions de commande et composants client exercés sont ceux de l'application.

### Matrice des preuves locales

| Fonction | Commande ou suite | Preuve obtenue |
|---|---|---|
| Calculs monétaires | `npm run test:cagnotte` | 72 contrôles, centimes entiers, plafond et arrondis. |
| Wallet, journal et cycle de commande | `npm run test:cagnotte-ledger`, `npm run test:cagnotte-orders` | 15 contrôles unitaires, 32 contrôles Firestore et 48 scénarios de commande. |
| Réservation et régularisation | `npm run test:cagnotte-reservations`, `npm run test:cagnotte-regularization` | 24 scénarios de réservation et 4 scénarios de régularisation. |
| Règles et sécurité serveur | `npm run test:cagnotte-security` | 558 décisions de règles et 33 contrôles serveur. |
| Lecture client et curseurs | `npm run test:cagnotte-read` | Lecture propre/admin, pagination, curseurs, données anciennes et refus fermés. |
| Checkout serveur et client | `npm run test:cagnotte-checkout-use`, `npm run test:cagnotte-checkout-client` | 25 scénarios d'intégration serveur et contrat client, y compris réponse perdue et rejeu. |
| Liens de paiement et revues | `npm run test:cagnotte-payment-links`, `npm run test:cagnotte-admin-reviews` | 51 scénarios et 27 envois simulés, plus 8 scénarios de revue administrateur. |
| Remboursements et outils administratifs | `npm run test:order-refunds`, `npm run test:cagnotte-admin-storage`, `npm run test:cagnotte-admin-ui` | 157 scénarios remboursement/correction, 67 contrôles de stockage/contrôleur et 38 contrôles UI. |
| Présentation client et commande | `npm run test:cagnotte-presentation`, `npm run test:cagnotte-checkout-ui`, `npm run test:cagnotte-order-presentation` | Composants réels rendus avec données locales, états de session, chargement et erreur. |
| Parcours continu V1 | `npm run test:cagnotte-v1-recipe` | Même wallet et mêmes commandes de la création au remboursement ; journal exact `0 → 1 → 3 → 3 → 4 → 6 → 8 → 10 → 10`, avec le rejeu A exporté comme étape distincte, clés canoniques, rattachements, deltas et somme des compartiments vérifiés, puis captures bureau/mobile sans réseau. |
| Porte globale | `npm run verify` | Sécurité locale, lint, typechecks, suites critiques, readiness, build local, prerender et audits locaux réussis. `verify:full` n'est pas requis ni exécuté. |

### Parcours continu sur un même wallet

Tous les montants ci-dessous sont vérifiés en centimes. À chaque étape, la commande, l'accrual, la réservation, le wallet, le journal, la lecture client et l'inspection administrateur sont contrôlés. Un digest métier avant/après confirme que les lectures et inspections ne produisent aucune écriture.

| Étape | Montant externe | Wallet `pending / available / reserved / regularization` | Journal et état |
|---|---:|---:|---|
| Devis A à 100,00 € | 10 000 | `0 / 0 / 0 / 0` | Gain estimé : 500 ; aucun solde utilisable. |
| A payée | 10 000 | `500 / 0 / 0 / 0` | 1 mouvement ; gain en attente. |
| A livrée | 10 000 | `0 / 500 / 0 / 0` | 3 mouvements ; 500 disponibles. |
| Devis puis création B à 100,00 € | 9 500 | `0 / 0 / 500 / 0` | 500 réservés ; gain estimé : 475 ; 4 mouvements. |
| B payée | 9 500 | `475 / 0 / 0 / 0` | Réservation consommée ; 6 mouvements. |
| B livrée | 9 500 | `0 / 475 / 0 / 0` | Gain B disponible ; 8 mouvements. |
| Remboursement externe confirmé intégral de B | 9 500 | `0 / 500 / 0 / 0` | Restitution : 500 ; correction du gain B : 475 ; accrual B restant : 0 ; 10 mouvements. |
| Rejeu exact | 9 500 | `0 / 500 / 0 / 0` | Résultat idempotent ; aucun mouvement, remboursement ou delta supplémentaire. |

Les rejeux paiement/livraison de A et le rejeu du remboursement conservent le journal complet, le stock et l'historique de statut sans double effet financier. La même assertion de journal rejette cinq copies en mémoire volontairement corrompues : mouvement manquant, doublon, type métier incorrect, delta altéré et mauvais rattachement commande/client. Le remboursement de B est une déclaration synthétique d'un remboursement externe déjà confirmé ; aucun prestataire n'est contacté.

### Variantes déjà couvertes

- Cycle de commande : livraison avant paiement, annulation avant paiement, ancienne commande sans rétroactivité et fin des opérations engagées en mode `drain`.
- Montants et panier : insuffisance de solde, plafond de 20 %, concurrence, double soumission, cadeaux, frais de livraison et avantage inconnu. Un panier de 100,00 € avec 10,00 € de remise gagne 450 centimes et n'autorise pas l'utilisation simultanée du wallet.
- Remboursement et reprise : partiel, correction, réponse perdue, rejeu idempotent et régularisation d'un gain déjà dépensé.
- Frontières : authentification simulée, règles Firestore, curseur signé, rate-limit fail-closed et refus des commandes historiques.

### Preuves d'interface et limites

Le parcours continu alimente les vrais composants `CagnotteView` et `CagnotteCheckoutView` avec les résultats des services et handlers exécutés sur l'émulateur. L'aperçu final retire le récapitulatif de création devenu obsolète et distingue explicitement la déclaration synthétique des 95,00 € remboursés hors cagnotte, la restitution de 5,00 € et l'annulation du gain de 4,75 €. Les artefacts locaux se trouvent dans `node_modules/.cache/verdanza-cagnotte-recette-v1/` : valeurs JSON, deux pages HTML et quatre captures bureau/mobile. Le même lancement vérifie l'ordre du JSON, les libellés et montants finaux, les styles réellement calculés par Chromium, régénère les quatre captures puis lie HTML, JSON et PNG par SHA-256. Toutes les requêtes de page sont interceptées et refusées, et le compteur réseau vérifié reste à zéro sur les formats bureau et mobile.

Il s'agit d'un adaptateur de recette SSR et de captures statiques, pas d'un parcours complet de l'application dans un navigateur. La navigation, Firebase Auth réelle, les API déployées et les services distants ne sont donc pas qualifiés par ces images.

### Inventaire distant en lecture seule au 13 septembre 2026

Le projet Vercel observé est `token-inv13s-projects/verdanza` (`prj_BmhzgWXPbhzcz1IZExEqmACH8gBN`), relié au dépôt GitHub `Token-Inv13/Verdanza`, avec `main` comme branche Production. `verdanza.fr` sert le déploiement Production `dpl_Ezk9fLenC4QeNyjWczDrs1N1NCvP`, état `READY`, issu du commit `71c6d7a3f8dd8b87ae81c3350779aae7c4e59963`. Le bundle client public de ce déploiement contient le projet Firebase attendu `verdanza-1f621`.

Les métadonnées Vercel, consultées sans lire de valeur, déclarent `RATE_LIMIT_HMAC_SECRET` pour Production et Preview. Elles déclarent séparément pour ces deux environnements les noms Firebase Admin `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_SERVICE_ACCOUNT_BASE64`, ainsi que les noms Firebase client/Auth utilisés par l'application. `CAGNOTTE_READ_CURSOR_SECRET` n'apparaît pas dans les variables du projet. La présence d'un nom sensible ne prouve ni sa valeur, ni son projet cible, ni le fonctionnement de l'identité associée. Le projet Firebase serveur réellement visé en Preview et Production reste donc à vérifier sans exporter les secrets.

Le projet Google Cloud/Firebase `verdanza-1f621` est actif. Sa base Firestore `(default)` est une base native située en `eur3`. Les règles actives de la release `cloud.firestore`, ruleset `0c7c96f6-bafd-4774-86e1-218519220120`, ont exactement 221 lignes et la même empreinte SHA-256 que `firestore.rules` : `c5248ba5b9fb6433d9d020b1fb99bc4bca13cfa4dabf9a466ab90589353324be`. Une copie locale non versionnée est conservée sous `node_modules/.cache/verdanza-cagnotte-recette-v1/remote-inventory/firestore-active.rules`.

Firestore possède exactement un index composite. Il correspond au candidat cagnotte `cagnotteMovements` avec `beneficiaryId ASC`, `recordedAtEpochMs DESC`, `__name__ DESC`, scope `COLLECTION`, et son état est `READY`. Le dépôt conserve ce candidat dans `firestore.cagnotte-read.indexes.json`, mais `firebase.json` ne référence encore que `firestore.rules` : la présence distante est prouvée, la reproductibilité d'un futur déploiement d'index depuis la configuration locale ne l'est pas.

Aucune collection Firestore, valeur de secret, donnée client ou configuration distante n'a été lue ou modifiée. Aucun fonctionnement authentifié, mutation cagnotte, paiement ou effet externe n'a été testé par cet inventaire.

### Prérequis d'ouverture

La dépendance de sécurité reste **API remboursements → interface administrateur → acquisition**. La lecture et le checkout doivent être préparés et validés avant l'ouverture commerciale : cet ordre technique n'autorise pas un lancement de l'acquisition seule. L'ouverture commerciale visée reste une cagnotte consultable et utilisable, sans date fixée.

| prérequis | preuve disponible | manque exact | environnement | action future | critère de réussite |
|---|---|---|---|---|---|
| Raccordement des programmes normaux | Résolveurs `off`/`drain`/`accrue` et `off`/`drain`/`reserve` testés localement ; sept gardes fermées. | `CAGNOTTE_SERVER_PROGRAM` et `CAGNOTTE_RESERVATION_PROGRAM` restent littéralement à `null` et ne lisent aucune configuration d'activation. | Code local et déploiement actuellement inerte. | Concevoir puis faire approuver un raccord explicite, fail-closed, avec projet, mode et instant de lancement ; aucune date n'est décidée ici. | Configuration complète acceptée uniquement pour `production` et `verdanza-1f621`, configuration partielle refusée, aucune inscription avant l'instant approuvé. |
| Reproductibilité de l'index Firestore | Règles distantes identiques au candidat ; unique index cagnotte exact et `READY`. | `firebase.json` ne référence pas `firestore.cagnotte-read.indexes.json`. | Distant observé ; configuration locale incomplète. | Ajouter ce raccord dans un futur changement dédié, puis vérifier le delta exact avant tout déploiement autorisé. | La configuration locale sélectionne uniquement le fichier candidat et un dry-run/readiness ne révèle aucun autre index. |
| Identité Firebase Admin et Auth | Noms des variables sensibles présents séparément en Preview/Production ; bundle Production dirigé vers `verdanza-1f621`. | Valeurs, cohérence du projet serveur et capacité effective des credentials non vérifiées ; Firebase Auth réel hors recette. | Vercel distant observé, fonctionnement non testé. | Vérifier dans une gate autorisée le projet résolu par Firebase Admin et un parcours Auth Preview, sans exporter de secret. | Client et serveur ciblent `verdanza-1f621`, jeton valide accepté, mauvais projet et jeton invalide refusés, aucun accès inattendu. |
| Secret de curseur de lecture | Signature, pagination et altération testées avec un secret local fictif. | `CAGNOTTE_READ_CURSOR_SECRET` n'est pas déclaré dans les métadonnées Vercel observées. | Local prouvé ; Preview/Production absent des métadonnées projet. | Créer un secret distinct par environnement dans une gate de configuration autorisée, avant d'ouvrir la lecture serveur. | Curseurs valides acceptés, altérés refusés, aucune valeur exposée et absence explicite toujours fail-closed. |
| Protection du checkout | Rate-limit cagnotte fail-closed testé ; nom `RATE_LIMIT_HMAC_SECRET` déclaré pour Preview/Production. | Validité du secret et accès opérationnel à `securityRateLimits` non testés à distance. | Local prouvé ; métadonnée distante observée. | Effectuer un contrôle Preview isolé avant toute acquisition ou réservation. | Indisponibilité renvoie `checkout_security_unavailable` sans écriture ; concurrence et rejeu conservent leurs contrats. |
| API remboursements | 157 scénarios locaux ; commandes historiques refusées ; `ORDER_REFUNDS_ENABLED=false`. | Aucun parcours distant authentifié ni procédure opérateur Production validés. | Local prouvé ; distant fermé. | Première ouverture technique future, d'abord en Preview contrôlée, puis décision Production séparée. | Inspection sans écriture, déclaration synthétique autorisée idempotente, reprise certaine et logs sans donnée personnelle. |
| Interface administrateur | 67 contrôles de stockage/contrôleur et 38 contrôles UI ; garde d'affichage à `false`. | Navigation réelle avec compte admin et API ouverte non testée. | Local prouvé ; distant fermé. | L'ouvrir seulement après validation de l'API remboursements, puis exécuter le parcours opérateur prévu. | Commande historique sans outil, commande inscrite inspectable, reprise après réponse incertaine et isolation mobile/bureau. |
| Acquisition | Paiement, livraison, annulation, remboursement, non-rétroactivité et `drain` testés localement. | Entrée normale non raccordée ; décision commerciale, monitoring et instant de lancement absents. | Local prouvé ; Production inerte. | Préparer le raccord après refunds/admin, mais ne lancer commercialement qu'avec lecture et utilisation prêtes. | Inscription unique des seules nouvelles commandes éligibles, 5 % exacts, anciennes commandes inchangées et rollback `drain` disponible. |
| Lecture client | API, autorisation, curseurs et composants testés ; index distant prêt ; gardes serveur/UI à `false`. | Secret absent, raccord serveur fermé et parcours navigateur Auth réel non prouvé. | Local prouvé ; distant fermé. | Préparer le secret, ouvrir serveur puis affichage dans deux gates observées avant lancement commercial. | Le client lit seulement son wallet, pagination stable, aucun appel garde fermée, affichage réel mobile/bureau sans erreur. |
| Réservation et utilisation checkout | Plafond 20 %, insuffisance, concurrence, consommation/libération et paiement mixte testés ; gardes fermées. | Programme normal non raccordé et parcours interactif panier/checkout distant non prouvé. | Local prouvé ; distant fermé. | Préparer réservation puis UI checkout en Preview isolée avant le lancement coordonné. | Montant réservé une fois, total externe exact, double soumission idempotente, aucun solde négatif et aucune commande réelle. |
| Parcours interactif complet | Rendu SSR des composants réels et quatre captures locales sans réseau. | SSR ne prouve ni navigation complète, ni session Firebase Auth réelle, ni appels API déployés. | Recette locale uniquement. | Exécuter une recette navigateur Preview avec comptes et données exclusivement fictifs, services externes neutralisés et preuves réseau/runtime. | Compte, avantages, panier, checkout et admin cohérents sur mobile/bureau, aucune écriture ou dépendance Production. |
| Documents, factures, avoirs, comptabilité et Analytics | Présentations et snapshots techniques couverts par les tests et fixtures. | Libellés finaux, qualification comptable, rapprochement, exports et indicateurs non validés par les responsables concernés. | Technique locale partielle ; validation externe absente. | Faire valider les cas achat mixte, remboursement et correction sans changer les règles commerciales dans ce lot. | Totaux en centimes concordants sur écran et documents ; règles d'avoir, écritures et événements approuvées, sans double comptage. |
| Drain et exploitation | Achèvement des opérations déjà engagées testé en mode `drain`. | Runbook, alertes, responsabilités et exercice opérationnel non préparés. | Local prouvé ; exploitation Production à préparer. | Documenter puis exercer le passage en `drain` avant toute activation. | Aucune nouvelle inscription/réservation et rapprochement de toutes les opérations engagées avant `off`. |

## Recette interactive locale

Cette recette part du commit `6f0c35c8f3e92d2a63fb5fc7cb24ddcefa10dff8`, qui contient les fusions des PR #7 et #8, sur la branche locale `codex/cagnotte-interactive-local-v1`. Elle lance la véritable application React/Vite et ses routes, les handlers API existants, Firebase Authentication Emulator et Firestore Emulator avec les règles versionnées. Les programmes cagnotte injectés dans les handlers restent réservés à l'environnement `local_test` ; l'entrée normale et ses sept gardes ne sont pas modifiées.

### Préparer, lancer et arrêter

Depuis `C:\Users\token\Documents\DEV\verdanza-fidelite-integration` :

```powershell
npm run prepare:cagnotte-interactive
npm run dev:cagnotte-interactive
```

La préparation réseau, à exécuter explicitement, contrôle `firebase-tools@15.28.1` provenant du registre npm officiel, le JAR officiel Firestore Emulator `1.22.0` d'empreinte SHA-256 `9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c`, Java 21 ou supérieur et Chromium Playwright. Le démarrage n'effectue aucun téléchargement. Il refuse un port occupé ou une configuration incohérente, attend les services avec un délai borné, crée seulement les fixtures fictives et affiche les accès. `SIGINT` et `SIGTERM` sont pris en compte avant cette première acquisition : l'annulation interrompt les attentes, empêche le démarrage des étapes suivantes et nettoie une seule fois les processus déjà possédés.

L'application est accessible à `http://127.0.0.1:14173/`. La commande reste au premier plan ; `Ctrl+C` arrête uniquement les processus qu'elle a créés et libère les ports. Une interruption pendant le démarrage est annoncée comme `ANNULÉE`, sans message `READY` ni appel à une API qui n'aurait pas atteint sa disponibilité. Les gestionnaires de signaux restent installés jusqu'à la fin du nettoyage. Les comptes créés à chaque lancement dans Auth Emulator sont :

| rôle | identifiant | mot de passe fictif |
|---|---|---|
| Client 1 | `client.un@recette.verdanza.test` | `Recette!Client1-2026` |
| Client 2 | `client.deux@recette.verdanza.test` | `Recette!Client2-2026` |
| Administrateur | `admin@recette.verdanza.test` | `Recette!Admin-2026` |

Le produit unique est « Fleur fictive recette — 100 € », avec une illustration SVG locale. Un bandeau visible « RECETTE LOCALE — DONNÉES FICTIVES » distingue cette exécution.

### Architecture et isolation observées

Tous les services écoutent uniquement sur `127.0.0.1` : application `14173`, API `14174`, Firestore `18086`, Auth `19099`, hub Firebase `4400`, journal Firebase `4500` et websocket Firestore `9150`. Le projet est fixé à `demo-verdanza-cagnotte` côté navigateur, serveur et émulateurs. Le lancement utilise un environnement nettoyé, ne charge aucun `.env` ou credential réel et refuse le fallback `verdanza-1f621`. Les jetons émis par Auth Emulator sont validés puis confirmés auprès de cet émulateur ; le rôle administrateur continue de provenir de `adminUsers` dans Firestore émulé.

Les requêtes du navigateur atteignent les vrais handlers locaux de devis, création de commande, lecture cagnotte, transition de statut et remboursement. Les calculs, réservations, journaux et contrôles d'accès sont les services métier existants. Les paiements, e-mails, SMS, Analytics, IndexNow et autres effets sortants sont neutralisés. Le limiteur de checkout utilise réellement la collection Firestore locale `securityRateLimits` et un secret HMAC fictif ; le secret de curseur est également fictif.

Un garde réseau est installé côté navigateur et côté serveur. Le trafic effectivement accepté reste limité aux ports locaux déclarés. Deux tentatives par parcours vers `https://www.google.com/images/cleardot.gif`, émises par le transport Firestore client, ont été bloquées par la CSP avant tout échange distant. `firebase-tools` tente aussi sa notification facultative d'éditeur sur `localhost:40001` ; elle est bloquée par le garde serveur car seul l'hôte littéral `127.0.0.1` est autorisé. Ces entrées prouvent des tentatives bloquées, pas une absence de tentative. Un `400` du canal `Firestore/Listen` reste bloquant sauf s'il correspond exactement au polling WebChannel local de la phase `client1-auth`, avec session déjà établie, réponse vide expurgée, message console corrélé et au plus un incident. Sa reprise doit alors être prouvée dans la même page et le même contexte par une mise à jour synthétique postérieure reçue depuis l'émulateur avec `fromCache=false` et sans écriture en attente. Une réponse `200` antérieure, un autre contexte ou une simple poursuite du parcours ne suffisent plus.

### Parcours exécuté

La commande autonome ci-dessous possède tout son environnement, utilise un jeu de données distinct par format et arrête tous ses processus, même en cas d'échec :

```powershell
npm run test:cagnotte-interactive
```

Le parcours a réussi sur Chromium bureau et sur un viewport `390 × 844`. Il passe par les vrais formulaires de connexion, conserve la session après rechargement, vérifie la déconnexion/reconnexion et exerce les interfaces client et administrateur.

| étape | attendu | observé |
|---|---:|---:|
| Commande A | panier 100,00 €, paiement externe 100,00 €, gain 5,00 € | `10 000 / 10 000 / 500` centimes |
| A payée | gain en attente 5,00 € | wallet `500 / 0 / 0 / 0` |
| A livrée | 5,00 € disponibles | wallet `0 / 500 / 0 / 0` |
| Commande B | panier 100,00 €, cagnotte 5,00 €, externe 95,00 €, gain 4,75 € | `10 000 / 500 / 9 500 / 475` centimes |
| B payée puis livrée | réservation consommée, 4,75 € disponibles | wallet final avant retour `0 / 475 / 0 / 0` |
| Remboursement intégral B déclaré par l'admin | externe 95,00 €, restitution 5,00 €, gain annulé 4,75 € | `9 500 / 500 / 475` centimes |
| Solde final | 5,00 € disponibles | wallet `0 / 500 / 0 / 0`, 10 mouvements |

Les contrôles négatifs obtiennent `403` pour la lecture du wallet d'un autre client, la lecture administrateur étrangère et la mutation administrateur par un non-admin. Une lecture Firestore directe étrangère reçoit `permission-denied`. Pour les deux créations, le rate-limit conserve exactement deux documents `attempt`. Chacun des six groupes `network/10m`, `network/24h`, `email/30m`, `email/24h`, `anonymous/30m` et `anonymous/24h` peut contenir un ou plusieurs intervalles fixes selon les frontières traversées ; les compteurs positifs de chaque groupe totalisent exactement deux tentatives. Après l'arrêt volontaire de l'API, l'interface affiche une erreur explicite et ne tente aucun fallback distant.

Les preuves courantes sont indexées par `node_modules/.cache/verdanza-cagnotte-interactive/latest-result.json`. Ce fichier est supprimé au début de chaque nouvelle exécution et n'est recréé qu'après une réussite complète ; un échec écrit `latest-failure.json`. Une interruption `SIGINT` ou `SIGTERM` du runner automatise le même contrat d'annulation que le lanceur manuel : elle ferme le navigateur pour interrompre les gestes et attentes Playwright, transmet l'annulation au démarrage et aux scripts ponctuels, interdit le viewport suivant, puis attend le nettoyage des pages, contextes, harness et groupes enfants. Le résultat courant est `CANCELLED`, jamais `PASS`, avec un code 130 pour `SIGINT` ou 143 pour `SIGTERM` lorsque le signal est l'unique cause ; un défaut de nettoyage conserve un code non nul générique et reste joint au bilan. Le lancement Chromium désactive uniquement les gestionnaires Playwright de `SIGINT` et `SIGTERM` afin que ce coordinateur reste seul responsable de la fermeture et du code de sortie ; le contrat `SIGHUP` de Playwright reste inchangé. Le test qui inspecte la console suit les flux dès la création du runner et attend à la fois sa terminaison et l'événement `close`, avec délai, gestion des erreurs et retrait de ses listeners. Une sortie reçue après `exit` reste ainsi incluse dans la preuve. Les assertions structurées, le nettoyage, les descendants, les ports et le témoin sont tous collectés même si le libellé console manque ; un éventuel `SIGKILL` ultérieur du test est signalé comme secours et ne valide jamais le nettoyage du runner. Chaque sous-dossier de `node_modules/.cache/verdanza-cagnotte-interactive/runs/` contient les captures, le relevé réseau navigateur expurgé, la console, la sonde Listen, un résumé même interrompu, le résultat du nettoyage, les requêtes API, l'état borné de leur journalisation et les états Firestore du parcours. La finalisation ferme d'abord l'admission des requêtes applicatives, refuse les nouvelles requêtes avec `local_api_shutting_down`, draine les handlers déjà admis jusqu'à leur véritable fin, attend les écritures inscrites, puis scelle le journal. Les appels de contrôle concurrents partagent la même opération et ne s'attendent pas eux-mêmes. Une réponse HTTP déjà terminée n'est donc plus confondue avec la fin du handler. Une erreur ou un dépassement de délai reste mémorisé même si une écriture ultérieure réussit et produit un échec explicite `DIAGNOSTICS INCOMPLETS` après le nettoyage, sans modifier le résultat métier déjà envoyé. La CI conserve seulement une liste explicite de ces diagnostics sûrs et de cinq captures utiles ; elle n'archive ni profil navigateur, cache complet, Auth brut, cookie, corps de requête ni secret.

### Validation et portée

La validation obligatoire inclut désormais le typecheck dédié, les contrôles statiques d'isolation, les tests d'échec injecté du cycle de vie, de classification et de journalisation, les fenêtres réelles du rate-limit sur émulateur, le parcours interactif et un contrôle du build normal qui refuse tout marqueur ou module de recette. Les tests du rate-limit injectent des instants dans une même fenêtre, aux frontières de 10 minutes, de 30 minutes et de minuit UTC, puis rejouent exactement une tentative après une frontière. Ils appliquent au parcours interactif les mêmes invariants de groupes, bornes, intervalles distincts et sommes par groupe, et refusent les preuves avec compteur manquant, intervalle dupliqué, mauvaise borne ou total incorrect. Les tests de journalisation injectent `ENOSPC` et `EACCES`, couvrent le chemin HTTP après réponse, l'audit remboursement lancé sans attente, la conservation d'une erreur métier, le rejet tardif, la reprise d'écriture, le drain concurrent et le refus d'une preuve incomplète. Une sonde utilise un vrai listener HTTP local et une autre lance le listener dans un sous-processus Node strict, sans gestionnaire global de rejet. Les tests de démarrage pilotent les frontières par promesses contrôlées et annulent un vrai harness après sa première acquisition. La CI Linux lance aussi le véritable point d'entrée `scripts/cagnotte-interactive/test.ts` : elle adresse directement son PID Node avec `SIGINT` après acquisition du harness et des ressources navigateur, puis avec `SIGTERM` pendant une attente Playwright active ; le second cas reçoit un second signal pendant le nettoyage. Ces preuves ne visent ni le parent `npm`, ni un groupe de terminal. Elles vérifient l'absence de viewport mobile et de faux `PASS`, la disparition de Chromium et de tous les descendants recensés, les sept ports libres et la survie d'un témoin extérieur. Un job Windows distinct exécute les scénarios synthétiques du véritable Job Object : parent actif, sortie du parent avant l'arrêt, second arrêt, échec d'établissement et processus sans preuve d'appartenance. Aucun `process.kill(SIGINT)` n'y est présenté comme un vrai `Ctrl+C`. Un `SIGKILL` extérieur au runner et l'arrêt brutal du système restent hors du contrat gracieux. Services persistants, `seed`, préchauffage et scripts ponctuels sont enregistrés dès leur acquisition. Chaque nettoyage est borné, tente les autres fermetures après un échec, conserve l'erreur initiale et accepte un second arrêt sans tuer de processus par nom ou par port. Le manifeste vérifie les cinq processus initiaux et l'arrêt contrôle les sept ports. La CI prépare séparément Chromium et les émulateurs avant `npm run verify`, sans téléchargement implicite pendant cette commande. Les sept gardes normales restent :

Les fichiers de sortie des processus sont des diagnostics auxiliaires : une erreur d'ouverture, d'écriture ou de fermeture y est bornée, expurgée et ajoutée au bilan du processus sans masquer le résultat métier. Le flux reste consommé après la perte du fichier et sa finalisation attend `close`, avec un délai maximal. Sous Unix, chaque processus lancé par le harness possède un groupe dédié ; l'arrêt tente d'abord `SIGINT`, puis signale par `SIGKILL` ce seul groupe si le délai expire. La CI Linux vérifie avec de vrais PID que le parent et son descendant disparaissent, y compris lorsque le parent est déjà mort, tandis qu'un processus témoin extérieur survit. Sous Windows, un auxiliaire PowerShell versionné crée un Job Object avec `KILL_ON_JOB_CLOSE`, crée la cible suspendue, l'assigne au Job Object puis seulement la reprend. La cible ne dispose donc d'aucune fenêtre pour créer un descendant non possédé. Une demande `STOP` ferme tout le Job Object ; si la cible principale sort d'abord, le superviseur ferme immédiatement le groupe et ses descendants, comportement équivalent explicitement vérifié. Le repli ferme uniquement le superviseur détenu par son handle, sans signaler un PID cible potentiellement réutilisé. Une création ou une preuve d'appartenance manquante échoue sans lancement silencieux et ne produit jamais `ownedTreeStopped=true`.

L'exécution intégrale de `npm run verify` couvre la recette interactive bureau et mobile, les scénarios remboursements, la recette V1, le readiness, les tests cœur, le build Vite, le prerender, le contrôle du build normal sans trace de recette, puis les audits locaux essentiels. Chaque passe interactive doit arrêter tous ses processus. Les nombres de pages et de fichiers générés suivent le contenu éditorial présent dans le `main` testé et ne constituent pas un invariant de sécurité.

- `CAGNOTTE_SERVER_PROGRAM = null` ;
- `CAGNOTTE_RESERVATION_PROGRAM = null` ;
- `CAGNOTTE_READ_SERVER_ENABLED = false` ;
- `CAGNOTTE_READ_DISPLAY_ENABLED = false` ;
- `CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED = false` ;
- `CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED = false` ;
- `ORDER_REFUNDS_ENABLED = false`.

Cette recette qualifie l'application, les handlers et les règles en local, avec Auth et Firestore émulés. Elle ne qualifie ni Firebase Production, ni les permissions cloud, ni Vercel, ni l'authentification cloud, ni un parcours sur téléphone physique. Elle ne constitue pas une activation commerciale. Aucun projet, secret, règle, index, donnée distante ou checkout parallèle n'est modifié.
