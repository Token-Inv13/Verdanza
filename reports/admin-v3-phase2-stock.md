# Admin V3 — Phase 2 : stock transactionnel et modale

État final : implémentation locale terminée, validations passées. Phase 2 non commitée, non poussée, non fusionnée et non déployée. Aucun appel ou changement Firebase Production, aucun envoi réel, aucune opération de paiement. Arrêt après ce rapport.

## 1. Commit Phase 1

SHA : dcb73ad827c849ddeb999cf66c269f27fc2557ed.

Message : feat(admin): add Admin V3 dialogs, product modal and grouped navigation.

Les 11 fichiers du diff validé ont été vérifiés puis commités localement. Le worktree Phase 1 est propre après commit. Base origin/main : eb35d8dcc7383528e6f4e7b53eebe02ce9bb413d.

## 2. Branche, worktree et HEAD Phase 2

Branche : codex/admin-v3-phase2-stock.

Worktree : worktree local Phase 2.

HEAD : dcb73ad827c849ddeb999cf66c269f27fc2557ed, identique au commit Phase 1. Les modifications Phase 2 restent locales et non indexées.

Le checkout canonique n’a reçu aucune modification de sources. Les commandes Git et les éditions Phase 2 ont utilisé le worktree ci-dessus.

## 3. Audit de l’ancien mécanisme

Le stock commercial est products/{productId}.stock. La boutique utilise aussi isActive pour la visibilité et lowStockThreshold pour les alertes. Les fleurs/résines sont vendues au gramme ; les formats fixes et les lignes au gramme consomment le même stock.

L’ancien chemin Admin → Stocks était StockRow → handleStockChange → updateProductStock → updateDoc(stock, lowStockThreshold, updatedAt), sans transaction, stock attendu, motif ni mouvement. En fallback local, il passait par upsertProduct. Le formulaire Produits envoyait également son stock avec toute la fiche : upsertProductAdmin possédait une transaction, mais réécrivait la valeur ancienne du formulaire sans comparer la quantité serveur. Les deux chemins pouvaient annuler une vente concurrente.

Le schéma historique stockMovements comprend id, productId, productName, type, quantity signée, note facultative, createdAt, createdBy, orderId et promotionId facultatifs. Types historiques : manual_add, sale, order_cancelled, return, loss, correction, restock, promotion_gift. Le helper navigateur createStockMovement n’avait aucun appel métier ; les règles autorisaient auparavant les créations, mises à jour et suppressions admin.

[api/_server/checkoutOrder.ts](<../api/_server/checkoutOrder.ts>) décrémente le stock, vérifie les quantités agrégées et crée les mouvements sale/promotion_gift dans la transaction de commande. L’idempotence checkoutRequestId reste inchangée.

[api/_server/orderCancellation.ts](<../api/_server/orderCancellation.ts>) restaure le stock par incrément transactionnel, ajoute order_cancelled et utilise stockRestoredAt pour éviter une seconde restauration. Les transitions, factures et promotions associées restent inchangées.

[api/_server/orderRefunds.ts](<../api/_server/orderRefunds.ts>) gère le financier et les avantages ; il n’écrit pas le stock produit. Un retour physique ne doit donc pas être inventé à partir d’un remboursement financier.

L’Atelier possède aussi un chemin serveur de publication/remise en boutique dans [api/_server/selectionRoute.ts](<../api/_server/selectionRoute.ts>). Il initialise le stock à la création et peut le redéfinir lors de la remise en boutique d’un produit lié inactif. Ce flux fournisseur → boutique est explicitement exclu de cette Phase 2 ; il reste inchangé et est signalé au point 17.

## 4. Architecture choisie

Admin → Stocks → AdminDialog → aperçu → AdminConfirmDialog → API Bearer authentifiée → transaction Firestore → résultat structuré → rafraîchissement ciblé.

Trois actions dédiées réutilisent /api/invoices, sans nouvelle fonction déployable :

- GET action=adminStockRead : valeurs serveur et 25 derniers mouvements du produit.
- POST action=adminStockOperation : correction transactionnelle.
- GET action=adminStockStatus : vérification du résultat d’un operationId.

L’API réutilise verifyFirebaseIdToken et assertAdminUser : identité issue du token vérifié, adminUsers actif, résolution UID/email vérifié existante. Un UID envoyé dans le payload ne donne aucun droit. Le produit est relu dans la transaction ; les produits marqués productionFixture sont refusés.

## 5. Fichiers créés

