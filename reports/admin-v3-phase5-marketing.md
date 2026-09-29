# Admin V3 — Phase 5 : Marketing V2

Rapport local du 28 septembre 2026. Implémentation et vérifications terminées ; validation de la Phase 5 attendue avant tout commit. Aucun push, merge, déploiement, appel IA, email réel, paiement réel ou accès Firebase Production effectué.

## 1. Phase 4 figée et références Git

Le diff Phase 4 a été contrôlé avant modification : 27 fichiers du périmètre validé, +1 335/−522 lignes, `git diff --check` réussi. Commit local créé avec le message demandé : `feat(admin): add controlled product publication pipeline`.

| Référence | SHA constaté |
| --- | --- |
| origin/main, référence locale | 0a65f8557602e10d1c99415335376b973d955cd6 |
| Phase 1 | dcb73ad827c849ddeb999cf66c269f27fc2557ed |
| Phase 2 | deefd78c3dc75115eaea2857d2b71a86f731d194 |
| Phase 3 | 9d034bfe8dec27b74f67e6b9cb75c608d3801a77 |
| Phase 4 | cbab2f82b4ca2f9364adf5c0ceede5d71270c35e |
| HEAD Phase 5, sans commit Phase 5 | cbab2f82b4ca2f9364adf5c0ceede5d71270c35e |

`origin` : https://github.com/Token-Inv13/Verdanza.git. Aucun fetch/pull/merge effectué pendant cette phase. Le snapshot local de `origin/main` comporte 10 commits absents de cette branche, qui comporte les quatre commits locaux Admin V3 : cette phase continue exactement depuis la Phase 4 validée. Ces vérifications ne prouvent pas une intégration avec les changements distants ultérieurs.

## 2. Branche et worktree Phase 5

`codex/admin-v3-phase5-marketing`, créée depuis le commit Phase 4, dans le worktree réutilisé :

worktree local de la Phase 4.

Le nom du dossier est conservé. Le checkout canonique reste sur `main`, HEAD `ba29ee73ef06d50e2d076be96b554fbc397334cf`, avec son travail local préexistant protégé. Aucune édition de ses sources, opération de branche ou opération de nettoyage n’a été faite. Les dépendances locales mises en cache sont réutilisées via les jonctions déjà présentes ; les sorties du build sont ignorées.

## 3. Audit Marketing avant modification

| Module | Existant confirmé dans la base Phase 4 | Risque traité |
| --- | --- | --- |
| Promotions | `Coupon`, `couponsService`, écritures SDK ; montant fixe, pourcentage, livraison, seuils, cadeaux par paliers, ciblage, priorité, cumul, limites et dates | Nouvelle promotion active par défaut ; mise à jour de configuration renvoyant un usedCount potentiellement périmé |
| Bannières | `PromoBanner`, `promoBannersService`, types top_bar/shop_card/checkout_notice/modal ; placements home/shop/flowers/resins/cart/checkout/all_public/draft ; CTA, dates, liens ID/code, archives/modèles | Ancienne préparation promotion+bannière en deux écritures séparées ; visibilité conditionnée par la promotion liée |
| Concours | Types natifs, AdminContestsPage, API serveur, machine d’états, contrôle du concours actif, participants, tirage, gains, coupons protégés, invitations et audit | Configuration/activation à relier aux validations privées sans reprendre les moteurs sensibles |

Les concours possédaient déjà des transactions et des collections réservées au backend. Les promotions et bannières permettaient davantage d’écritures directes admin. Les règles et requêtes d’index ont été inspectées. Le calcul public reste dans les moteurs existants, notamment `cartPromotions`, `tieredProductGifts` et le checkout serveur ; aucun de ces moteurs n’est réimplémenté.

## 4. Nouvelle architecture Marketing

AdminMarketingPage orchestre les quatre types de proposition : promotion, banner, contest et campaign. MarketingTabs et MarketingOverview structurent la navigation ; MarketingPreview fournit un aperçu privé et les récapitulatifs de confirmation. ContestEditor conserve les champs natifs.

