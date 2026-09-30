# Admin V3 — Phase 11A.1 : raccordement final et certification UX

Base locale : c63b5963c03a2dd714eef85ad6fbf626ec354eec, branche codex/admin-v3-final-polish. Le rapport Phase 11A décrit l'état avant correction ; celui-ci décrit le candidat final. Les tests utilisent des fixtures et émulateurs locaux. Ils ne constituent pas une recette de données Production.

## F1 — Paramètres

Avant : la route exposait un texte de remplacement sans service ni action. Après : la route ouvre AdminSettingsPage, un centre de configuration alimenté par les lectures existantes. Facturation lit settings/billing et indique si la configuration est validée, absente et locale non validée, ou indisponible. Livraisons lit deliveryZones côté serveur et distingue zones présentes, collection vide et erreur. L'IA affiche seulement disabled / missing_configuration / ready renvoyé par le serveur, sous les libellés Désactivée / Configuration incomplète / Prête ; aucune clé, nom de variable secrète ou valeur sensible n'est rendue. Produits, Stocks, Sélection et Marketing disposent de liens vers leurs écrans spécialisés. Aucun nouveau stockage, réglage éditable ou comportement d'activation n'est inventé. Les liens de facturation et de livraison conduisent aux écrans où les écritures persistantes existaient déjà.

## F2 — vérité des lectures Admin

Les lectures Admin de products, orders, coupons, promoBanners, customers, invoices, settings/billing, deliveryZones, productCosts, supplierPurchases, favorites et reviews propagent maintenant l'absence de client, les lectures cache Firestore non confirmées et les exceptions. Le secours statique reste réservé aux usages publics qui l'avaient déjà ; useAdminData appelle une lecture stricte pour la livraison et ne consomme plus les fallbacks locaux des listes Admin. Un document billing absent après lecture serveur réussie conserve le modèle local, explicitement marqué non enregistré et non validé. Les erreurs de lecture ne produisent plus une source empty ni un compteur 0 confirmé.

useAdminData suit loading, firestore, empty, local et error par ressource ; local correspond à degraded dans l'interface. Dashboard, Produits, Stocks, Commandes, Livraisons et chaque onglet Comptabilité masquent leurs chiffres et actions dépendants si une source primaire échoue, avec alerte et retry. Une source secondaire en panne conserve la vue valide avec avertissement. Archives, favoris, avis, Marketing, analytics, concours, commentaires et les ressources Clients distinguent erreur et vide. Pour Clients, une erreur de première page masque l'ancienne liste ; une erreur de pagination conserve les pages déjà confirmées avec avertissement et retry. La fiche reste montée durant la relecture après mutation ; les données précédentes sont signalées et les actions d'administration sont bloquées jusqu'au résultat.

## F3 — Atelier de sélection

La lecture auxiliaire du catalogue commercial dans AdminSelectionPage expose un warning et un retry ; la liste principale reste utilisable et garde ses chiffres confirmés. Le lien produit et le passage en boutique sont bloqués tant que le catalogue n'est pas confirmé. La lecture auxiliaire du contexte de prix dans SelectionPricing expose un warning et un retry ; les champs manuels restent disponibles, mais l'enregistrement de politique dépendant de ce contexte est bloqué. Les deux pannes simultanées n'affichent aucun faux zéro. La lecture facultative d'image privée montre désormais aussi une erreur contextualisée et un retry, tout en conservant l'image fournisseur comme référence non autoritative.

