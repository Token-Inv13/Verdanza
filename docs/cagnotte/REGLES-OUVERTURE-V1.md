# Cagnotte Verdanza — règles d’ouverture V1

Statut : référence commerciale validée, projet non publié
Date de validation commerciale : 6 septembre 2026
Version de politique : `cagnotte-commercial-policy-v1`
Version mathématique conservée : `cagnotte-math-v1`

Aucune date d’entrée en service n’est fixée. Cette validation ne vaut ni activation technique, ni publication, ni certification juridique. Les gains, réservations, remboursements, consultations et affichages normaux restent désactivés.

## Règles commerciales validées

### Acquisition

La fidélité représente 5 % des produits éligibles effectivement payés, après les réductions appliquées, hors livraison, produits gratuits et montant financé par cagnotte.

La création de commande ne produit qu’une estimation. Un paiement confirmé place le gain en attente. Le gain devient disponible lorsque le paiement et la livraison sont tous deux confirmés, sans délai supplémentaire. La livraison seule ne rend aucun gain disponible. Les deux ordres d’arrivée des confirmations et leur confirmation combinée sont admis. Les reprises et changements de statut ne doivent jamais créer un double gain.

Les formats à prix fixe et les règles ordinaires de livraison ne sont pas des promotions au sens de cette politique.

### Acquisition et utilisation sont distinctes

Une réduction ou un cadeau réellement appliqué bloque l’utilisation de cagnotte sur la commande. Il ne bloque pas l’acquisition sur le reliquat de produits effectivement payé.

| Avantage effectivement appliqué | Base d’acquisition | Utilisation de cagnotte |
|---|---|---|
| Aucun avantage | Produits payés hors cagnotte | Autorisée, dans la limite de 20 % |
| Code promotionnel | Produits restant payés après remise | Interdite |
| Gain de concours | Produits restant payés après avantage | Interdite |
| Promotion automatique | Produits restant payés après remise | Interdite |
| Cadeau promotionnel | Produits payants ; le cadeau à 0 EUR et sa valeur commerciale sont exclus | Interdite |
| Réduction de parrainage | Aucune règle nouvelle approuvée dans cette V1 | Qualification encore à valider ; aucune utilisation autorisée par défaut |
| Avantage inconnu | Aucune qualification implicite | Refus explicite en attente de qualification |

La présence d’un avantage vient du calcul serveur effectivement retenu : code valide et applicable, promotion automatique appliquée ou cadeau réellement ajouté. Un badge du navigateur, une offre seulement présente au catalogue, une offre expirée ou une offre non applicable ne suffit pas.

Les promotions et cadeaux ont priorité. Ils restent dans la commande lorsque l’utilisation de cagnotte est refusée. Une demande positive ne doit pas devenir silencieusement une commande avec utilisation nulle : le serveur renvoie le nouveau montant et le client doit accepter explicitement un nouveau devis ou continuer sans cagnotte.

Sur une commande compatible, l’utilisation est plafonnée à 20 % du montant des produits éligibles après réductions et avant cagnotte. La livraison reste hors de la base.

Exemple validé : 100 EUR de produits, remise appliquée de 10 EUR et aucune cagnotte utilisée donnent 90 EUR de produits payés et un gain estimé de 4,50 EUR. L’utilisation de cagnotte est interdite sur cette commande ; l’acquisition reste possible.

### Validité des crédits

Les crédits émis sous cette V1 n’expirent pas automatiquement. Aucun TTL, compteur d’expiration ou traitement de suppression ne doit être ajouté. Une suspension ou une future version du programme ne doit pas effacer rétroactivement les droits acquis. Les corrections causées par une annulation ou un remboursement restent applicables.

Les crédits sont des crédits boutique : ils ne sont pas convertibles en argent. Les anciens points ne sont pas convertis en euros par cette V1.

### Réservations impayées et revue à 72 heures

Une réservation reste en place jusqu’au paiement ou à une annulation administrative autorisée. Le seuil de 72 heures est un repère de revue manuelle. Il ne déclenche aucune annulation, libération, notification ou expiration automatique et ne doit pas être présenté au client comme tel.

Procédure de revue :