Les formulaires CouponForm et PromoBannerForm existants sont exportés puis réutilisés dans AdminDialog avec un mode privé. Les adaptations d’AdminPage restent ciblées. AdminConfirmDialog encadre les étapes et les abandons de saisie. Le client authentifié appelle `/api/admin-contests?action=marketing`, servi par marketingAdmin, sans ajouter de nouvelle fonction de déploiement.

## 5. Structure de la vue Marketing

`/admin/marketing` ouvre la vue d’ensemble. Les URLs `/admin/coupons`, `/admin/bannieres` et `/admin/concours` restent disponibles avec une navigation commune. Le groupe repliable de la sidebar Phase 1 est conservé.

La synthèse présente actifs, programmés, inactifs/modèles/bloqués et terminés/archivés. Ces informations proviennent des drapeaux, dates, limites et statuts métier existants. Les listes détaillent dates, visibilité, utilisations et références. Les propositions privées et campagnes sont accessibles avec leur état, révision et date ; les participants, tirages et gains restent dans le module Concours.

## 6. Comportement Promotions

Configuration en AdminDialog, aperçu, sauvegarde privée confirmée, revue, approbation, matérialisation inactive puis `Confirmer et activer`. Types, seuils, remises, ciblage, priorité, cumul, cadeaux, limites, dates, notes et modèles sont conservés. La priorité zéro est acceptée dans le nouveau parcours.

Les objets nouveaux commencent avec `isActive: false` et `usedCount: 0`. Préparer une modification d’une promotion existante ne change pas son état ni sa configuration publique. Le serveur applique les seuls champs de configuration lors de la confirmation finale ; usedCount et les autres champs serveur restent hors du formulaire transmis. Le writer SDK historique omet aussi usedCount des mises à jour de configuration. Désactivation et archivage sont explicites et conservent le compteur.

## 7. Comportement Bannières

Le formulaire complet est réutilisé en modale : texte, types, placements multiples, CTA, variante, fermeture, période, promotion liée, modèles et archives. Les nouveaux objets sont inactifs. Un modèle/une archive peut être copié en proposition privée ; une restauration doit repasser par le parcours de validation.

L’aperçu indique promotion liée active, inactive, future, expirée, absente ou épuisée. Une liaison ID/code contradictoire et un coupon concours protégé sont refusés. L’activation d’une bannière liée à une promotion inactive/expirée/épuisée est refusée ; une promotion programmée est permise si les périodes se recouvrent, avec visibilité future clairement indiquée. Les CTA restent internes ou HTTPS validés.

## 8. Comportement Concours

La création native reste en `draft`, après matérialisation confirmée. Une simple sauvegarde privée n’ajoute ni participant, tirage, gain, coupon ni invitation. L’activation finale appelle les opérations transactionnelles natives : `scheduled` si le début est futur, sinon `active`. Les protections natives et les conflits de période sont conservés.

Configuration, participants, pagination, tirage, validation/invalidation gagnant, gains, renvoi d’invitation, annulation de gain et audit restent disponibles. Les actions sensibles disposent de confirmations distinctes ; le tirage exige notamment l’acquittement `TIRAGE`. Les erreurs restent visibles. Aucun bouton de finalisation automatique n’est ajouté. Les anciennes voies API create/update et transition vers active/scheduled demandent désormais le workflow Marketing ; les autres opérations natives restent propriétaires de leurs règles.

## 9. Campagne liée

`kind: campaign` orchestre une promotion et une bannière, nouvelles ou existantes. Les références sont vérifiées, le lien bannière→promotion est établi côté serveur, et un aperçu commun précède la validation.

La matérialisation des objets nouveaux inactifs, puis l’application/activation finale des deux objets, utilisent une transaction Firestore commune avec le brouillon, le reçu et l’audit. Un conflit ou un échec de la seconde écriture provoque le rollback intégral. Le test simule cet échec puis reprend avec le même UUID. Les concours restent des propositions séparées afin de conserver leur cycle métier natif.

## 10. Modèle marketingDraft

