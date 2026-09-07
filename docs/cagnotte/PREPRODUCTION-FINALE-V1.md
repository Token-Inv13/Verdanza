# Readiness technique de la cagnotte V1

Ce manifeste décrit l'état local vérifié avant toute intégration ou mise en production. Il ne vaut ni validation Vercel réelle, ni déploiement Firebase, ni activation commerciale.

## Référence auditée

- Base `origin/main` : `2f0b5ed6cf0e76507b72bcb50dfbb95a634e1fe8`.
- HEAD fidélité avant ce manifeste : `477da67374d474003d763fc0985077c907011a46`.
- Branche : `codex/integration-fidelite-v1`.
- Sept checkpoints :
  1. `acc9d5bd70fcd67bc50001fc8862ce8129e33446` — socle frontend ;
  2. `508c5f857aca07e3dcc5e06a0eb5ba8844a6afcc` — socle monétaire ;
  3. `2e24f9a9174cd7d1d9e4749028cbd865ae44ce91` — cœur transactionnel ;
  4. `f8b94da8b89c8864abec52d96e7608d253271245` — cycle des commandes ;
  5. `8d29c5a2571f90775d6b88b9d35447b8cc284296` — sécurité et lecture ;
  6. `17650cde629bead5d07a4b90a0ad01e6cbd5c43e` — checkout et présentation ;
  7. `477da67374d474003d763fc0985077c907011a46` — remboursements et outils administratifs.

## Gardes et preuve du mode fermé

| Fonction | Garde normale | État | Effet fermé |
|---|---|---:|---|
| Inscription et attribution | `CAGNOTTE_SERVER_PROGRAM` | `null` | Aucune inscription, attribution ou régularisation cagnotte sur une commande ordinaire. |
| Réservation, consommation et libération | `CAGNOTTE_RESERVATION_PROGRAM` | `null` | Aucune nouvelle réservation ; une demande positive est refusée avec `RESERVATIONS_DISABLED`. |
| API de lecture | `CAGNOTTE_READ_SERVER_ENABLED` | `false` | `GET /api/cagnotte` répond `503 cagnotte_read_disabled` avant Auth, Firestore et lecture du secret curseur. |
| Affichage Mes avantages | `CAGNOTTE_READ_DISPLAY_ENABLED` | `false` | Aucun accès actif à Mes avantages dans l'application normale. |
| Utilisation au panier/checkout | `CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED` | `false` | Aucun panneau d'utilisation de la cagnotte. |
| Outils administratifs | `CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED` | `false` | Aucun outil cagnotte dans l'interface administrateur normale. |
| Remboursements | `ORDER_REFUNDS_ENABLED` | `false` | `POST /api/order-refunds` répond `503 order_refunds_disabled` avant corps, Auth et Firestore. |

La recherche statique ne relève aucun autre flag cagnotte, variable `VITE_*`, paramètre de requête, en-tête, `localStorage`, traitement spécial de `localhost` ou de `NODE_ENV` capable de contourner ces gardes. Une commande sans snapshot `cagnotte` suit le chemin historique sans accès aux collections cagnotte. Une demande positive lorsque les réservations sont fermées échoue explicitement ; elle n'est pas convertie silencieusement en commande au plein tarif.

L'architecture actuelle ne contient pas encore de programme de production : les seuls types de programme activables sont réservés à `local_test` et injectés par les tests. La définition d'un programme de production et son mécanisme explicite de bascule forment donc un lot distinct obligatoire avant toute activation serveur.

## Fonctions API et packaging statique

Les 18 fonctions de premier niveau sont :

`admin-contests.ts`, `admin-payment-links.ts`, `analyze-supplier-invoice.ts`, `blog-interactions.ts`, `cagnotte.ts`, `contact.ts`, `contest-prize.ts`, `contests.ts`, `create-order.ts`, `create-review.ts`, `invoices.ts`, `order-refunds.ts`, `quote-order.ts`, `retry-order-emails.ts`, `retry-order-purchase-analytics.ts`, `revoke-order-analytics.ts`, `send-payment-link.ts`, `update-order-status.ts`.

`origin/main` en contient 16. Les deux seuls ajouts sont `api/cagnotte.ts` et `api/order-refunds.ts` ; il n'existe aucun troisième endpoint cagnotte.

