# Parrainage V1 : protection legacy block-only

Ce socle est fermé commercialement par défaut. Ce lot apporte du code et des tests locaux : aucune opération Firebase/Vercel Production, aucun accès au keyring Production, aucune activation ni modification Auth. Les règles versionnées sont des candidates, non déployées. Aucun nouvel endpoint, index, flag, secret ou barème.

## Claim et block : deux contrats distincts

Un `referralEmailClaim` protège l'email Firebase vérifié d'un UID fiable. Son propriétaire est `refereeUid`, avec la convention `referralId === refereeUid`. Il peut précéder la relation mais ne prouve pas, à lui seul, un paiement.

Un `referralEmailBlock` signifie seulement que l'email historique ne peut plus ouvrir l'avantage première commande. Il ne déclare **aucun propriétaire**. Un compte désactivé et non vérifié ne devient jamais une identité de confiance. Le block est une décision conservatrice contre un second avantage ; il ne réactive personne et ne crée ni relation, ni remise, ni reward, ni wallet.

`referralEmailBlocks/<alias HMAC>` utilise exactement les IDs versionnés de `referralEmailClaims`, y compris l'ancien alias non versionné de v1. Son schéma strict contient uniquement :

```ts
{
  schemaVersion: 1;
  programVersion: "referral-commercial-policy-v1";
  keyVersion: string;
  policyVersion: "referral-legacy-email-block-v1";
  reason: "historical_paid_order_unverified_identity";
  createdAtEpochMs: number;
}
```

Aucun email clair, UID propriétaire, nom, téléphone, sponsor ou montant. L'ID HMAC reste une donnée personnelle dérivée, serveur-only. Les règles candidates refusent tous les accès SDK client, y compris les descendants et les administrateurs navigateur. Aucun TTL, suppression automatique ou rotation libre.

## Payment identity et runtime normal

`referralPaymentIdentities/<orderId>` admet le nouveau status sûr `blocked_by_legacy_email`, avec `blockId`, `keyVersion` et la policyVersion exacte. Les champs de base `schemaVersion`, version de payment identity, `orderId`, `customerUid` et `recordedAtEpochMs` restent présents. Le UID est donc reconnu comme ancien payeur même après changement d'email ou suppression physique de sa commande.

`paymentIdentityEvidenceShape` rejette les champs imprévus. `paymentIdentityProtectionMatches` distingue explicitement claim du même UID, claim d'un autre UID et block valide sans propriétaire. Aucun validator de claim ne prétend valider un block.

`readCurrentPaymentIdentity` conserve son refus `account.disabled || account.emailVerified !== true`, avant toute lecture de keyring. Il n'existe aucun bypass commercial. Pour un email Auth vérifié, la préparation transactionnelle lit tous les aliases de blocks et claims. Un block valide a priorité et ne crée jamais un claim ; un block corrompu produit une issue identité indisponible. Un paiement plain continue avec une evidence `blocked_by_legacy_email` si le block existe déjà.

Le lien refuse un block valide avec `referee_already_paid`. Le checkout utilise `right_consumed`, sans remise de 5 euros, et incorpore les documents blocks au fingerprint des devis autorisés. Une insertion entre devis et création invalide l'acceptation. Aucun message spécifique révélant la politique anti-abus n'est ajouté au client. OFF conserve l'absence de lectures commerciales/Auth/keyring ; le paiement authentifié laisse son evidence technique unresolved habituelle.

## Maintenance opt-in et conditions renforcées

Seul le moteur de `scripts/referralPaymentIdentityReconciliation.ts` peut préparer un nouveau block. La politique `REFERRAL_LEGACY_EMAIL_BLOCK_POLICY_VERSION` nécessite un opt-in explicite égal à `referral-legacy-email-block-v1`. Sans opt-in, le compte désactivé reste unresolved comme auparavant. La CLI connaît le paramètre versionné `--legacy-email-block-policy=referral-legacy-email-block-v1` ; son absence ne choisit pas automatiquement cette politique.

Les gardes existantes restent exactes : projet explicite `verdanza-1f621`, credential du même projet, keyring fourni et validé sans génération/fallback, dry-run par défaut, apply explicite et confirmation versionnée. Les tests de l'engine imposent exclusivement `demo-verdanza-cagnotte` et `127.0.0.1:18085`. **Aucune CLI de maintenance Production n'est exécutée dans ce lot, même dry-run.**

Avant toute réservation legacy, il faut une vraie commande historiquement payée/authentifiée avec evidence manquante ou unresolved, un compte Auth matching existant, disabled=true et emailVerified=false, deux emails exploitables égaux et une création Auth fiable antérieure au paiement. Un lookup Auth top-level par email doit retourner le même UID avec des faits cohérents. Les appels Auth sont injectables, hors transaction, avec payload et résultat unique validés ; un échec HTTP, plusieurs résultats ou une incohérence ferme le traitement.