`marketingDrafts` contient : id, kind, title, origin manual, parameters, references métier, baseFingerprints, revision, state, authorId, updatedBy, createdAt/updatedAt, révisions revues/approuvées/matérialisées/activées et approbation avec auteur/date serveur.

Les paramètres n’acceptent que des champs de configuration autorisés, jamais isActive, usedCount ou métadonnées de coupons concours. Une proposition incomplète peut être conservée en privé ; la revue et les étapes suivantes exigent une configuration valide. La collection n’est lue par aucun moteur public.

## 11. Machine d’états

`draft → reviewed → approved → materialized → activated`, avec `archived` comme fermeture du brouillon. Chaque étape est distincte et confirmée. Une édition remet le brouillon à draft. La désactivation des objets promotion/bannière remet aussi la préparation à draft et retire l’approbation ; la fermeture/annulation d’un concours utilise ses actions natives.

Les objets métier conservent leurs modèles et statuts actuels ; cette machine appartient uniquement à la préparation admin. Le passage du temps continue de conditionner l’affichage et le cycle natif des objets déjà activés ou programmés après confirmation.

## 12. Révisions et concurrence

Chaque sauvegarde augmente la révision. Revue, approbation et matérialisation sont attachées à cette révision précise. L’activation exige leur concordance ; toute édition N+1 invalide l’aval N.

Des empreintes de configuration détectent une modification concurrente des objets métier, y compris de leur activation ou provenance protégée. Les compteurs d’usage et horodatages sont exclus de ces empreintes : une vente survenue depuis la lecture admin ne bloque pas à elle seule une modification et n’est jamais écrasée. Un objet supprimé ou une configuration périmée exige une nouvelle préparation depuis l’état actuel.

## 13. Prévisualisation

MarketingPreview est un rendu en mémoire dans l’admin : aucune écriture, activation temporaire, navigation CTA ou publication publique. Il reprend les couleurs/classes et la présentation générale des bannières existantes ; le CTA est présenté sans action. Promotions et concours disposent d’un récapitulatif détaillé avant confirmation.

La visibilité est évaluée avec le helper existant promoBannerVisibility et l’état de la promotion liée. Pour une campagne, la configuration préparée est simulée uniquement en mémoire. L’aperçu ne constitue pas une simulation de commande et ne reproduit pas le carrousel ou la persistance de fermeture du site public.

## 14. Activation serveur

L’API authentifie et vérifie l’admin actif pour chaque lecture/action, y compris les rejeux. Elle recharge le brouillon, vérifie révision/approbation/empreintes, valide configuration, références produit, codes, dates, liens et conflits, puis écrit les objets et l’audit atomiquement.

Les produits référencés doivent exister et être actifs. Les limites d’utilisation sont revérifiées avec le compteur actuel. La réservation transactionnelle des codes évite les doublons ; un renommage libère la réservation de l’ancien code appartenant au même objet. Les coupons concours sont protégés par leur source et leurs métadonnées, même sur des données historiques incomplètes. Aucun isActive arbitraire client n’est accepté dans les paramètres.

## 15. Idempotence et résultat incertain

Chaque opération Marketing porte un UUID v4 stable. marketingOperations conserve l’auteur, l’empreinte de la demande et le résultat dans la même transaction. Même auteur + même UUID + même demande retrouvent le même résultat, sans deuxième objet, révision ou audit. Un UUID réutilisé avec une autre demande/auteur est refusé. Deux activations concurrentes différentes ne publient pas deux fois.

Avant l’envoi, le client persiste une seule opération en attente par UID admin dans localStorage. Réponse perdue, timeout, réponse illisible ou erreur serveur incertaine conservent ce journal et bloquent les nouvelles mutations. Le même envoi peut être repris après rechargement. Un journal corrompu/non inscriptible bloque l’envoi ; aucune absence de données n’est supposée après une erreur de lecture. Cette nouvelle idempotence concerne les opérations Marketing ; les actions sensibles natives des concours conservent leurs mécanismes propres.

## 16. Audit

