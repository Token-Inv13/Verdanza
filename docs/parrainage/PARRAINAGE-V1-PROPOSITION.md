# Parrainage Verdanza V1 — contrat commercial validé

**Statut : CONTRAT COMMERCIAL V1 VALIDÉ le 23 septembre 2026.** Cette validation fixe les règles métier pour une future implémentation ; elle ne publie ni n'active le programme. Aucun code métier, solde, secret, variable ou donnée Production n'est modifié par ce lot documentaire. Une date d'effet et une autorisation d'activation distinctes seront nécessaires.

## Point de départ audité

Base documentaire : `origin/main` `6634e8f89545ba31a66098f614b9e680d9dcd6b7` (23 septembre 2026). `src/lib/cagnotteCalculations.ts` contient `REFERRAL_REFERENCE_CENTS = { sponsorReward: 1000, refereeDiscount: 500, minimumProducts: 5000 }`. Cette référence correspond désormais au **barème commercial V1 validé**, mais le module précise toujours : « Reference amounts only; this module never attributes a referral reward. » `checkReferralAmountThreshold` ne teste qu'un montant, avec `customerEligibility: not_evaluated` ; aucune attribution n'est connectée.

`src/types/cagnotte.ts` connaît `referral_discount`, mais `src/lib/cagnotteCommercialPolicy.ts` le classe encore `needs_validation`. `docs/cagnotte/REGLES-OUVERTURE-V1.md` exclut le parrainage de la V1 technique actuelle et n'autorise aucune utilisation de cagnotte par défaut avec cet avantage. **Ce code et ce comportement restent inchangés** jusqu'à un lot d'implémentation autorisé. Le calcul de fidélité existant est de 5 % des produits réellement payés, après remises et hors livraison/cagnotte ; son gain devient disponible après paiement **et** livraison.

## Barème validé et comparaison commerciale

Le barème **validé** est 10 € pour le parrain, 5 € de remise filleul et un seuil de 50 € de produits éligibles payants **avant** remise de parrainage, hors livraison et cadeaux gratuits. Les deux autres lignes restent des comparaisons non retenues ; aucune remise ni récompense n'est créée par ce document. Les exemples supposent une première commande sans autre avantage, aucun remboursement, un paiement et une livraison confirmés. Le « coût nominal » additionne remise filleul et crédit boutique promis au parrain ; il n'est ni une marge nette ni un décaissement immédiat. La fidélité filleul est présentée séparément, car elle existe déjà et ne doit pas être confondue avec le coût incrémental du parrainage.

| Variante | Parrain | Filleul | Seuil produits | Coût nominal par relation qualifiée |
|---|---:|---:|---:|---:|
| Prudente | 5 € | 3 € | 50 € | 8 € |
| **V1 validée** | **10 €** | **5 €** | **50 €** | **15 €** |
| Généreuse | 15 € | 7 € | 50 € | 22 € |

| Panier produits | Variante | Produits réellement payés hors livraison | Fidélité filleul estimée à 5 % | Remise + crédit parrain + fidélité filleul |
|---:|---|---:|---:|---:|
| 50 € | Prudente / V1 validée / Généreuse | 47 € / 45 € / 43 € | 2,35 € / 2,25 € / 2,15 € | 10,35 € / 17,25 € / 24,15 € |
| 75 € | Prudente / V1 validée / Généreuse | 72 € / 70 € / 68 € | 3,60 € / 3,50 € / 3,40 € | 11,60 € / 18,50 € / 25,40 € |
| 100 € | Prudente / V1 validée / Généreuse | 97 € / 95 € / 93 € | 4,85 € / 4,75 € / 4,65 € | 12,85 € / 19,75 € / 26,65 € |

**Décision commerciale :** la V1 retient 10 €/5 €/50 €. La variante prudente réduit de 7 € le coût nominal par relation ; la généreuse l'augmente de 7 €. Ces comparaisons restent informatives et ne sont pas des barèmes actifs.

## Personnes et attribution validées

Un « nouveau client » est un UID Firebase authentifié, avec email Firebase **vérifié** et normalisé, sans commande de produits **déjà payée**, quel qu'en soit le montant, et sans relation de parrainage déjà consommée. Les commandes seulement créées, annulées avant paiement ou échouées ne disqualifient pas. Une commande payée puis remboursée reste une première commande et ne rouvre pas le droit. Le serveur confronte UID, email normalisé et historique des commandes ; en cas de doublon plausible ou de preuve incomplète, il refuse ou met en revue sans attribuer de remise. Aucun backfill historique. Pas de suivi d'appareil, d'adresse IP persistée pour l'identité ni de fingerprinting.