| Endpoint | Méthode | Auth et partition | Garde | Firestore si activé | Effets externes | État fermé |
|---|---|---|---|---|---|---|
| `/api/cagnotte` | `GET` | Jeton Firebase ; `self` est lié à l'UID vérifié ; `admin` exige une entrée active dans `adminUsers`. Un `targetUid` est interdit en mode `self`. | `CAGNOTTE_READ_SERVER_ENABLED` | Lit `cagnotteWallets`, `cagnotteMovements` et, pour le scope admin, `adminUsers`. | Vérification du jeton par Firebase Identity Toolkit seulement après ouverture de la garde ; aucun paiement, e-mail ou Storage. | `503` avant Auth, Firestore et secret curseur. |
| `/api/order-refunds` | `POST` | Jeton Firebase et administrateur actif ; corps à clés strictes, sans `targetUid`. | `ORDER_REFUNDS_ENABLED` | Lit/écrit selon l'action `orders`, `cagnotteRefunds`, `cagnotteWallets`, `cagnotteMovements`, `cagnotteAccruals`, `cagnotteReservations` et lit `adminUsers`. | Enregistre un remboursement déjà confirmé ; aucun appel bancaire, e-mail ou paiement. | `503` avant lecture du corps, Auth et Firestore. |

L'arbre statique de `cagnotte.ts` contient 15 modules locaux et requiert `firebase-admin`, `node:crypto` et `node:http`. Celui de `order-refunds.ts` contient 43 modules locaux et requiert `firebase-admin`, `node:crypto`, `node:http`, `node:net` et `node:util`. Aucun des deux graphes n'importe Playwright, l'émulateur, `@firebase/rules-unit-testing`, `tsx`, Vite, `firebase-tools`, une recette, un script de test ou un asset de démonstration.

`vercel.json` ne prévoit un embarquement natif spécial que pour l'endpoint historique `analyze-supplier-invoice.ts` (`@napi-rs/canvas` et worker PDF.js). Les deux nouveaux endpoints n'importent ni PDF.js ni canvas et ne justifient aucune modification de ce fichier. Cet audit établit la fermeture et la cohérence statiques ; seul un futur déploiement Preview pourra prouver la création et le fonctionnement effectifs des 18 fonctions chez Vercel.

## Firestore

- SHA-256 attendu et vérifié de `firestore.rules` : `607eebc720f6a50c341f3d32b6942f302d071f5508e5da6b58fb14b8a7838cc2`.
- Les accès directs client en lecture et écriture sont refusés pour les cinq collections cagnotte.
- Les commandes qui portent une clé `cagnotte` ne peuvent pas être créées, modifiées ou supprimées directement par les règles clientes d'administration prévues pour les commandes historiques.
- Le candidat `firestore.cagnotte-read.indexes.json` contient exactement l'index collection `cagnotteMovements` sur `beneficiaryId ASC`, `recordedAtEpochMs DESC`, `__name__ DESC`.
- `firebase.json` référence les règles, mais ne référence pas ce fichier d'index : rien ne le publie automatiquement.
- `@firebase/rules-unit-testing` est fixé à `4.0.1`, uniquement dans `devDependencies`, y compris dans le lockfile ; aucun runtime Vercel cagnotte ne l'importe.

| Collection | Créateur/modificateur serveur | Lecteur serveur | Client direct | Index propre requis | Expiration automatique |
|---|---|---|---|---|---|
| `cagnotteWallets` | Ledger, réservations, remboursements | Checkout, lecture, ledger, remboursements | Non | Aucun index composite dédié | Non |
| `cagnotteMovements` | Ledger, réservations, remboursements | Lecture, ledger, réservations, remboursements | Non | Index candidat de lecture décrit ci-dessus | Non |
| `cagnotteAccruals` | Ledger et remboursements | Ledger et remboursements | Non | Aucun index composite dédié | Non |
| `cagnotteReservations` | Réservations et remboursements | Réservations, remboursements, revue des impayés | Non | Aucun index composite dédié | Non |
| `cagnotteRefunds` | Service de remboursements | Service de remboursements | Non | Aucun index composite dédié | Non |

Aucune collection ne dispose d'un TTL ou d'une suppression automatique. Aucun déploiement, migration ou backfill n'est prévu par ce lot.

Les commandes peuvent porter les snapshots `cagnotte`, `cagnotteReservationIntent`, `cagnottePaymentEvidence`, `paymentAmount`, `refundSummary` et `unpaidReview`. L'absence de ces champs conserve le comportement historique et ne demande aucune migration. Leur présence déclenche les validations et protections renforcées ; les commandes déjà engagées doivent toujours être traitées selon leur snapshot.

## Secrets et variables d'environnement

