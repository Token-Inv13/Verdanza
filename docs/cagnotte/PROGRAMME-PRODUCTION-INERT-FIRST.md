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
| Parcours continu V1 | `npm run test:cagnotte-v1-recipe` | Même wallet et mêmes commandes de la création au remboursement, puis captures bureau/mobile sans réseau. |
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

Les rejeux paiement/livraison de A conservent aussi le journal, le stock et l'historique de statut sans double effet financier. Le remboursement de B est une déclaration synthétique d'un remboursement externe déjà confirmé ; aucun prestataire n'est contacté.

### Variantes déjà couvertes

- Cycle de commande : livraison avant paiement, annulation avant paiement, ancienne commande sans rétroactivité et fin des opérations engagées en mode `drain`.
- Montants et panier : insuffisance de solde, plafond de 20 %, concurrence, double soumission, cadeaux, frais de livraison et avantage inconnu. Un panier de 100,00 € avec 10,00 € de remise gagne 450 centimes et n'autorise pas l'utilisation simultanée du wallet.
- Remboursement et reprise : partiel, correction, réponse perdue, rejeu idempotent et régularisation d'un gain déjà dépensé.
- Frontières : authentification simulée, règles Firestore, curseur signé, rate-limit fail-closed et refus des commandes historiques.

### Preuves d'interface et limites

Le parcours continu alimente les vrais composants `CagnotteView`, `CagnotteCheckoutView` et `CheckoutCreationSummary` avec les résultats des services et handlers exécutés sur l'émulateur. Les artefacts locaux se trouvent dans `node_modules/.cache/verdanza-cagnotte-recette-v1/` : valeurs JSON, deux pages HTML et quatre captures bureau/mobile. Pendant les captures, toutes les requêtes de page sont interceptées et refusées, et le compteur réseau vérifié reste à zéro.

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