marketingAuditLogs enregistre création, modification, revue, approbation, matérialisation, activation, désactivation et archivage avec auteur, date serveur, type, identifiants métier, révision, action et operationId. La réception idempotente évite les doublons d’audit.

Les actions métier des concours continuent d’écrire leur audit natif via les helpers réutilisés ; le journal Marketing indique la collection contestAuditLogs pour consulter ces détails. Il ne recopie pas les participants, gains ou emails.

## 17. Dates et fuseau

L’interface affiche et saisit explicitement Europe/Paris. Le stockage utilise des ISO UTC normalisées. Les anciennes dates de promotion sans heure conservent leurs bornes Paris inclusives ; la fin est correctement interprétée.

Tests : changement de jour, programmation, expiration, dates calendrier invalides, intervalle inversé, heure inexistante et heure répétée lors des changements d’heure. Une heure locale ambiguë/inexistante reste à corriger et n’est pas convertie silencieusement. Le serveur exige une date explicite valide ou une ancienne date seule correctement normalisée.

## 18. Fichiers créés

- [api/_server/marketingAdmin.ts](<../api/_server/marketingAdmin.ts>) — API privée, validations, transactions et reçus.
- [src/types/marketing.ts](<../src/types/marketing.ts>) — contrats des brouillons, opérations et audits.
- [src/lib/marketingConfiguration.ts](<../src/lib/marketingConfiguration.ts>) — listes de champs de configuration autorisés.
- [src/lib/adminMarketingDates.ts](<../src/lib/adminMarketingDates.ts>) — conversion Paris/UTC et affichage explicite.
- [src/lib/marketingBusinessStatus.ts](<../src/lib/marketingBusinessStatus.ts>) — états dérivés des objets métier.
- [src/services/marketingService.ts](<../src/services/marketingService.ts>) — client authentifié et journal de reprise.
- [src/pages/admin/AdminMarketingPage.tsx](<../src/pages/admin/AdminMarketingPage.tsx>) — orchestration de l’interface Marketing.
- [src/components/admin/marketing/MarketingOverview.tsx](<../src/components/admin/marketing/MarketingOverview.tsx>) — vue d’ensemble.
- [src/components/admin/marketing/MarketingTabs.tsx](<../src/components/admin/marketing/MarketingTabs.tsx>) — navigation commune.
- [src/components/admin/marketing/MarketingPreview.tsx](<../src/components/admin/marketing/MarketingPreview.tsx>) — aperçu et récapitulatifs privés.
- [src/components/admin/marketing/ContestEditor.tsx](<../src/components/admin/marketing/ContestEditor.tsx>) — configuration native des concours.
- [scripts/testMarketingServer.ts](<../scripts/testMarketingServer.ts>) — tests API/transactions sur émulateur.
- [scripts/testMarketingRules.ts](<../scripts/testMarketingRules.ts>) — tests des règles candidates.
- [scripts/testMarketingClient.ts](<../scripts/testMarketingClient.ts>) — tests du client, du journal et des dates.
- [scripts/testMarketingUi.ts](<../scripts/testMarketingUi.ts>) — tests d’interface sur fixture.
- [scripts/fixtures/marketingFixture.tsx](<../scripts/fixtures/marketingFixture.tsx>) — montage de l’interface en mémoire.
- [scripts/fixtures/marketingMocks.ts](<../scripts/fixtures/marketingMocks.ts>) — services simulés sans effet externe.
- [reports/admin-v3-phase5-marketing.md](<../reports/admin-v3-phase5-marketing.md>) — présent rapport.

## 19. Fichiers modifiés