- [api/_server/adminStock.ts](<../api/_server/adminStock.ts>)
- [src/types/adminStock.ts](<../src/types/adminStock.ts>)
- [src/services/adminStockService.ts](<../src/services/adminStockService.ts>)
- [src/components/admin/StockDialog.tsx](<../src/components/admin/StockDialog.tsx>)
- [scripts/testAdminStock.ts](<../scripts/testAdminStock.ts>)
- [scripts/testAdminStockRules.ts](<../scripts/testAdminStockRules.ts>)
- [scripts/testAdminStockClient.ts](<../scripts/testAdminStockClient.ts>)
- [scripts/testAdminStockUi.ts](<../scripts/testAdminStockUi.ts>)

Ce rapport est aussi créé : [reports/admin-v3-phase2-stock.md](<../reports/admin-v3-phase2-stock.md>).

## 6. Fichiers modifiés

| Fichier | Changement |
| --- | --- |
| [api/invoices.ts](<../api/invoices.ts>) | Dispatch des trois actions stock dans l’API existante ; la sauvegarde d’un produit existant ignore stock et seuil ; stock initial validé côté serveur. |
| [firestore.rules](<../firestore.rules>) | Interdiction des modifications navigateur de stock/seuil et de toute écriture navigateur dans stockMovements ; lecture admin et flags produits conservés. |
| [firestore.cagnotte-read.indexes.json](<../firestore.cagnotte-read.indexes.json>) | Ajout de l’index stockMovements : productId ASC, createdAt DESC, __name__ DESC. Index existants conservés. |
| [src/pages/admin/AdminPage.tsx](<../src/pages/admin/AdminPage.tsx>) | Liste Stocks en lecture, ouverture par nom ou Modifier ; recherche, catégories, états et compteurs conservés ; suppression des cartes d’alerte dupliquées. |
| [src/hooks/useAdminData.ts](<../src/hooks/useAdminData.ts>) | Ajout du seul callback applyStockSnapshot, limité au stock et au seuil du produit concerné. |
| [src/components/admin/products/ProductEditor.tsx](<../src/components/admin/products/ProductEditor.tsx>) | Stock et seuil désactivés sur une fiche existante, avec indication de passer par Stocks. Initialisation d’un nouveau produit conservée. |
| [src/services/productsService.ts](<../src/services/productsService.ts>) | Suppression de updateProductStock, l’écriture Firestore directe. Lecture catalogue et fallback inchangés. |
| [src/services/stockMovementsService.ts](<../src/services/stockMovementsService.ts>) | Suppression du créateur navigateur inutilisé ; lecteur historique conservé. |
| [scripts/runCagnotteLedgerTests.ts](<../scripts/runCagnotteLedgerTests.ts>) | Mode admin-stock-only, cache de test dans le worktree, réutilisation du JAR officiel local avec vérification SHA-256 ; aucun téléchargement implicite. |
| [package.json](<../package.json>) | Trois scripts de test stock ajoutés ; dépendances et lockfile inchangés. |
| [scripts/fixtures/adminV3Fixture.tsx](<../scripts/fixtures/adminV3Fixture.tsx>) | Mode Stocks ajouté à la fixture isolée. |
| [scripts/fixtures/adminV3Mocks.ts](<../scripts/fixtures/adminV3Mocks.ts>) | Identité et token synthétiques, mise à jour ciblée de la liste, aucun adaptateur distant. |

## 7. Comportement transactionnel

Le serveur valide UUID v4, identifiant produit, quantités entières sûres non négatives, motif de la liste et note (1 000 caractères maximum ; obligatoire pour Autre). Il ne reprend ni delta ni auteur déclarés par le client.

La transaction lit d’abord le document d’opération puis le produit, compare stock et seuil attendus, calcule avant/après/delta réels, met à jour le produit et crée le mouvement. Toutes les lectures précèdent les écritures. L’échec de la création du mouvement annule également la modification du stock.

Un changement de seuil seul est permis, avec motif et mouvement à delta zéro. Une demande sans changement de stock ni seuil est refusée.

## 8. Stratégie de concurrence

Modèle choisi : « Nouveau stock », avec expectedStock et expectedLowStockThreshold. Aucun mode delta implicite.

Exemple : lecture 20, vente à 18, demande de définir 25 avec attendu 20 → HTTP 409 stock_conflict, stock conservé à 18, aucun mouvement admin. Un retry interne Firestore relit les valeurs puis applique la même comparaison ; il ne transforme pas la correction en ajout silencieux.

## 9. Stratégie d’idempotence et reprise réseau