La transaction relit commande et evidence, puis l'historique complet pertinent avant tout write. Les emails legacy bruts sont normalisés en mémoire : l'absence de `customerEmailNormalized` avant migration ne masque pas un autre UID. La requête scanne les commandes par une borne de **100 documents par défaut**, plus un document sentinelle ; la limite explicite admise est de 1 à 400. Dépasser la borne ne prouve aucune unicité et laisse unresolved. Un autre UID authentifié ayant payé avec cet email, un autre email exploitable payé par le même UID, un document payé ambigu ou une normalisation persistée contradictoire ferme également le traitement.

Tous les aliases de blocks et claims sont lus dans cette même transaction. Tout claim préexistant, y compris du même UID, rend cette politique sans propriétaire inapplicable. Un block valide de la même politique peut être réutilisé ; un block malformé ou de politique différente ferme le traitement. Une insertion concurrente de claim provoque le retry/refus, jamais son écrasement.

Apply, dans un futur cycle autorisé, crée atomiquement le block actif manquant et l'evidence block-only. Il ne change ni order, ni Auth, ni relation, ni wallet, ni marker. Le replay d'une evidence sûre avec protection valide conserve ses données et timestamps. Une preuve orphan unresolved ne suffit pas à qualifier un nouveau block : sans la commande, les faits email/temporalité nécessaires sont absents. Les anciennes preuves sûres, même détachées, restent auditées.

Le rapport n'expose que des compteurs, dont `legacyBlocked` et `legacyBlockUnresolved`. Le dry-run n'effectue aucune écriture. Les erreurs de politique/keyring/borne sont refusées avant lookup Auth et écriture.

## Rotation et certificat V6

Tous les aliases de clés retenues sont recherchés, au paiement normal, au lien, au checkout et en maintenance. Les anciennes clés doivent rester disponibles tant que des claims, des payment identities ou des blocks les référencent. Ce code ne lit/modifie pas le secret Production et ne décide d'aucune rotation.

Le certificat exact devient `order-email-normalization-v6` ; V1 à V5 sont NON READY. La migration V6 scanne exhaustivement par pages orders, payment identities, claims, blocks et relations. Elle conserve les contrôles historiques, preuves détachées et `linkedRelationsWithPaidHistory`.

Une evidence block-only ne compte comme sûre que si son block existe, est strictement valide et porte la même keyVersion et la policyVersion attendue. Sinon `corruptPaymentIdentityEvidence` augmente. Les claims sont audités indépendamment ; un claim corrompu bloque. Tous les blocks sont comptés et validés indépendamment ; un block sans aucune evidence sûre explicative est un orphan inexpliqué et bloque aussi, sans auto-cleanup.

Le marker complete ajoute `verifiedEmailClaims`, `verifiedCorruptEmailClaims: 0`, `verifiedLegacyEmailBlocks`, `verifiedCorruptLegacyEmailBlocks: 0` et `verifiedOrphanLegacyEmailBlocks: 0`. Les compteurs sont entiers, non négatifs ; le nombre de blocks ne dépasse pas celui des evidences sûres. Les anciens blockers restent obligatoirement zéro. Les lectures du lien/checkout utilisent la même constante V6 sans bypass.

La migration reste une étape distincte après réconciliation, avec la double vérification exhaustive et les préconditions Firestore existantes. Aucune migration V6 ni création de marker Production dans ce lot.

## Validation et suite Production

La suite `test:referral-backend` conserve les tests existants et exécute les tests legacy via `exerciseReferralLegacyEmailBlocks`. `test:referral-checkout` vérifie refus du devis, conflit d'acceptation après insertion et block malformé. Ces suites sont déjà réellement exécutées par `verify` en CI. Les règles testent les profils visiteur, propriétaire, autre client et administrateur navigateur.

Le cas équivalent à B3 est une fixture émulateur uniquement : compte désactivé/non vérifié, email matching, création avant paiement, lookup email matching et historiques cohérents. Dry-run doit annoncer `legacyBlocked=1`, puis apply émulateur doit produire seulement block/evidence. Les tests couvrent aussi les refus, claims concurrents, rollback, idempotence, aliases de rotation et certification V6.

Les gates standard/sécurité et Preview précèdent tout merge. Un finding applicable impose STOP. La Production reste OFF après merge : seul un smoke read-only est prévu. L'accès au **keyring existant**, le dry-run réel de maintenance et un éventuel apply exigent encore un cycle Production distinct. Aucun endpoint de maintenance n'est déployé par ce lot.