1. Relever la commande, son âge et le montant de cagnotte réservé.
2. Vérifier les preuves disponibles : statut de paiement, référence, envoi de lien et éventuel résultat `sending` ou `unknown`.
3. Si un paiement est confirmé, poursuivre son traitement normal. Si le résultat est incertain ou en cours de vérification, conserver la réservation et résoudre manuellement l’incertitude.
4. Si aucun paiement n’est confirmé ou en cours de vérification, choisir explicitement entre maintien de la réservation et annulation administrative.
5. Tracer l’acteur, la date, le motif et la conséquence. Une annulation autorisée libère la réservation selon le mécanisme transactionnel existant.

Limite actuelle à traiter dans le lot des outils administratifs : la transition générale vers `cancelled` ne bloque pas elle-même une commande dont `paymentLinkDelivery.status` vaut `sending` ou `unknown`. L’opérateur doit donc vérifier cet état avant l’annulation. Ce processus manuel ne constitue pas une vérification bancaire automatique.

Les protections existantes restent requises : une réservation consommée ne peut pas être libérée, une réservation libérée ne peut pas être consommée et une commande cagnotte annulée ne peut pas être réactivée pour enregistrer un paiement tardif.

### Régularisation et compensations

Un gain annulé après avoir été utilisé peut créer un montant interne à régulariser. Aucun paiement, prélèvement, frais ou intérêt n’est demandé au client. Les réservations déjà engagées sur d’autres commandes ne sont pas reprises ni modifiées.

Les prochains gains compensent la régularisation au moment où ils deviennent disponibles, jamais lorsqu’ils sont seulement en attente. Une libération ou une restitution est journalisée pour son montant brut ; elle compense ensuite la régularisation et seul le reliquat augmente le disponible. Le remboursement financier reste inchangé.

Exemple validé : une restitution brute de 8 EUR avec 3 EUR à régulariser produit une compensation de 3 EUR et une augmentation du disponible de 5 EUR. Les mouvements restent distincts et traçables. Cette opération n’est ni un nouveau gain ni une somme facturée au client.

## Conventions mathématiques conservées

`cagnotte-math-v1` demeure inchangée : calculs en centimes entiers, arrondis existants, allocation déterministe des centimes, plafond de 20 % et taux de 5 %. Les cadeaux gratuits ont une base monétaire nulle et leur valeur commerciale reste informative. Les remboursements utilisent les allocations enregistrées dans l’instantané original ; ils ne recalculent pas les promotions historiques.

La politique commerciale possède sa propre version. Elle ne change ni les versions de schéma, ni les instantanés déjà enregistrés. Une ancienne commande est reprise à partir de sa commande et de ses empreintes persistées, sans recalcul selon une politique plus récente.

## Texte client — projet non publié

### Résumé court

Vous cumulez 5 % de fidélité sur les produits éligibles réellement payés. Votre cagnotte devient disponible après confirmation du paiement et de la livraison. Les crédits V1 n’expirent pas automatiquement.

### Cumuls

Lorsque cette commande bénéficie d’un code, d’un gain de concours, d’une promotion automatique ou d’un cadeau promotionnel, l’offre est conservée et la cagnotte ne peut pas être utilisée. Vous continuez à cumuler de la fidélité sur les produits restant effectivement payés si le serveur confirme leur éligibilité. Sur une commande compatible, l’utilisation de cagnotte est limitée à 20 % des produits éligibles ; la livraison n’entre pas dans ce calcul.

### Disponibilité

Le montant affiché lors de la commande est une estimation. Après confirmation du paiement, le gain apparaît en attente. Il devient disponible lorsque la livraison est également confirmée, sans délai supplémentaire.

### Régularisation

Une annulation ou un remboursement peut corriger un gain déjà utilisé. Le montant à régulariser est compensé par de prochains gains lorsqu’ils deviennent disponibles, ou par une restitution/libération de cagnotte. Aucun paiement, frais ou intérêt ne vous est demandé, et le remboursement financier n’est pas réduit.

Ce texte est un projet d’explication du fonctionnement. Il ne remplace ni les CGV, ni les mentions légales, ni une validation comptable ou fiscale.

## Activation et décisions non couvertes

La politique commerciale ne sert pas de garde d’activation. Les constantes normales restent désactivées et aucune date d’ouverture n’est définie. L’activation devra faire l’objet d’une autorisation distincte.

Restent hors de cet accord : synthèse comptable et qualification fiscale, TVA et informations légales, définition des montants GA4 `purchase`/`refund`, émission d’avoirs, outil de correction d’une saisie administrative, secrets, limiteur, index distants, activation, règles détaillées du parrainage et refonte.