- [api/_server/contestAdminRoute.ts](<../api/_server/contestAdminRoute.ts>) — dispatch Marketing et fermeture des anciennes voies d’activation/configuration non révisées.
- [api/_server/contests.ts](<../api/_server/contests.ts>) — extraction des opérations transactionnelles natives réutilisables ; normalisation du règlement URL optionnel.
- [firestore.rules](<../firestore.rules>) — confidentialité et barrières des écritures SDK.
- [package.json](<../package.json>) — trois commandes de tests Marketing ; chaînes de vérification existantes conservées.
- [scripts/runCagnotteLedgerTests.ts](<../scripts/runCagnotteLedgerTests.ts>) — mode Marketing sur l’émulateur secondaire protégé.
- [scripts/seoRoutes.ts](<../scripts/seoRoutes.ts>) — route admin Marketing non indexable.
- [scripts/testAdminV3.ts](<../scripts/testAdminV3.ts>) — ajout de la nouvelle route attendue ; assertions Phase 1 conservées.
- [src/App.tsx](<../src/App.tsx>) — routes Marketing et conservation des URLs historiques.
- [src/layouts/AdminLayout.tsx](<../src/layouts/AdminLayout.tsx>) — lien vers la vue d’ensemble dans le groupe Marketing.
- [src/pages/admin/AdminContestsPage.tsx](<../src/pages/admin/AdminContestsPage.tsx>) — préparation privée et confirmations des actions natives sensibles.
- [src/pages/admin/AdminPage.tsx](<../src/pages/admin/AdminPage.tsx>) — export/réutilisation ciblée des formulaires, mode privé, dates et compteur en lecture seule.
- [src/services/couponsService.ts](<../src/services/couponsService.ts>) — suppression de usedCount des mises à jour de configuration.

## 20. Règles et index

Les quatre collections marketingDrafts, marketingOperations, marketingAuditLogs et marketingCouponCodes refusent toute lecture/écriture SDK, même pour un admin. Seule l’API backend avec contrôle d’accès les sert. Les collections métier publiques restent les mêmes.

Les règles SDK imposent la création inactive et usedCount zéro ; interdisent activation, écrasement de compteur, contournement des coupons concours et modification de configuration d’un objet actif. Désactivation/archivage restent possibles. La neutralisation d’un lien lors de suppression d’un coupon est conservée uniquement avec un marqueur concordant et un coupon absent après transaction ; aucune reconnexion active arbitraire n’est permise.

Aucun nouvel index composite nécessaire pour les requêtes actuelles : listes de collections, égalité sur code/draftId et requête native sur status. firestore.indexes.json est inchangé. Règles candidates testées localement, non déployées. SHA-256 final : `ced5b8ce7dfd37a09a924d793cc2841ce6d81427cbf1830b722b4e27e05ba6fd`.

## 21. Tests ajoutés

| Commande | Résultat | Couverture principale |
| --- | --- | --- |
| npm run test:marketing | 38 groupes serveur/API + 76 contrôles de règles, PASS | Brouillons sans effet, révisions, compteurs, refs, types, cadeaux, dates, permissions, protections concours, campagnes atomiques, conflits, rejeux et échec de seconde écriture |
| npm run test:marketing-client | 11 groupes, PASS | Journal durable, propriétaire, erreurs, reprise, writer historique sans compteur, Paris/UTC et changements d’heure |
| npm run test:marketing-ui | 20 scénarios, PASS | Modales, aperçu sans mutation, étapes séparées, confirmations/annulations, double clic, réponse perdue, rechargement, reprise même UUID, édition invalidante et concours natifs |

L’émulateur officiel est isolé sur 127.0.0.1:18086 avec le seul projet demo-verdanza-cagnotte ; l’environnement de test refuse les cibles Production et les autres ports. Le processus créé par chaque suite est arrêté. Les tests UI montent les composants réels avec des fixtures et un viewport fixe par suite, sans navigation réelle ni services externes. Aucun parcours local multi-viewport n’a été exécuté.

## 22. Tests de régression