Un même filleul ne peut être lié qu'à un parrain actif. Le lien est établi côté serveur après authentification et contrôle du code, jamais par le seul paramètre d'URL. Avant toute première commande payée, un changement de code/parrain peut être autorisé par une action explicite et une trace serveur. **Après la première commande payée**, `sponsorUid` et `refereeUid` sont figés et la relation n'est plus transférable, même si la remise n'a pas été appliquée. L'auto-parrainage est interdit (même UID ou même email normalisé). Le code partageable est rattaché à l'UID du parrain, sans nom ni email encodé.

| Éligibilité parrain | Atout | Limite | Avis |
|---|---|---|---|
| Tout compte authentifié | Simple, large | Comptes jetables pouvant parrainer d'autres comptes jetables | Non recommandé en V1 |
| Au moins une commande de produits payée **et livrée** | Preuve commerciale déjà dans le cycle de commande ; limite les créations opportunistes | Réduit le bassin initial et exige une vérification serveur | **Validé en V1**, sans conversion rétroactive en filleuls |

Pour posséder ou utiliser un code actif, le parrain doit avoir au moins une commande de produits avec paiement et livraison confirmés. L'éligibilité est revérifiée lorsque le code est attribué et lors de la qualification de la commande filleul. Un compte parrain désactivé ne crée plus de nouveaux liens ni de nouveaux gains ; une récompense déjà acquise reste soumise uniquement aux règles de correction et aux obligations applicables, non à une suppression arbitraire.

## Commande, remise et cumuls validés

La remise fixe de 5 € concerne uniquement **la première commande payée de produits** après attribution, si le devis serveur confirme au moins 50 € de produits éligibles payants avant remise de parrainage, hors livraison et cadeaux gratuits. Elle est répartie en centimes sur les lignes payantes éligibles. Elle n'est ni convertible en espèces, ni transférable, ni fractionnable et ne s'utilise qu'une fois. Une première commande payée sans remise (sous le seuil, avec un avantage prioritaire, ou créée impayée avant le lien puis réglée ensuite) clôt le droit filleul ; il n'est pas reporté. Une commande abandonnée ou annulée avant paiement ne la consomme pas. Le devis et la commande enregistreront la version du contrat et l'allocation par ligne ; aucun recalcul rétroactif selon un barème futur.

**Non-cumul V1 validé :** un code promo, un gain de concours, une promotion automatique ou un cadeau effectivement appliqué conserve sa priorité actuelle et bloque la remise filleul sur cette commande. Une offre seulement visible mais non applicable ne bloque rien. Si la remise filleul est effectivement appliquée, l'utilisation de cagnotte **sur cette commande** est interdite ; une demande positive conduit à un nouveau devis explicite à accepter, jamais à un fallback silencieux. La remise de parrainage est conservée. L'application d'un avantage prioritaire sur la première commande payée clôt le droit filleul, sans gain parrain.

L'acquisition de fidélité filleul reste possible à 5 % sur le reliquat de produits **réellement payé** selon les règles existantes. Exemple canonique : 50 € de produits − 5 € de remise = 45 € de produits payés hors livraison ; fidélité estimée **2,25 €**. Le gain parrain de 10 € est séparé de cette acquisition. Aucune récompense de parrainage ne doit prendre la forme du `payment_confirmed` de la propre commande du parrain.

| Moment du gain parrain | Risque | Décision V1 |
|---|---|---|
| Dès paiement filleul | Crédit disponible alors qu'annulation/livraison échouée reste possible | Rejeté pour la disponibilité |
| Après paiement **et** livraison filleul | S'aligne sur la disponibilité fidélité et réduit le crédit prématuré | **Validé en V1** : 10 € en attente au paiement, disponibles dès que paiement et livraison sont confirmés, sans délai supplémentaire |

La livraison seule ne crée aucun gain. Les confirmations peuvent arriver dans les deux ordres sans double attribution.

## Annulations, remboursements et corrections validés

La commande annulée avant paiement ne consomme pas la remise ; aucun gain parrain. Le paiement confirmé consomme la remise une fois et inscrit la récompense du parrain **en attente**. Un remboursement confirmé avant livraison annule la récompense en attente si la base de produits conservés passe sous le seuil ; un remboursement intégral l'annule toujours. Une commande annulée après paiement suit les faits de paiement/remboursement enregistrés : le simple statut ne fabrique ni remboursement ni contrepassation financière.