Le UUID est créé à la confirmation et enregistré dans localStorage avant l’envoi. Le journal est séparé par UID admin. S’il ne peut pas être conservé, aucune correction n’est envoyée.

Le mouvement stockMovements/admin-stock-{operationId} sert aussi de résultat durable. Son empreinte SHA-256 couvre le payload normalisé. Le même ID avec les mêmes paramètres retourne le résultat enregistré ; le même ID avec un autre contenu est refusé. Un autre auteur ne peut pas réutiliser l’opération. Une vente ultérieure n’est jamais écrasée par le rejeu.

Timeout HTTP de 15 secondes, perte réseau, erreur serveur ou réponse illisible → opération conservée, formulaire bloqué et vérification du même ID. Résultat applied → succès reconnu ; not_executed → reprise explicite des mêmes paramètres et du même ID ; vérification indisponible → état incertain et bouton de vérification. Même si la requête originale termine après une réponse not_executed, le rejeu reste idempotent.

Fermeture ou remontage de l’admin → journal relu, bannière de récupération, vérification avant nouvelle correction. Un refus d’authentification ne suffit pas à effacer une opération incertaine. Les réponses d’une fiche fermée ne réappliquent pas leurs valeurs.

## 10. Structure des nouveaux mouvements

Champs métier : productId, productName, type=admin_adjustment, beforeStock, afterStock, delta, quantity=delta, beforeLowStockThreshold, afterLowStockThreshold, reason, note lisible, operationNote brute normalisée, createdBy, adminUid, createdAt serveur, appliedAt serveur, operationId, status=applied et requestFingerprint.

Les champs historiques restent compatibles ; aucun mouvement existant n’est converti ou réécrit. Le type admin_adjustment est traité par les types admin dédiés et le nouvel historique, sans changer les composants publics ni le type public Product.

## 11. UX de la modale Stocks

La liste pleine largeur conserve recherche, catégories, stock, seuil, actif/inactif, Stock OK/Stock bas/Rupture et compteurs. Le nom du produit ou Modifier ouvre la fiche.

La fiche lit le serveur, affiche nom, référence, catégorie, statut, stock actuel et seuil. Elle propose nouveau stock, seuil, motif et note, puis l’aperçu avant → après et variation signée. La confirmation récapitule produit, référence, quantités, variation, seuil et motif.

Le motif est obligatoire parmi Réception fournisseur, Correction inventaire, Produit endommagé/perdu, Retour en stock, Échantillon/utilisation interne, Autre. Autre exige une note. Réception fournisseur n’exécute aucune action comptable.

Pendant la mutation/vérification, actions et fermeture sont bloquées. Annuler la confirmation conserve la saisie et n’écrit rien. Après succès, la fiche reste ouverte et peut être fermée ; liste, valeurs et historique sont actualisés. Un résultat historique rejoué ne remplace pas un stock actuel par sa quantité ancienne. Un échec de lecture après succès est distingué d’un échec de correction et exige un rechargement avant une autre opération.

Le callback useAdminData met à jour uniquement stock/seuil du produit. Aucun refresh global n’est lancé par Stocks.

## 12. Comportement en conflit

La fiche reste ouverte et affiche valeur attendue, stock serveur et valeur demandée. Le bouton Recharger les valeurs fonctionne depuis la confirmation comme après retour au formulaire. Il recharge le serveur, conserve la cible demandée et impose une nouvelle confirmation manuelle. Il n’y a aucune relance automatique avec une nouvelle base.

## 13. Tests ajoutés

- testAdminStock.ts : transactions réelles sur émulateur, ajouts/retraits, vente concurrente, corrections simultanées, rollback, rejeu, empreinte, auteur, seuil, produit absent/protégé, données invalides, droits et protection du formulaire Produits ancien.
- testAdminStockRules.ts : interdiction navigateur stock/seuil et création/mutation/suppression des mouvements, y compris pour un admin ; lecture admin, lecture publique produit actif et flags conservés.
- testAdminStockClient.ts : journal, identité, perte après application, requête non reçue, réponses mal identifiées/illisibles, erreurs serveur, auth absente et journal corrompu.
- testAdminStockUi.ts : ouverture, valeurs, aperçu, annulation, Autre, pending, succès, historique/liste, conflit et reconfirmation, récupération après remontage, reprise du même ID, fermeture et absence de refresh global.

Les fixtures réutilisent AdminDialog et AdminConfirmDialog réels, dans un viewport fixe 390 × 844, sans serveur distant ni navigation multi-viewport.

## 14. Tests exécutés et résultats