| Classe | Variable(s) et lecture | Usage et comportement absent | Besoin futur |
|---|---|---|---|
| A — code déployé, gardes fermées | Aucune variable spécifique à la cagnotte | Les deux endpoints sortent en `503` avant Auth, Firestore et secret curseur. Les imports de modules restent sûrs. | Preview puis Production, gardes fermées. |
| B — activation lecture | `CAGNOTTE_READ_CURSOR_SECRET`, lu dans `api/_server/cagnotteReadRoute.ts` | Signe les curseurs. Si la lecture est ouverte et que la valeur est absente ou trop courte, réponse explicite `500 unavailable`. Aucun secret aléatoire n'est créé au démarrage. | Secret distinct, imprévisible, d'au moins 32 caractères, dans chaque environnement où la lecture est ouverte. |
| B — activation métier | Aucun secret ni variable existante | `CAGNOTTE_SERVER_PROGRAM` et `CAGNOTTE_RESERVATION_PROGRAM` sont des constantes `null`. Il n'existe pas de bascule de production par environnement. | Concevoir et revoir séparément une configuration de programme de production avant ouverture. |
| C — Auth/Firebase existants | `VITE_FIREBASE_API_KEY` dans `adminAuth.ts` | Requis après ouverture pour vérifier le jeton via Identity Toolkit ; absence : erreur explicite. | Preview/Production pour les routes authentifiées. |
| C — Firebase Admin existant | `FIREBASE_SERVICE_ACCOUNT_BASE64`, ou ensemble `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`, dans `firebaseAdmin.ts` | À défaut, Firebase Admin utilise `applicationDefault()` ; la garde fermée empêche l'initialisation par les nouveaux endpoints. | Identité Firebase Admin approuvée et limitée au projet explicitement choisi. |
| C — Storage existant | `FIREBASE_STORAGE_BUCKET` ou `VITE_FIREBASE_STORAGE_BUCKET` dans `firebaseAdmin.ts` | Paramètre optionnel de l'app Admin partagée ; aucun endpoint cagnotte ne demande Storage. | Aucun besoin spécifique à la cagnotte. |
| C — routes publiques existantes | `RATE_LIMIT_HMAC_SECRET` dans `publicRateLimit.ts`, `blogInteractions.ts` et `contests.ts` | Utilisé par des routes publiques existantes. Les deux nouveaux endpoints ne l'appellent pas ; il n'a donc aucun comportement propre sur eux. | Inchangé pour les routes existantes, aucun secret rate limit cagnotte identifié. |
| C — dépendances existantes transitives | `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_NOTIFICATION_EMAIL(S)`, `VITE_APP_URL`, `VERDANZA_CONTACT_PHONE`, `VITE_CONTACT_EMAIL`, `TWILIO_*`, `ADMIN_ALERT_*`, `PUBLIC_SITE_URL`, `VITE_SITE_URL`, `VERCEL_URL` | Des modules historiques du graphe serveur les lisent. Les routes cagnotte fermées ne les atteignent pas et les nouveaux endpoints n'envoient ni e-mail ni alerte. | Conserver la configuration existante ; aucun ajout cagnotte. |
| D — tests locaux | `CAGNOTTE_TEST_SANDBOX`, `GCLOUD_PROJECT`, `FIRESTORE_EMULATOR_HOST`, `TZ` | Fixtures, isolation de l'émulateur et déterminisme des tests ; aucune importation par les endpoints. | Local uniquement. |

Le scan local du delta versionné recherche noms de credentials et signatures courantes de clés privées, clés API, jetons Bearer, Resend, Vercel, Google, GitHub et paiement. Il ne lit ni n'affiche de fichier `.env` local. Aucun secret manifeste ni valeur d'émulateur n'est présent dans les graphes runtime cagnotte.

## Limitation de débit et contrôle d'identité

Les deux endpoints ne possèdent pas de limiteur public dédié et n'utilisent pas `RATE_LIMIT_HMAC_SECRET`. Leur séparation repose sur le jeton Firebase : UID du jeton pour la lecture personnelle et registre `adminUsers` pour le scope admin et les remboursements. `targetUid` ne peut pas transformer une lecture personnelle en lecture tierce, et le schéma strict du remboursement ne permet pas de choisir un bénéficiaire arbitraire dans le corps.

Sous garde fermée, le rejet précède l'identité et toute dépendance à un secret. Avant activation, l'équipe d'exploitation doit décider si les protections de plateforme et l'authentification suffisent ou si un quota authentifié dédié est requis ; cette décision ne révèle aucun bug critique dans le code fermé actuel.

## Ordre futur Firebase

À exécuter seulement après autorisation explicite, dans une session distincte :

1. sélectionner et contrôler explicitement `<PROJECT_ID_EXPLICITE>` ;
2. raccorder le candidat d'index à une configuration Firebase approuvée, sans modifier sa définition ;
3. publier l'index, par exemple avec une commande explicitement ciblée telle que `npx firebase-tools@<VERSION_APPROUVEE> deploy --only firestore:indexes --project <PROJECT_ID_EXPLICITE>` ;
4. attendre et vérifier l'état `READY` de l'index ;
5. publier `firestore.rules`, par exemple `npx firebase-tools@<VERSION_APPROUVEE> deploy --only firestore:rules --project <PROJECT_ID_EXPLICITE>` ;
6. vérifier les règles effectives et les refus clients attendus ;
7. envisager seulement ensuite l'activation serveur.