Après disponibilité, un remboursement confirmé qui ramène les produits conservés éligibles sous 50 € contrepassera **la totalité** du gain parrain, une seule fois ; au-dessus ou au seuil, les 10 € restent acquis. Pour un remboursement partiel, la base conservée est calculée à partir du snapshot, des allocations d'origine et des retours **cumulés**, sans réévaluer prix ni promotions historiques. Exemple : 60 € de produits initiaux, puis 15 € de produits d'origine retournés → 45 € conservés, récompense parrain annulée/contrepassée. La remise de 5 € déjà utilisée reste dans le prix payé ; elle n'est pas réclamée rétroactivement ni réémise sur un autre achat. Les retours sont remboursés selon l'allocation financière originale de la remise par ligne.

Toute correction postérieure passe par des mouvements append-only. Si le crédit du parrain a déjà été dépensé, appliquer la régularisation interne du wallet, sans dette financière client, prélèvement ni réduction du remboursement financier ; les réservations d'autres commandes restent intactes. Une correction de déclaration de remboursement compare le cumul effectif avant/après, évite tout second mouvement et, si une erreur restaurée rend de nouveau le seuil, rétablit le droit par un événement compensateur idempotent et audité. Ces transitions devront être testées lors de l'implémentation.

## Expérience, administration et données

L'interface client V1 prévue est une sous-section **Parrainage** dans `Mes avantages` (`/compte/avantages`) : code/lien et bouton copier, nombre agrégé de filleuls, statuts en attente/acquis/annulés, montants et règles simples, sans identité ni email des filleuls exposés au parrain. Un code arrivé par lien est porté jusqu'à la connexion, puis validé sur le serveur ; aucune attribution n'est créée par l'URL seule et aucun cookie de longue durée n'est prévu. Le panier expose la remise ou la raison de son refus et demande l'acceptation du nouveau devis si la cagnotte demandée est bloquée. Les montants en attente ne sont jamais présentés comme utilisables.

L'administration minimale montrerait parrain, filleul, relation, commande qualifiante, remise, gain, statut et historique. La recherche se fait sous contrôle admin, avec traces d'accès. Une annulation/correction exige référence d'événement, motif, acteur et vérification des faits ; aucun bouton libre « ajouter 10 € ».

Les données nouvelles visées sont les UID, code aléatoire, relation, IDs de commande, montants, statuts, horodatages et références de mouvements. Pour empêcher la réutilisation raisonnablement détectable d'un email après recréation de compte, `referralEmailClaims` utilise une empreinte **HMAC serveur** de l'email normalisé comme clé d'unicité ; elle reste une donnée personnelle dérivée, protégée et non exposée au client. Le futur secret `REFERRAL_EMAIL_HMAC_SECRET` sera dédié, serveur uniquement, d'au moins 32 octets et jamais `VITE_*` ; aucun secret n'est créé dans ce lot. Ne pas copier email, nom, adresse ou téléphone dans les documents de parrainage. Aucun TTL ni expiration automatique des crédits, relations qualifiées ou preuves de récompense. Conservation alignée sur les commandes et le ledger ; la durée juridique exacte est à vérifier avant l'activation commerciale, sans bloquer le développement.

Événements Analytics possibles, **non activés** : `referral_link_copied`, `referral_signup_attributed`, `referral_order_qualified`, `referral_reward_granted`. Seulement catégories, version de politique et montants agrégés en centimes si nécessaires ; aucun UID, email, code, lien complet, orderId ou autre identifiant personnel dans Analytics.

## Gardes, démarrage et portée de la validation

Les gardes distinctes à implémenter, toutes fermées en leur absence, sont `REFERRAL_PROGRAM_MODE=off|drain|active` côté serveur, `VITE_REFERRAL_DISPLAY_ENABLED=false` pour la section client et `VITE_REFERRAL_CHECKOUT_DISPLAY_ENABLED=false` pour le checkout. `off` interdit tout nouveau lien, remise ou gain normal. `drain` interdit les nouveaux filleuls/devis mais poursuit uniquement le traitement et la correction des relations déjà engagées. `active` autorise le programme complet. Aucune variable n'est ajoutée ni modifiée dans ce lot.

La V1 démarrera uniquement après configuration future de `REFERRAL_STARTS_AT_EPOCH_MS` à une date explicite, jamais par un `Date.now()` implicite. Aucun ancien client n'est importé comme filleul : aucun backfill historique, aucune remise ni récompense rétroactive. La qualification repose sur le cycle de commande serveur (paiement confirmé, livraison confirmée, remboursements confirmés), indépendamment du moyen de paiement. Un futur webhook Stripe doit alimenter le **même** cycle sans logique de parrainage spéciale.

**Contrat commercial figé pour l'implémentation backend.** La date d'effet, les variables/secrets, les textes légaux et l'activation restent hors de ce lot documentaire et requièrent des contrôles/une autorisation propres. Voir [l'architecture V1](PARRAINAGE-V1-ARCHITECTURE.md).
