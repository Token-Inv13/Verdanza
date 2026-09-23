# Parrainage Verdanza V1 — proposition de contrat commercial

**Statut : proposition à valider, non approuvée, non publiée, sans date d'effet.** Ce document ne modifie aucune règle active, aucun solde et aucune donnée Production. Une décision commerciale, puis une autorisation technique et une date de démarrage distinctes seront nécessaires.

## Point de départ audité

Base : `origin/main` `6634e8f89545ba31a66098f614b9e680d9dcd6b7` (23 septembre 2026). `src/lib/cagnotteCalculations.ts` contient seulement `REFERRAL_REFERENCE_CENTS = { sponsorReward: 1000, refereeDiscount: 500, minimumProducts: 5000 }` et précise : « Reference amounts only; this module never attributes a referral reward. » `checkReferralAmountThreshold` ne teste qu'un montant, avec `customerEligibility: not_evaluated`. Ce n'est **pas** une approbation du barème.

`src/types/cagnotte.ts` connaît `referral_discount`, mais `src/lib/cagnotteCommercialPolicy.ts` le classe `needs_validation`. `docs/cagnotte/REGLES-OUVERTURE-V1.md` exclut explicitement les règles détaillées du parrainage et n'autorise aucune utilisation de cagnotte par défaut avec cet avantage. Ce comportement reste en vigueur. Le calcul de fidélité existant est de 5 % des produits réellement payés, après remises et hors livraison/cagnotte ; son gain devient disponible après paiement **et** livraison.

## Barèmes à arbitrer

Les trois lignes sont des **simulations**, sans remise ni récompense créée. Le seuil porte sur les produits payants éligibles **avant** la remise filleul, hors livraison et cadeaux. Les exemples supposent une première commande sans autre avantage, aucun remboursement, un paiement et une livraison confirmés. Le « coût nominal » additionne remise filleul et crédit boutique promis au parrain ; il n'est ni une marge nette ni un décaissement immédiat. La fidélité filleul est présentée séparément, car elle existe déjà et ne doit pas être confondue avec le coût incrémental du parrainage.

| Variante | Parrain | Filleul | Seuil produits | Coût nominal par relation qualifiée |
|---|---:|---:|---:|---:|
| Prudente | 5 € | 3 € | 50 € | 8 € |
| Référence technique à analyser | 10 € | 5 € | 50 € | 15 € |
| Généreuse | 15 € | 7 € | 50 € | 22 € |

| Panier produits | Variante | Produits réellement payés hors livraison | Fidélité filleul estimée à 5 % | Remise + crédit parrain + fidélité filleul |
|---:|---|---:|---:|---:|
| 50 € | Prudente / Référence / Généreuse | 47 € / 45 € / 43 € | 2,35 € / 2,25 € / 2,15 € | 10,35 € / 17,25 € / 24,15 € |
| 75 € | Prudente / Référence / Généreuse | 72 € / 70 € / 68 € | 3,60 € / 3,50 € / 3,40 € | 11,60 € / 18,50 € / 25,40 € |
| 100 € | Prudente / Référence / Généreuse | 97 € / 95 € / 93 € | 4,85 € / 4,75 € / 4,65 € | 12,85 € / 19,75 € / 26,65 € |

**Recommandation à soumettre :** retenir la variante de référence 10 €/5 €/50 € seulement après examen de la marge, du taux d'utilisation des crédits et des abus. La variante prudente réduit de 7 € le coût nominal par relation ; la généreuse l'augmente de 7 €. Aucune des trois n'est validée par ce document. Les montants, le seuil et leur coût restent des décisions commerciales ouvertes.

## Personnes et attribution proposées

Un « nouveau client » serait un UID Firebase authentifié, dont l'email de compte normalisé est vérifié, sans commande de produits **déjà payée** avant l'attribution ou le démarrage futur du programme, quel qu'en soit le montant, et sans relation de parrainage déjà consommée. Les commandes seulement créées, annulées avant paiement ou échouées ne disqualifient pas. Une commande payée puis remboursée reste une première commande et ne rouvre pas le droit. Le serveur confronte UID, email normalisé et historique des commandes ; en cas de doublon plausible ou de preuve incomplète, il refuse ou met en revue sans attribuer de remise. Pas de suivi d'appareil, d'adresse IP persistée pour l'identité ni de fingerprinting.