| Périmètre / commandes exécutées | Résultat |
| --- | --- |
| Phase 1 : test:admin-v3 | 12 groupes PASS ; attente de navigation adaptée au nouveau lien uniquement |
| Phase 2 : test:admin-stock-client, test:admin-stock-ui | 7 groupes client + 6 scénarios UI PASS |
| Phase 3 : test:admin-customers-unit, test:admin-customers-ui | 13 groupes unitaires + 14 scénarios UI PASS |
| test:selection-pipeline-regressions | Phase 2 : 14 groupes serveur + 22 règles ; Phase 3 : 18 groupes serveur + 50 règles, PASS |
| Phase 4 : test:selection-pipeline | 27 groupes serveur/API/transactions + 80 contrôles de règles PASS |
| Phase 4 : test:selection-extraction, test:selection-pricing, test:selection-pipeline-ui | 13 groupes extraction + 19 pricing + 13 UI PASS |
| test:promotions, test:gift-promotions | PASS : calcul panier, catégories, seuils, cadeaux et comportement des bannières existants |
| test:contests | PASS : tests du module concours natif, relancés après les changements serveur |
| test:catalog, test:product-catalog-fallback | PASS : disponibilité et fallback catalogue |

Les suites Phase 2/3 et Phase 4 ont précédé le dernier resserrement de la seule permission de neutralisation des liens bannière. Cette permission finale est couverte par les 76 tests de règles Marketing, dont le batch historique de suppression/neutralisation ; aucune règle stocks, clients ou pipeline n’a changé depuis leurs passages.

## 23. Lint, typechecks et build

`npm run lint`, `npm run typecheck` (application et Node), `npm run typecheck:api` et compilation TypeScript stricte des tests serveur/règles Marketing : PASS. Revue React effectuée sur les composants édités, notamment les confirmations empilées, le verrouillage pendant mutation et les erreurs visibles.

`npm run build:local` : PASS, sitemap vérifié avec 48 URLs sans écriture, compilation TypeScript, build Vite, 85 HTML prérendus, contrôle du build normal sur 438 fichiers. Le prérendu utilise la boucle locale avec blocage des services externes et ne constitue pas une navigation multi-viewport. Artefacts générés dans les sorties/cache ignorés.

`npm run verify:local-safety` : PASS, zéro erreur ; 76 scripts transitifs inspectés. Les validations ciblées demandées ont été exécutées ; le grand agrégat verify:full n’est pas présenté comme exécuté.

## 24. git diff --check

PASS sur le diff complet, nouveaux fichiers inclus via intention d’ajout (`git add -N`) pour permettre leur revue. Aucun contenu Phase 5 n’est staged pour commit ; le diff cached est vide. HEAD reste le commit Phase 4. Les avertissements de normalisation LF/CRLF de Git ne sont pas des erreurs de whitespace.

## 25. Limites et dettes restantes

- Validation exclusivement locale : API, règles, fonctions et rendu en Production non vérifiés et non déployés.
- Base volontairement conservée depuis la Phase 4 validée ; intégration aux dix commits distants absents à traiter dans une phase autorisée ultérieure.
- Les lectures du contexte admin chargent les collections complètes ; pagination et éventuelle réduction de projection seront utiles si leur volume augmente.
- Les deux formulaires historiques restent importés depuis AdminPage pour conserver leurs fonctionnalités sans refonte générale ; cette dépendance et le poids du chunk admin restent une dette d’extraction.
- L’aperçu reproduit la présentation générale, sans carrousel, commande simulée, analytics ou persistance publique de fermeture.
- Une campagne coordonne promotion+bannière. Un concours garde sa proposition et ses actions sensibles indépendantes.
- Le journal de reprise dépend du navigateur/UID courant ; il bloque explicitement un journal illisible. Les reçus serveur demeurent autoritatifs.
- Origine manual uniquement ; génération IA, politique de rétention des reçus/audits et pagination des audits ne sont pas ajoutées.

## 26. Résumé du diff et arrêt

Diff fonctionnel et tests : 29 fichiers, 17 créations et 12 modifications, +1 348/−307 lignes. Rapport inclus : 30 fichiers, +1 567/−307 lignes. Les sources publiques de rendu, panier, catalogue, checkout et emails ne sont pas modifiées. Le changement serveur concours extrait ses opérations transactionnelles ; ses moteurs de tirage, gains, coupons et emails restent en place.

Marketing V2 fournit la préparation privée, la prévisualisation, les révisions validées, l’activation serveur atomique et la reprise idempotente. Aucun commit Phase 5, push, merge, déploiement ou écriture Firebase Production. Arrêt après ce rapport, conformément à la demande.