| Contrôle | Résultat |
| --- | --- |
| npm run test:admin-stock | 14 groupes transaction/API + 22 contrôles de règles, PASS |
| npm run test:admin-stock-client | 7 groupes, PASS |
| npm run test:admin-stock-ui | 6 scénarios, PASS |
| npm run test:admin-v3 | 12 scénarios Phase 1, PASS |
| testProductAvailability.ts | 14 tests, PASS |
| testProductPurchaseOptions.ts | 9 tests, PASS |
| testFixedPriceFormats.ts | 19 tests, PASS |
| testProductCatalogFallback.ts | Catalogue autoritaire/vide/dégradé, panier et disponibilité, PASS |
| testProductCatalogPrerender.ts | 7 routes, SEO et indisponibilité du fallback, PASS |
| testAdminProductImagesDeletion.ts | PASS |
| testOrderReliability.ts | 13 tests, PASS |
| testOrderCancellationConsistency.ts | 24 tests, PASS |
| npm run test:order-refunds | 167 scénarios HTTP/émulateur, PASS |

Les scripts métier catalogue/commandes ont été exécutés avec le preload cagnotteNetworkGuard et des fixtures/mocks. Les suites Firestore ont utilisé exclusivement demo-verdanza-cagnotte, 127.0.0.1:18085, environnement limité sans credentials, JAR officiel 1.22.0 validé et processus Java appartenant au runner arrêté à la fin. Aucun téléchargement de dépendance n’a été lancé : la bibliothèque rules-unit-testing 4.0.1 a été reliée depuis une copie locale existante dans un dossier ignoré du worktree.

## 15. Lint, typecheck et build local

npm run lint, npm run typecheck et npm run typecheck:api : PASS. Typecheck ciblé des nouveaux tests serveur/règles et client/UI : PASS.

npm run verify:local-safety : PASS, zéro erreur, garde-fous conservés.

npm run build:local : PASS. Sitemap existant de 48 URLs validé sans réécriture ; Vite et PWA compilés ; 84 fichiers HTML prerender dans dist ; garde de build normal passée sur 435 fichiers. Le build écrit des sorties locales ignorées : il n’est pas qualifié de lecture seule.

## 16. Vérification du diff

git diff --check : PASS, sans sortie. Aucun changement Phase 2 indexé ni commité. Le worktree Phase 1 reste propre.

## 17. Limites et dettes restantes

Les règles et l’index sont uniquement préparés dans Git : leur état Production n’a pas été consulté ni modifié. Une future mise en service devra coordonner API, interface, règles et index ; l’émulateur ne prouve pas la disponibilité d’un index en Production.

Le journal local protège la reprise dans le navigateur qui l’a enregistré. Effacement volontaire du stockage ou changement d’appareil ne récupèrent pas automatiquement les opérations ; le mouvement serveur conserve toutefois l’ID et son résultat. Une correction est refusée si le journal ne peut pas être écrit.

L’historique affiche les 25 derniers mouvements, sans pagination. Aucun listener général n’est ajouté : les ventes ultérieures sont détectées à la relecture ou au conflit transactionnel.

La création d’un produit conserve son stock initial, validé côté serveur, sans mouvement admin_adjustment. Le flux Atelier fournisseur → boutique conserve également son comportement de création/remise en boutique, explicitement exclu de cette phase ; sa remise en boutique d’un produit inactif redéfinit encore le stock et ne bénéficie pas du protocole motif/expectedStock/operationId. Son harmonisation avec Stocks appartient à une phase distincte.

La recette visuelle humaine de l’admin réel reste à faire. Les tests UI automatisés portent sur une fixture locale fixe ; aucune session admin Production ni navigation multi-viewport n’a été réalisée. verify/verify:full complets n’ont pas été lancés ; les validations demandées et les garde-fous locaux listés ci-dessus ont été exécutés.

## 18. Résumé du diff et arrêt

Hors ce rapport : 20 fichiers concernés, 12 modifiés et 8 créés, +932 / −101 lignes. Avec ce rapport : 21 fichiers.

Le diff ajoute l’opération serveur atomique, son résultat durable, le client avec reprise et la modale Stocks ; ferme le writer navigateur et la réécriture accidentelle via Produits ; ajoute règles, index et tests. Aucun composant public, calcul de prix, flux commande/annulation/remboursement, cagnotte/parrainage ou fonctionnalité fournisseur → boutique n’a été modifié.

Phase 2 laissée non commitée pour validation. Aucun push, merge ou déploiement. Arrêt ici.
