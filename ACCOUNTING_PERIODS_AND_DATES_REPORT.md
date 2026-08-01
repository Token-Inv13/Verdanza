# Périodes et dates du module Comptabilité

Date du contrôle : 1er août 2026

Périmètre : module Admin Comptabilité de Verdanza
Anomalies traitées : `VDZ-AUD-002` et `VDZ-AUD-005`

## Nature du module

Le module est une synthèse de pilotage interne fondée sur les commandes et les règlements enregistrés dans Verdanza. Il ne remplace ni un livre légal des recettes, ni un logiciel comptable certifié, ni les déclarations fiscales ou sociales, ni les conseils d'un professionnel de la comptabilité.

La mention courte suivante est désormais affichée dans l'interface :

> Synthèse de pilotage interne fondée sur les commandes et règlements enregistrés dans Verdanza.

## Logique initiale et anomalies

Une fonction unique associait chaque commande à une date comptable. Pour une commande payée, elle choisissait `paymentConfirmedAt`, puis `updatedAt`, puis `createdAt`. Pour une commande non payée, elle choisissait `updatedAt`, puis `createdAt`. Le même ensemble `periodOrders` alimentait ensuite les indicateurs d'activité, d'encaissement, d'encours, de livraison et de marge.

Cette logique produisait deux ambiguïtés :

- une mise à jour administrative pouvait déplacer une commande dans une autre période commerciale ou financière ;
- les périodes étaient calculées dans le fuseau du navigateur et la période précédente par soustraction d'une durée en millisecondes, ce qui n'est pas équivalent à une période civile lors des changements de mois ou d'heure.

## Définitions métier retenues

| Indicateur | Ensemble | Date retenue | Fallback / qualité |
| --- | --- | --- | --- |
| Commandes créées | commandes actives créées dans la période | `createdAt` | aucun fallback silencieux vers `updatedAt` |
| Répartition locale / postale | commandes créées dans la période | `createdAt` | identique aux commandes créées |
| Reste à encaisser de la période | commandes non encaissées créées dans la période | `createdAt` | statuts `to_confirm`, `payment_link_sent`, `pending` |
| Encours actuel total | toutes les commandes actuellement non encaissées | aucune période | photographie globale, annulations et suppressions exclues |
| Commandes encaissées | commandes payées dont l'encaissement appartient à la période | date d'encaissement | qualité décrite ci-dessous |
| CA, livraison, remises et panier moyen payés | commandes encaissées dans la période | date d'encaissement | même définition pour tous les montants |
| Coût des ventes, marge et marges par produit | lignes des commandes encaissées | date d'encaissement | coûts figés conservés ; logique de coût existante inchangée |
| Achats fournisseurs validés | achats validés dans la période | `validatedAt` | `invoiceDate` seulement si `validatedAt` manque, avec compteur visible |
| Stock actuel estimé | produits et coûts fournisseurs actuels | aucune période | photographie actuelle, exclue des comparaisons historiques |

Les agrégats utilisent désormais cinq ensembles explicites : `createdOrdersInPeriod`, `paidOrdersInPeriod`, `receivableOrdersCreatedInPeriod`, `currentReceivableOrders` et `supplierPurchasesInPeriod`.

Les commandes annulées ou supprimées sont exclues. Une annulation reconnue par `orderStatus` ou `paymentStatus` est également exclue.

## Qualité des dates d'encaissement historiques

La résolution de la date d'encaissement suit cet ordre :

1. `exact` : `paymentConfirmedAt` ;
2. `legacy_explicit` : `paidAt` ;
3. `legacy_estimated` : `updatedAt`, puis `createdAt` ;
4. `missing` : aucune date exploitable.

Les fallbacks historiques ne sont jamais présentés comme des dates certaines. L'Admin affiche le nombre de règlements estimés ou sans date ainsi que des identifiants abrégés. Aucune commande n'est réécrite.

La commande historique de 71,55 EUR ne possède ni `paymentConfirmedAt` ni `paidAt`. Sa date reste temporairement estimée à partir de `updatedAt` et elle est signalée sous un identifiant masqué `JRP…`. Ses montants restent inchangés quand elle appartient à la période retenue :

- CA encaissé : 71,55 EUR ;
- coût des marchandises : 22,50 EUR ;
- marge brute : 49,05 EUR.

## Europe/Paris, bornes et périodes précédentes

Les bornes sont construites à partir de dates civiles dans le fuseau explicite `Europe/Paris`, puis converties en instants UTC pour comparer les timestamps Firestore, les chaînes ISO et les objets `Date` existants.

- semaine : lundi 00:00 inclus au lundi suivant 00:00 exclu ;
- mois : premier jour 00:00 inclus au premier jour du mois suivant 00:00 exclu ;
- année : 1er janvier 00:00 inclus au 1er janvier suivant 00:00 exclu ;
- personnalisée : début 00:00 inclus au lendemain de la fin 00:00 exclu ;
- précédente : semaine, mois ou année civile précédente ; pour une période personnalisée, même nombre de jours calendaires immédiatement antérieurs.