Un même filleul ne peut être lié qu'à un parrain. Le lien est établi côté serveur après authentification et contrôle du code, jamais par le seul paramètre d'URL. Avant la première commande payée, le filleul peut abandonner un code non qualifié ; un changement de parrain exigerait une nouvelle action explicite et une trace serveur. Dès qu'une première commande payée utilise la remise, la relation et le parrain deviennent immuables. L'auto-parrainage est interdit (même UID ou même email normalisé). Le code partageable est rattaché à l'UID du parrain, sans nom ni email encodé.

| Éligibilité parrain | Atout | Limite | Avis |
|---|---|---|---|
| Tout compte authentifié | Simple, large | Comptes jetables pouvant parrainer d'autres comptes jetables | Non recommandé en V1 |
| Au moins une commande de produits payée **et livrée** | Preuve commerciale déjà dans le cycle de commande ; limite les créations opportunistes | Réduit le bassin initial et exige une vérification serveur | **Recommandé**, sans conversion rétroactive en filleuls |

L'éligibilité du parrain est revérifiée lorsque le code est attribué et lors de la qualification de la commande filleul. Un compte parrain désactivé ne crée plus de nouveaux liens ni de nouveaux gains ; une récompense déjà acquise reste soumise uniquement aux règles de correction et aux obligations applicables, non à une suppression arbitraire.

## Commande, remise et cumuls proposés

La remise fixe filleul s'appliquerait à **la première commande payée de produits** après attribution, si le devis serveur confirme au moins 50 € de produits éligibles avant remise. Elle est répartie en centimes sur les lignes payantes éligibles ; livraison et cadeau gratuit sont exclus. Elle n'est ni convertible en espèces, ni transférable, ni fractionnable et ne s'utilise qu'une fois. Une première commande payée sans remise (sous le seuil, avec un avantage prioritaire, ou créée impayée avant le lien puis réglée ensuite) clôt l'éligibilité de cette relation ; l'interface l'annonce avant paiement. Une commande abandonnée ou annulée avant paiement ne la consomme pas. Le devis et la commande enregistrent la version du contrat et l'allocation par ligne ; aucun recalcul rétroactif selon un barème futur.

**Proposition de non-cumul V1 :** un code promo, un gain de concours, une promotion automatique ou un cadeau effectivement appliqué conserve sa priorité actuelle et bloque la remise filleul sur cette commande. Une offre seulement visible mais non appliquée ne bloque rien. Si la remise filleul est effectivement appliquée, l'utilisation de cagnotte est interdite ; le client doit accepter explicitement le devis sans cagnotte. Le parrainage ne doit pas effacer silencieusement une promotion déjà retenue. L'application d'un avantage prioritaire sur la première commande payée clôt la possibilité d'utiliser le parrainage, sans gain parrain. Ce choix simple évite une combinaison de coûts non étudiée ; il doit être approuvé avec le barème.

L'acquisition de fidélité filleul reste possible sur le reliquat de produits **réellement payé** selon les règles existantes. Pour 50 € de produits avec la remise de référence de 5 €, aucun autre avantage ni cagnotte utilisée : base payée 45 €, fidélité estimée 2,25 €. Le parrain recevrait séparément 10 € seulement lorsque la commande filleul est payée **et** livrée et que les contrôles de remboursement sont satisfaits. Aucune récompense de parrainage ne doit prendre la forme du `payment_confirmed` de la propre commande du parrain.

| Moment du gain parrain | Risque | Décision proposée |
|---|---|---|
| Dès paiement filleul | Crédit disponible alors qu'annulation/livraison échouée reste possible | Rejeté pour la disponibilité |
| Après paiement **et** livraison filleul | S'aligne sur la disponibilité fidélité et réduit le crédit prématuré | **Retenu en proposition** : montant en attente après paiement, disponible après livraison ; aucun délai supplémentaire implicite |

## Annulations, remboursements et corrections proposés

La commande annulée avant paiement ne consomme pas la remise ; aucun gain parrain. Le paiement confirmé consomme la remise une fois et inscrit la récompense du parrain **en attente**. Un remboursement confirmé avant livraison annule la récompense en attente si la base de produits conservés passe sous le seuil ; un remboursement intégral l'annule toujours. Une commande annulée après paiement suit les faits de paiement/remboursement enregistrés : le simple statut ne fabrique ni remboursement ni contrepassation financière.