Ces commandes sont des modèles documentaires. Elles n'ont pas été exécutées et le fichier d'index n'est actuellement pas raccordé à `firebase.json`.

## Ordre futur Vercel et activation

1. intégrer la pile sur la branche approuvée pour la production ;
2. préparer les secrets strictement nécessaires dans Preview ;
3. déployer une Preview avec les sept gardes fermés ;
4. vérifier l'état `READY`, l'inventaire réel des 18 fonctions, leur packaging et les réponses fermées des deux nouveaux endpoints ;
5. effectuer une QA en lecture seule et examiner les logs runtime ;
6. déployer en Production, toujours fermé, après validation explicite ;
7. ouvrir progressivement avec une validation intermédiaire à chaque étape.

Séquence d'activation proposée :

1. étape 0 : index et règles prêts, secrets prêts, code déployé, tous gardes fermés ;
2. étape 1 : ajouter puis ouvrir le programme serveur de production et la réservation ;
3. étape 2 : ouvrir la lecture serveur ;
4. étape 3 : afficher Mes avantages ;
5. étape 4 : afficher et utiliser la cagnotte au checkout ;
6. étape 5 : ouvrir séparément les outils administratifs puis les remboursements.

L'étape 1 exige d'abord le lot de conception du programme de production absent du code actuel. Chaque étape doit être observée avant la suivante ; aucune activation groupée n'est présumée sûre.

## Rollback

En cas d'incident, refermer d'abord le garde UI concerné, puis le garde serveur correspondant. Suspendre les nouvelles opérations et conserver intégralement `cagnotteMovements`, les wallets, les accruals, les remboursements, les réservations et les snapshots de commandes déjà écrits. Les commandes engagées restent traitées suivant leur snapshot et les opérations de compensation prévues par le métier.

Le rollback ne doit jamais remettre les wallets à zéro, effacer le ledger, libérer globalement les réservations ni lancer une migration corrective générale. Toute correction doit rester traçable et ciblée.

## Observabilité après déploiement

Surveiller, sans journaliser de jeton, de secret, de corps complet ou de document personnel :

- quote/checkout : `RESERVATIONS_DISABLED`, `AUTH_REQUIRED`, conflit de quote ou de montant ;
- réservation : `INVALID_INPUT`, `CONFLICT`, `CORRUPT_RESERVATION`, `RESERVATIONS_DISABLED` ;
- attribution/ledger : conflit d'idempotence, événement incohérent, wallet ou base de remboursement corrompus ;
- lecture : `cagnotte_read_disabled`, `unavailable`, curseur invalide, données incohérentes, refus de compte tiers ;
- remboursement/correction : `order_refunds_disabled`, demande invalide, confirmation externe manquante, conflit de version/révision et revue impayée requise ;
- routes commandes existantes : erreurs génériques de transition et d'effets secondaires, corrélées par l'identifiant de commande sans contenu intégral.

Les modules cagnotte n'ajoutent aucun log normal contenant un jeton Firebase, le secret curseur ou des documents complets. Aucune nouvelle infrastructure d'observabilité n'est créée ici.

## Décisions restantes avant activation commerciale

- **Programme de production** : concevoir l'objet de programme, ses dates/version et son mode d'activation explicite ; l'injection `local_test` ne doit jamais être utilisée en production.
- **Infrastructure** : choisir le projet Firebase, publier et vérifier index puis règles, configurer les secrets, prouver le packaging des 18 fonctions en Preview et vérifier le runtime fermé.
- **Analytics** : fixer la convention `purchase`, le montant GA4 et le traitement des remboursements. « À décider avant activation commerciale complète si les métriques d’achat/remboursement doivent refléter le total commercial ou le paiement externe. »
- **Comptabilité et TVA** : faire valider le traitement de la cagnotte, la TVA, les remboursements/avoirs et l'éventuel document correctif. Les écrans et factures fictives de démonstration ne constituent aucune validation comptable ou fiscale.
- **Légal et commercial** : valider les ajouts aux CGV, la présentation des règles d'acquisition et d'utilisation, le non-cumul, l'absence d'expiration, les conditions de remboursement/correction, les mentions de parrainage et l'information de confidentialité liée à l'historique. Le document `REGLES-OUVERTURE-V1.md` reste la référence validée pour 5 %, le plafond de 20 %, le non-cumul et l'absence d'expiration automatique.
- **Exploitation** : désigner les responsables de l'activation, des alertes, de la revue à 72 h, du rollback et du traitement des commandes déjà engagées.

Jusqu'à autorisation explicite, sont interdits : activation d'une garde, déploiement Firebase ou Vercel, ajout de secret réel, création de données, push, seed, migration appliquée, réparation, nettoyage, réconciliation, IndexNow, envoi Resend/Twilio, paiement ou commande réelle.