La borne de fin est toujours exclusive. Les tests confirment qu'une semaine contenant le passage à l'heure d'été dure 167 heures réelles et qu'une semaine contenant le passage à l'heure d'hiver dure 169 heures, tout en conservant sept jours civils.

L'implémentation repose sur `Intl.DateTimeFormat` et les données de fuseau de la plateforme, sans nouvelle dépendance. Les dates civiles sans heure sont interprétées à minuit à Paris. Les instants UTC stockés ne sont pas modifiés.

## Comparaisons

La période précédente compare uniquement des mesures homogènes :

- CA total encaissé ;
- commandes créées ;
- commandes encaissées ;
- coût des ventes encaissées ;
- marge brute encaissée ;
- achats fournisseurs validés.

L'encours actuel global et le stock actuel sont exclus des comparaisons. L'avertissement sur les dates historiques estimées reste visible au-dessus des métriques et de la comparaison.

## Valeurs avant et après

Les valeurs avant correction ont été relevées en lecture seule dans l'Admin de production. Les valeurs après correction ci-dessous proviennent du calcul déterministe testé avec le même état de données ; elles doivent être confirmées dans la même interface après déploiement.

| Période | Mesure | Avant | Après correction |
| --- | --- | ---: | ---: |
| Semaine 27/07–02/08 | Commandes rattachées / créées | 1 | 0 |
| Semaine 27/07–02/08 | Commandes encaissées | 1 | 1, date estimée signalée |
| Semaine 27/07–02/08 | CA / coût / marge | 71,55 / 22,50 / 49,05 EUR | 71,55 / 22,50 / 49,05 EUR |
| Semaine 27/07–02/08 | Locale / postale | 1 / 0 | 0 / 0 |
| Mois 01/08–31/08 | Commandes rattachées / créées | 1 | 0 |
| Mois 01/08–31/08 | Commandes encaissées | 1 | 1, date estimée signalée |
| Mois 01/08–31/08 | CA / coût / marge | 71,55 / 22,50 / 49,05 EUR | 71,55 / 22,50 / 49,05 EUR |
| Année 2026 | Commandes rattachées / créées | 1 | 1 |
| Année 2026 | Commandes encaissées | 1 | 1, date estimée signalée |
| Année 2026 | Achats fournisseurs validés | 522,55 EUR | 522,55 EUR |
| Toutes | Encours actuel total | non distingué | 0 EUR, carte indépendante de la période |
| Toutes | Stock actuel estimé | 340,81 EUR | 340,81 EUR, hors comparaison historique |

La dernière commande réelle de 40 EUR est annulée : elle reste exclue des commandes créées, de l'encours et des montants. Aucun client n'est identifié dans ce rapport.

## Tests

Le script `npm run test:accounting-periods` contient 47 assertions couvrant notamment les 25 scénarios demandés : transitions mois/année, année bissextile, DST printemps/automne, bornes inclusives/exclusives, périodes personnalisées, séparation création/paiement, encours de période/global, annulations/suppressions, dates historiques exactes/estimées/manquantes, achats fournisseurs, stock hors comparaison, arrondis et valeurs 71,55 / 22,50 / 49,05 EUR.

Le panneau Comptabilité est intégré dans le composant Admin monolithique et le projet ne possède pas de harnais de test React dédié. Un test d'intégration de composant n'a donc pas été ajouté ; la logique a été extraite dans deux modules purs et testée directement, tandis que l'interface fait l'objet d'une vérification responsive authentifiée.

Contrôles exécutés avant déploiement :

- `npm run lint` ;
- `npm run build` ;
- `npm run typecheck:api` ;
- `npm run test:accounting-periods` ;
- `npm run test:order-reliability` ;
- `npm run test:customer-invoices` ;
- `npm run test:catalog` ;
- `npm run test:promotions` ;
- `npm run test:admin-archives` ;
- `npm run test:supplier-purchases` ;
- `npm run test:supplier-invoice-import` ;
- `npm run test:supplier-invoice-pdf` ;
- `npm run audit:runtime` ;
- `npm run audit:performance`.

Tous passent. Le test PDF fournisseur conserve un avertissement non bloquant préexistant sur le module optionnel `canvas` de `pdfjs-dist`.

La synthèse a aussi été rendue dans un harnais local avec session et données de lecture simulées à 390 × 844, 768 × 900 et 1280 × 900. À chaque largeur, la largeur du document reste égale au viewport, les filtres et les deux champs personnalisés sont utilisables, les deux encours et l'avertissement historique sont visibles, et aucune erreur console n'est émise. La navigation par flèches entre onglets déplace désormais à la fois la sélection et le focus.

## Limites et invariants

- Aucune donnée historique n'est corrigée automatiquement.
- Une date de paiement estimée reste une approximation visible jusqu'à régularisation manuelle dans une mission distincte.
- Aucun historique de valeur de stock n'existe ; le stock ne peut donc pas être comparé à une période précédente.
- La logique de coût existante et les snapshots de coût des commandes restent inchangés.
- Aucun code de paiement, checkout, stock, coupon, facture, Analytics, SEO, GTM ou anti-abus n'est modifié.
- Aucun ordre, facture, paiement ou donnée client de test n'est créé en production.