Après livraison, un remboursement confirmé qui ramène les produits conservés éligibles sous 50 € contrepasserait **la totalité** du gain parrain, une seule fois ; au-dessus ou au seuil, les 10 € restent dus. Pour un remboursement partiel, la base conservée est calculée à partir des lignes et allocations d'origine et des retours **cumulés**, sans réévaluer prix ni promotions historiques. Exemple : 60 € de produits initiaux, puis 15 € de produits d'origine retournés → 45 € conservés, récompense parrain annulée/contrepassée. La remise de 5 € déjà utilisée reste dans le prix payé ; la V1 proposée ne réclame pas rétroactivement cette remise au filleul et ne la réémet pas sur un autre achat. Les retours sont remboursés selon l'allocation originale de la remise par ligne.

Toute correction postérieure passe par des mouvements append-only. Si le crédit du parrain a déjà été dépensé, appliquer la régularisation interne du wallet, sans prélèvement ni réduction du remboursement financier ; les réservations d'autres commandes restent intactes. Une correction de déclaration de remboursement doit comparer le cumul effectif avant/après, éviter tout second mouvement et, si une erreur restaurée rend de nouveau le seuil, rétablir le droit par un événement compensateur unique et audité. Les modalités précises des corrections, y compris ce dernier cas, sont à tester et approuver avant développement.

## Expérience, administration et données

Le compte client pourrait ajouter une sous-section **Parrainage** dans `Mes avantages` (`/compte/avantages`) : code/lien et bouton copier, nombre de filleuls, statuts en attente/acquis/annulés, montants et règles simples. Un code arrivé par lien est porté jusqu'à la connexion, puis validé sur le serveur ; aucune attribution n'est créée par l'URL seule et aucun cookie de longue durée n'est proposé. Le panier expose la remise ou la raison de son refus et demande l'acceptation du nouveau devis si la cagnotte demandée est bloquée. Les montants en attente ne sont jamais présentés comme utilisables.

L'administration minimale montrerait parrain, filleul, relation, commande qualifiante, remise, gain, statut et historique. La recherche se fait sous contrôle admin, avec traces d'accès. Une annulation/correction exige référence d'événement, motif, acteur et vérification des faits ; aucun bouton libre « ajouter 10 € ».

Les données nouvelles visées sont les UID, code aléatoire, relation, IDs de commande, montants, statuts, horodatages et références de mouvements. Pour empêcher la réutilisation raisonnablement détectable d'un email après recréation de compte, une empreinte **HMAC serveur** de l'email normalisé est proposée comme clé d'unicité ; elle reste une donnée personnelle dérivée, protégée et non exposée au client. Ne pas copier email, nom, adresse ou téléphone dans les documents de parrainage. Si une vérification fiable des données existantes suffit sans cette clé, la supprimer à la conception détaillée. Conservation alignée sur les justificatifs de commande et le ledger financier, durée exacte à fixer avec la politique de conservation ; éviter toute suppression automatique qui détruirait la preuve d'un gain/correctif.

Événements Analytics possibles, **non activés** : `referral_link_copied`, `referral_signup_attributed`, `referral_order_qualified`, `referral_reward_granted`. Seulement catégories, version de politique et montants agrégés en centimes si nécessaires ; aucun UID, email, code, lien complet, orderId ou autre identifiant personnel dans Analytics.

## Gardes et décisions avant une phase suivante

Concevoir des gardes distinctes, toutes fermées en leur absence : `REFERRAL_PROGRAM_MODE=off` côté serveur pour aucune nouvelle relation/remise/gain ; `VITE_REFERRAL_DISPLAY_ENABLED=false` pour la section client ; `VITE_REFERRAL_CHECKOUT_DISPLAY_ENABLED=false` pour la présentation checkout. Une suspension future devra arrêter les nouvelles attributions tout en permettant de corriger les obligations déjà enregistrées par un traitement serveur contrôlé. Aucune variable n'est ajoutée ni modifiée dans ce lot.

La V1 future démarrerait à une date explicite et n'importerait aucun ancien client comme filleul : aucun backfill historique, aucune remise ni récompense rétroactive. La qualification repose sur le cycle de commande serveur (paiement confirmé, livraison confirmée, remboursements confirmés), indépendamment du moyen de paiement. Un futur webhook Stripe doit alimenter le **même** cycle sans logique de parrainage spéciale.

**À approuver avant code :** barème et coût accepté ; premier achat et clôture d'éligibilité ; condition parrain ; priorité exacte des avantages ; règle de remboursement sous seuil et correction ; texte client/CGV/confidentialité ; date de démarrage et gardes d'activation. Voir [l'architecture proposée](PARRAINAGE-V1-ARCHITECTURE.md).
