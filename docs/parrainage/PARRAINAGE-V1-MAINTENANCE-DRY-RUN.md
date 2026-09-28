# Parrainage V1 — route de maintenance dry-run

Ce lot ajoute du code déployable fermé par défaut. Il ne réalise aucune maintenance
Production, ne modifie aucune variable Vercel et ne change pas le programme commercial OFF.
Une utilisation réelle de la route exige un cycle ultérieur explicitement autorisé.

## Contrat HTTP

`POST /api/referral-maintenance`, avec `Authorization: Bearer <Firebase ID token>`
et exactement le JSON `{"action":"dry_run"}`. Aucun identifiant, secret, projet,
option `apply`, confirmation ou politique ne peut être fourni par le client.

Les autres méthodes retournent 405 avec `Allow: POST`. `action:"apply"` est
explicitement refusée (403), les autres payloads sont refusés (400). Toutes les
réponses utilisent `Cache-Control: private, no-store` et `Vary: Authorization`.
Les erreurs contiennent uniquement un code technique neutre.

## Gates successifs

1. Méthode POST.
2. `REFERRAL_MAINTENANCE_DRY_RUN_ENABLED` doit valoir exactement `"true"`.
   Absent, vide, `"false"`, casse ou espaces incorrects : 503
   `referral_maintenance_disabled`, avant initialisation Admin, Auth, Firestore
   métier et lecture du keyring.
3. `VERCEL_ENV="production"`, `VERCEL="1"`, projet Admin exact
   `verdanza-1f621`, aucune variable d'émulateur Auth/Firestore. Le projet du
   client Firestore initialisé doit également correspondre.
4. Authentification par les primitives existantes `verifyFirebaseIdToken` et
   `assertAdminUser` : token vérifié, membership `adminUsers` actif, email
   vérifié. Le token vérifié est en outre lié au projet exact (audience,
   issuer, subject correspondant à l'UID vérifié, aucun tenant).
5. Payload strict, une seule propriété `action:"dry_run"`.
6. Runtime commercial strictement OFF : `mode="off"`, `operational=false`,
   aucun instant de démarrage. Configuration malformée, active ou drain : refus.
7. Présence et validation du keyring serveur.
8. Moteur partagé de reconciliation, avec `apply:false` et la politique fixe
   `referral-legacy-email-block-v1`.

Ce gate est indépendant de `/api/referral`. Il n'ouvre ni relation, ni remise,
ni reward. Le modèle `.env.example` documente seulement une variable commentée
et fermée ; ce lot ne la crée pas dans Vercel.

## Secret et Auth de maintenance

La valeur de `process.env.REFERRAL_EMAIL_HMAC_KEYRING_JSON` n'est lue qu'à
l'étape 7, par une fonction paresseuse du module serveur. Elle passe directement
au moteur existant. Elle n'est jamais loggée, retournée, copiée vers un fichier,
importée par le client ou passée par le payload HTTP. Les erreurs internes sont
masquées. L'initialisation Admin de cette route désactive le diagnostic qui
afficherait l'identité du service account ; les autres endpoints conservent leur
comportement existant.

Le lookup Auth de maintenance utilise seulement `accounts:lookup` côté serveur.
Il ne crée, ne met à jour, ne supprime et ne vérifie aucun compte. Les tests
emploient des identités injectées et une clé synthétique, jamais Auth Production.

## Lecture seule et source de vérité

`api/_server/referralPaymentIdentityReconciliation.ts` est le moteur unique,
partagé avec l'outil CLI par un réexport de compatibilité. Les helpers legacy,
Auth et de cible sont également partagés. La route n'importe aucun script de
migration, CLI, test, Vite, Playwright ou firebase-tools.

La façade HTTP fixe littéralement `apply:false` ; aucune option d'application
n'existe dans son interface. Elle enveloppe le client Firestore dans
`referralReadOnlyFirestore`, qui autorise seulement les méthodes utilisées pour
les lectures et la pagination. Les références de snapshots sont également
enveloppées. Les transactions utilisent l'option SDK `readOnly:true` et leurs
méthodes `create/set/update/delete` sont refusées avant le SDK. Les capacités
batch, bulkWriter et recursiveDelete sont refusées. Les plans de claim ou block
produits par le moteur restent des plans : la route ne peut pas les appliquer.

Il n'existe aucun chemin HTTP vers un apply. Le CLI existant reste un outil
distinct avec ses propres confirmations ; aucune commande apply n'est exécutée
dans ce cycle. Le certificat V6 reste une étape séparée et n'est jamais écrit
par cette route.

## Réponse sans données personnelles

La projection n'autorise que ces 13 compteurs existants, entiers positifs ou nuls :

`scannedOrders`, `authenticatedPaidProductOrders`, `scannedPaymentIdentities`,
`detachedPaymentIdentities`, `claimed`, `protectedByExistingClaim`,
`legacyBlocked`, `legacyBlockUnresolved`, `unresolved`, `corrupt`, `alreadySafe`,
`changed`, `raced`.

Un rapport dont le mode n'est pas dry-run ou dont `changed` n'est pas zéro est
refusé. Aucune version, liste d'ordres, UID, email, alias HMAC, claimId, blockId,
orderId, donnée Firestore ou détail Auth n'est exposé. Les champs supplémentaires
éventuels du moteur sont ignorés.

## Validation locale et CI

`npm run test:referral-maintenance` appartient à `npm run verify` et s'exécute
donc réellement en CI. Le runner existant conserve le projet demo exact,
l'émulateur officiel 1.22.0 épinglé, la vérification de son hash, le port 18085
exclusif et la garde réseau locale. Aucun timeout ou garde-fou n'est assoupli.

La suite couvre les gates et leur ordre, l'auth admin, le projet du token, le
payload, le refus apply, les erreurs neutres, le secret synthétique, l'import
fermé sans initialisation Firebase, les compteurs et la suppression de toute
PII. Sur émulateur, elle exécute le moteur partagé avec le cas B3
(`legacyBlocked=1`, `changed=0`) et une identité unresolved ; elle compare toutes
les données et timestamps avant/après et après retry, refuse les capacités
d'écriture et vérifie l'absence de sortie stdout/stderr.

Les inventaires readiness restent stricts : **21** routes attendues, dont cette
route dédiée. Le contrôle commercial conserve son interdiction d'import de
scripts, tests et configuration d'émulateur. La maintenance a un contrôle séparé
qui autorise uniquement ses gardes de cible explicites, sans dépendance CLI.
Rules/index candidats restent inchangés et non déployés.

## Ce qui reste interdit et ultérieur

Dans ce lot : aucun dry-run Production, apply, accès Auth Production de maintenance,
extraction du keyring, changement de variable/flag, mutation Firestore Production,
marker, migration V6 ou déploiement Firebase. Le déploiement automatique du code
fermé est acceptable. Une ouverture réelle et un éventuel dry-run Production
relèvent d'une autorisation ultérieure ; ce document ne les autorise pas.
