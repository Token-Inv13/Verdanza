# Parrainage V1 — backend inert-first

Version commerciale figée : `referral-commercial-policy-v1`. Le parrain reçoit 1 000 centimes, le filleul obtient 500 centimes de remise, et la base de produits éligibles avant cette remise doit atteindre 5 000 centimes. Aucun calcul monétaire ne repose sur des euros flottants.

## Ouverture et sécurité

Sans configuration, `GET/POST /api/referral` renvoie `503 referral_program_disabled` avant Auth, Firestore ou le secret HMAC. `REFERRAL_PROGRAM_MODE=off` seul a le même effet. Toute configuration partielle ou inconnue échoue fermée. `active` et `drain` exigent `REFERRAL_RUNTIME_ENVIRONMENT=production`, `VERCEL_ENV=production`, `REFERRAL_STARTS_AT_EPOCH_MS` entier, `REFERRAL_PROGRAM_VERSION=referral-commercial-policy-v1` et le projet Firebase Admin exact `verdanza-1f621`. `drain` permet uniquement la lecture propriétaire et l’achèvement/correction des commandes dont le snapshot existe ; il bloque la création de code ou de lien. Les tests injectent une configuration locale explicite aux services : aucune variable Vercel Preview ne peut ouvrir le programme.

`REFERRAL_EMAIL_HMAC_SECRET` est lu seulement pour l’action `link`, après le garde actif. Il doit contenir au moins 32 octets UTF-8. Le claim est `HMAC-SHA256(secret, trim(lowercase(email)))`, avec `keyVersion=referral-email-hmac-v1`. Le secret, le HMAC et l’email ne sont jamais envoyés dans la projection `GET self` ni loggés. La projection ne révèle que le code appartenant au demandeur, l’état de sa propre relation et les faits paiement/livraison ; elle ne révèle aucun UID tiers. Les trois collections sont interdites au SDK client par les règles candidates ; leur déploiement relève d’un gate distinct.

Avant un lien, l’email du parrain est relu par l’API Auth Admin `projects.accounts:lookup` avec le jeton OAuth du credential Firebase Admin déjà initialisé. Cette lecture ciblée par UID a lieu hors transaction Firestore et échoue fermée si le projet, l’UID ou la réponse ne correspondent pas.

## Documents

- `referralCodes/owner_<uid>` et `referralCodes/code_<BASE32>` contiennent le même mapping versionné. Le code comporte 128 bits aléatoires encodés sur 26 caractères Base32 majuscules. Collision et unicité du propriétaire sont vérifiées dans une transaction ; le code existant est conservé.
- `referrals/<refereeUid>` est la relation versionnée. Elle conserve le parrain, le filleul, l’état (`linked`, `pending`, `rewarded`, `cancelled`, `reversed`), l’identifiant de la commande qualifiante, les preuves paiement/livraison, le compartiment du droit, la base retournée cumulée et les identifiants de remboursements traités. Le parrain et la commande qualifiante sont figés après qualification.
- `referralEmailClaims/<HMAC>` lie le digest à un UID et une relation. Aucun email clair n’y figure. Un claim d’un autre UID est refusé. Le changement explicite de code avant paiement conserve le claim.
- `orders/<id>.referral` est un instantané serveur versionné : base et seuil avant remise, remise totale, allocation par ligne et empreinte. Il ne contient pas le UID parrain. Chaque ligne doit avoir une base strictement positive et conserver au moins 1 centime net après sa part de remise parrainage ; le futur allocateur checkout devra respecter cet invariant. Le checkout normal ne construit pas encore cet instantané ni la remise ; la fabrique sert à l’injection locale et au prochain lot.
- `cagnotteWallets/<sponsorUid>` et `cagnotteMovements/<eventKey>` sont le seul solde et journal monétaires. Aucun `referralRewards` n’est créé.

## Transitions et remboursements

Une commande sans `referral` n’effectue aucune lecture parrainage. Une commande avec snapshot est traitée dans la transaction de transition commande. Le paiement inscrit `referral_reward_pending` et +1 000 pending ; la livraison inscrit `referral_reward_available`, retire 1 000 pending et rend disponible le reliquat après compensation d’une éventuelle régularisation. Si la livraison précède le paiement, le fait est conservé, puis les deux mouvements sont inscrits dans la transaction de paiement. Les IDs de mouvements sont déterministes et les transactions Firestore sérialisent les accès concurrents au même wallet.

Le remboursement confirmé et la correction administrative appellent le même service dans leur transaction. Le cumul retourné est calculé par ligne depuis l’historique des retours, puis ramené en base avant remise à l’aide de l’allocation figée et d’une division entière. Si la base retenue tombe sous 5 000 centimes, le droit pending est annulé, ou le droit disponible est contrepassé jusqu’au solde disponible ; le reste devient `regularizationCents`, sans dette financière. Une correction qui restaure le seuil émet `referral_reward_restored`, puis `referral_reward_available` si paiement et livraison sont établis. Les remboursements/corrections rejoués avec le même ID et le même cumul sont sans effet.

Les anciens `customerEmail` ne sont pas formellement normalisés. Le lien interroge les commandes payées par UID (preuve principale), puis les variantes email exacte et normalisée (compatibilité). Chaque requête est bornée et refuse un historique saturé plutôt que de supposer l’absence de commande. D’anciennes variantes de casse ou d’alias email peuvent échapper à la recherche ; aucune migration ou lecture intégrale de la base n’est effectuée ici.

## Validation et gates restants

`npm run test:referral-backend` utilise l’émulateur Firestore local et fait partie de `npm run verify` en CI. Les suites cagnotte et règles restent obligatoires. Les règles et index Firestore de ce commit sont des candidats versionnés, sans déploiement. Aucune variable Production ni donnée Production n’est créée. La remise checkout, l’affichage client et l’activation commerciale appartiennent aux lots suivants.