La fixture locale couvre A (catalogue KO), B (prix KO), C (deux KO), D (retry réussi), E (aucune rejection non gérée), F (aucune écriture de politique ou de lien dépendant d'une donnée indisponible). La liste principale KO dispose elle-même d'un état erreur, de chiffres non disponibles et d'un retry.

## Matrice finale des 22 entrées

La colonne « vide » signifie toujours une réponse réussie et confirmée par la source principale ; « erreur » indique ce qui est rendu à l'utilisateur. Les ressources secondaires en panne sont signalées sans remplacer les données primaires valides. Aucun fallback local ne devient autoritatif après une exception.

| Entrée | Source principale | Source secondaire | Vide confirmé | Erreur affichée / retry | Fallback | Erreur ≠ vide ? | Statut |
|---|---|---|---|---|---|---|---|
| Dashboard | Firestore produits + commandes | Zones livraison | Métriques 0 confirmées | Panne principale : chiffres masqués ; zone KO : warning | Aucun Admin | Oui | CONNECTED_WITH_WARNING |
| Analytics | API analytics Admin | Aucune | Agrégats 0 confirmés | Vue indisponible, actualiser | Aucun | Oui | READ_ONLY |
| Sélection | API sélection privée | Catalogue, prix, image | Liste vide confirmée | Panne principale : liste masquée ; auxiliaires : warnings et retries | Image fournisseur signalée | Oui | CONNECTED_WITH_WARNING |
| Produits | Firestore products | Images Storage | « Aucun produit » | Liste et actions masquées, retry | Aucun Admin | Oui | CONNECTED |
| Stocks | Firestore products | Lecture stock serveur, journal local de reprise | Liste vide confirmée | Liste masquée ou détail en erreur, retry | Journal non autoritatif | Oui | CONNECTED |
| Commandes | Firestore orders | Détails/actions serveur | Liste vide confirmée | Liste et actions masquées, retry | Aucun Admin | Oui | CONNECTED |
| Clients | API clients paginée | Résumé, commandes, coupons, autres onglets | Liste/page vide confirmée | Première page masquée ; page suivante warning et retry | Aucun | Oui | CONNECTED_WITH_WARNING |
| Livraisons | Firestore deliveryZones strict | Aucune | Aucune zone en base | Vue masquée, retry | Aucun Admin | Oui | CONNECTED |
| Marketing | API contexte Marketing | Assistant IA indépendant | Aucun brouillon confirmé | Contexte masqué, rafraîchir | Aucun | Oui | CONNECTED |
| Bannières | API contexte Marketing | Détails des bannières | Aucune bannière confirmée | Contexte masqué, rafraîchir | Aucun | Oui | CONNECTED |
| Promotions | API contexte Marketing | Détails des coupons | Aucune promotion confirmée | Contexte masqué, rafraîchir | Aucun | Oui | CONNECTED |
| Concours | API contexte et liste concours | Détail / participants | Aucun concours confirmé | Compteur indisponible, liste masquée, retry | Aucun | Oui | CONNECTED |
| Avis | Firestore productReviews | Produit associé | Aucun avis confirmé | Alerte, liste masquée, retry | Aucun | Oui | CONNECTED |
| Commentaires | API commentaires Admin | Titres de guides statiques | Aucun commentaire confirmé | Compteur indisponible, liste masquée, retry | Aucun | Oui | CONNECTED |
| Favoris | Firestore favorite stats | Noms produits | Aucun favori confirmé | Alerte, liste masquée, retry | Aucun | Oui | READ_ONLY |
| Archives | Source stricte par onglet | Aucune | Aucune archive confirmée | Compteur —, table masquée, retry | Aucun Admin | Oui | CONNECTED |
| Comptabilité | Produits, commandes, factures, billing, coûts, achats | Sous-onglets spécialisés | Valeurs 0 confirmées | Onglet dépendant masqué, retry | Billing local si document absent seulement | Oui | CONNECTED_WITH_WARNING |
| Achats fournisseurs | API achats fournisseurs | Produits pour rapprochement | Aucun achat confirmé | Onglet indisponible, retry | Aucun | Oui | CONNECTED |
| Coûts manuels | API coûts produits | Produits et achats | Aucun coût confirmé | Onglet indisponible, retry | Aucun | Oui | CONNECTED |
| Factures | Firestore invoices | Commandes, billing | Aucune facture confirmée | Onglet indisponible, retry | Aucun | Oui | CONNECTED |
| Facturation | Firestore settings/billing | Aucune | Document absent confirmé | Erreur bloquante ; absence document dégradée | Modèle local non validé uniquement après absence confirmée | Oui | CONNECTED_WITH_WARNING |
| Paramètres | Billing, zones, statut IA serveur | Liens modules spécialisés | Vide réel indiqué par domaine | État indisponible par carte, recharger | Billing local explicitement dégradé | Oui | READ_ONLY |

Les 22 routes demeurent protégées par la garde Admin existante ; les endpoints sensibles conservent leurs contrôles serveur. Aucun statut PLACEHOLDER, SILENT_FALLBACK ou UNKNOWN ne subsiste dans cette matrice. CONNECTED qualifie le raccordement du code et des tests locaux, sans affirmer qu'une opération Production a été faite.

## UX, sécurité et IA

Les huit groupes de sidebar restent rabattables, le groupe actif s'ouvre automatiquement, Gestion reste séparé de Paramètres et la scrollbar masquée conserve le défilement. Dashboard et Marketing gardent leur hiérarchie simplifiée. Les écrans de Paramètres, Dashboard, sidebar, Produits, Stocks, Clients, Marketing et Sélection sont vérifiés à 1440×1000, 1280×720, 820×900 et 390×844 sur fixtures locales. Les captures Paramètres et Atelier ont été inspectées visuellement : texte et warnings lisibles, pas de débordement. Captures principales hors Git : sidebar-after-1440.png, sidebar-after-390.png, dashboard-after-1440.png, dashboard-after-390.png, dashboard-read-error-390.png, settings-ai-off-1440.png, settings-after-1440.png, settings-after-390.png, settings-read-error-1440.png, selection-after-1440.png, selection-after-390.png, selection-catalog-error-1100.png, clients-after-1440.png, clients-after-390.png, marketing-after-1440.png, marketing-after-390.png.

Chaîne IA statique : MarketingAiAssistant → marketingAiService → /api/admin-contests?action=marketing-ai → assertAdminUser/adminUsers → projection whitelist des produits Firestore actifs et disponibles → marketingAiProvider. Le provider exige opt-in, modèle et clé, applique le transport simulé en tests et envoie store:false sur l'appel réel seulement après activation. IA TECHNIQUEMENT PRÊTE : OUI pour le code et les tests simulés ; aucun appel fournisseur réel qualifié dans cette phase. État Production connu avant cette phase : MARKETING_AI_ENABLED, MARKETING_AI_MODEL et OPENAI_API_KEY absents ; IA OFF. Aucun secret n'a été lu, créé, rendu ni transmis.

## Validation et périmètre

Tests ajoutés/étendus : test:admin-settings-ui, test:admin-read-states-ui, test:admin-v3 (primaire/secondaire/vide/retry), test:admin-customers-ui (première page/pagination), test:selection-pipeline-ui (F3 A–F). Les tests de navigation, archives, concours et blog existants ont été rejoués. Les suites transactionnelles emploient les émulateurs et fixtures locaux. Aucun push, PR, merge, déploiement, écriture Firebase Production ou appel/provisioning OpenAI dans 11A.1.

Résultats locaux : verify:local-safety PASS (0 erreur), lint PASS (0 avertissement), typecheck PASS, typecheck:api PASS, build:local PASS (86 pages pré-rendues), verify:admin-v3 PASS (suites Stock, Clients, Sélection, Marketing, IA et catalogue public), test:admin-settings-ui PASS, test:admin-read-states-ui PASS, test:admin-nav-ui PASS, test:admin-archives PASS, test:contests PASS et test:blog-engagement PASS. Les refus PERMISSION_DENIED des tests de règles sont des scénarios attendus sur émulateur et sont validés par leurs assertions. Les scans du diff et l'état Git sont contrôlés avant et après le commit local.

## Fichiers modifiés (Phase 11A + 11A.1)

```text
api/_server/marketingAi.ts
api/_server/marketingAiProvider.ts
package.json
reports/admin-v3-phase11a-final-audit.md
reports/admin-v3-phase11a1-certification.md
scripts/fixtures/adminNavFixture.tsx
scripts/fixtures/adminNavMocks.tsx
scripts/fixtures/adminReadStatesFixture.tsx
scripts/fixtures/adminReadStatesMocks.ts
scripts/fixtures/adminSettingsFixture.tsx
scripts/fixtures/adminSettingsMocks.ts
scripts/fixtures/adminV3Fixture.tsx
scripts/fixtures/adminV3Mocks.ts
scripts/fixtures/marketingFixture.tsx
scripts/fixtures/selectionPipelineFixture.tsx
scripts/fixtures/selectionPipelineMocks.ts
scripts/testAdminCustomersUi.ts
scripts/testAdminNavUi.ts
scripts/testAdminReadStatesUi.ts
scripts/testAdminSettingsUi.ts
scripts/testAdminV3.ts
scripts/testMarketingAiUi.ts
scripts/testMarketingAiUnit.ts
scripts/testMarketingUi.ts
scripts/testSelectionPipelineUi.ts
src/App.tsx
src/components/admin/customers/CustomerActivity.tsx
src/components/admin/customers/CustomerAdministration.tsx
src/components/admin/customers/CustomerDialog.tsx
src/components/admin/customers/CustomerLoyalty.tsx
src/components/admin/customers/CustomerOrders.tsx
src/components/admin/customers/CustomerReferral.tsx
src/components/admin/customers/CustomerResource.tsx
src/components/admin/customers/CustomersTable.tsx
src/components/admin/marketing/MarketingAiAssistant.tsx
src/components/admin/marketing/MarketingOverview.tsx
src/components/admin/selection/SelectionPricing.tsx
src/hooks/useAdminCustomerResource.ts
src/hooks/useAdminData.ts
src/layouts/AdminLayout.tsx
src/pages/admin/AdminArchivesPage.tsx
src/pages/admin/AdminBlogCommentsPage.tsx
src/pages/admin/AdminContestsPage.tsx
src/pages/admin/AdminMarketingPage.tsx
src/pages/admin/AdminPage.tsx
src/pages/admin/AdminSelectionPage.tsx
src/pages/admin/AdminSettingsPage.tsx
src/services/adminCustomersService.ts
src/services/couponsService.ts
src/services/deliveryZonesService.ts
src/services/favoritesService.ts
src/services/invoicesService.ts
src/services/marketingAiService.ts
src/services/ordersService.ts
src/services/productCostsService.ts
src/services/productsService.ts
src/services/promoBannersService.ts
src/services/reviewsService.ts
src/services/supplierPurchasesService.ts
src/styles/index.css
```
