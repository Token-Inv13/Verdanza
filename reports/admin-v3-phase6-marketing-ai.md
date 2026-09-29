Rapport Phase 6 Admin V3 — Assistant Marketing IA
================================================

Livraison locale du 28 septembre 2026. L’assistant produit des propositions privées ; seules les confirmations humaines du workflow Marketing V2 peuvent matérialiser puis activer des objets métier. Les tests utilisent des fournisseurs simulés et l’émulateur officiel isolé. Aucun appel réel de génération IA, push, déploiement ou accès Firebase Production.

1. **Commit local Phase 5 figé**

   SHA : **ba131884b25c7fe155ce7a10826c751464d8b670**.
   Message : feat(admin): add controlled marketing workflow.
   Avant le commit : diff limité aux 30 fichiers Phase 5, +1567/-307, contrôle whitespace réussi et staging explicite. Sauvegarde locale : codex/admin-v3-phase5-backup-20260928, sur ce même SHA. Aucun push.

2. **État origin/main après fetch**

   Remote : https://github.com/Token-Inv13/Verdanza.git.
   Référence fetched : **0a65f8557602e10d1c99415335376b973d955cd6**. Le fetch n’a pas déplacé cette référence par rapport à sa valeur initialement constatée. Base commune : eb35d8dcc7383528e6f4e7b53eebe02ce9bb413d. Cinq commits uniquement Admin V3 ; dix commits uniquement distants.

3. **Dix commits distants intégrés dans les fichiers du worktree**

   | SHA | Changement distant |
   | --- | --- |
   | 0a65f8557602e10d1c99415335376b973d955cd6 | Fusion PR #23, interface parrainage inerte |
   | ccddfba56b674ede5885d486b93299a87d6bed75 | Fusion origin/main dans la branche interface parrainage |
   | 9b26f3b8d6c852da426e9c33b65cd77b2018e469 | Expérience client parrainage inerte |
   | 86d54431776d6767225cd1cd1157fd29829d9bb3 | Guide CBD sur les incertitudes de mesure |
   | ab347c5e4ad0f6c20a9321849623e8b9e42f533e | Fusion PR #21, checkout parrainage inerte |
   | 0989eae7aa9e6bc12afaa4e816acd27776189e1b | Allocations parrainage figées dans GA4 |
   | 52951ab87fea31c455733de02558547972e0e0e4 | Allocation de revenu parrainage figée |
   | e7e65546d9c8a4eaac573633876e2cdd7d0680b8 | Revenu parrainage et propriété du checkout |
   | 17b4bf60e9723d54a2f9baea0e671c173d33e33d | Réservation du droit checkout et rejeu des commandes |
   | b41a2795a222d7bcb149767edddbf095a1d96083 | Devis checkout parrainage inerte |

4. **Stratégie d’intégration et état Git précis**

   Fusion conservant l’historique Admin V3 : git merge --no-ff --no-commit origin/main, depuis la nouvelle branche Phase 6. Les cinq commits Admin V3 restent inchangés. La fusion des fichiers est résolue et préparée dans l’index ; aucun commit de fusion n’a été créé, afin de respecter la validation préalable demandée pour la Phase 6.

   HEAD demeure le commit Phase 5. MERGE_HEAD désigne 0a65f8557602e10d1c99415335376b973d955cd6. L’arbre d’intégration avant IA est **4024579772e6d5f7e4a0e79f656080c5b3e1707a**. Cette couche contient 74 fichiers, +2891/-157, dans le diff cached. Les changements IA restent dans le diff non staged ; les nouveaux fichiers ont uniquement une intention d’ajout pour leur revue. La fusion reste à finaliser après validation : origin/main n’est pas encore un ancêtre de HEAD.

5. **Conflit rencontré et résolution**

   Un conflit textuel dans package.json, à la fin du bloc scripts. Conservation de tous les tests Admin V3 et des ajouts distants test:referral-client et typecheck:referral-client-tests ; chaîne verify distante conservée. Aucun choix global ours/theirs.

   Les fusions automatiques de src/App.tsx et scripts/runCagnotteLedgerTests.ts ont été relues : routes et garde-fous parrainage, routes Marketing, modes émulateur Admin V3 et protection du port secondaire conservés. Aucun fichier en état unmerged.

6. **Régressions avant toute implémentation IA : PASS**

   | Phase | Résultats avant IA |
   | --- | --- |
   | P1 Admin V3 | 12 scénarios UI/navigation/dialogues |
   | P2 Stock | 7 groupes client, 6 scénarios UI, 14 groupes serveur, 22 contrôles de règles |
   | P3 Clients V2 | 13 groupes purs, 14 scénarios UI, 18 groupes serveur, 50 contrôles de règles |
   | P4 Pipeline | 13 groupes extraction, 19 prix, 13 UI, 27 serveur, 80 règles |
   | P5 Marketing V2 | 11 groupes client, 20 UI, 38 serveur/API/transactions, 76 règles |
   | Moteurs existants | Promotions PASS, cadeaux 36+ scénarios PASS, concours PASS, catalogue 14 PASS, fallback catalogue PASS |

   Typecheck application/Node, typecheck API et sécurité locale également PASS avant IA. Preuves locales dans scripts/node_modules/.cache/admin-v3-phase6/pre-ai-*.log, ignorées par Git. Les journaux initialement enregistrés en flux NTFS ont été recopiés vers ces noms de fichiers ordinaires sans changer leurs résultats.

7. **Branche et worktree Phase 6**

   Branche : **codex/admin-v3-phase6-ai**.
   Worktree réutilisé : **worktree local de la Phase 4**. Son nom historique est conservé.
   Checkout canonique protégé, branche main, HEAD constaté ba29ee73ef06d50e2d076be96b554fbc397334cf. Aucun fichier source de ce checkout n’a été modifié par cette livraison.

8. **Architecture fournisseur IA**

   Interface serveur MarketingAiProvider.generateMarketingProposals(context, brief, signal). Elle reçoit un DTO catalogue et un brief, sans Firestore, fonction d’activation, outil métier, paiement, stock mutable, concours, tirage, gain ou email. L’adaptateur OpenAI utilise fetch vers l’endpoint fixe Responses, interdit les redirections, demande une sortie JSON schema stricte et transmet store=false. Aucune dépendance ajoutée.

   Le service orchestration authentifie l’admin, borne le contexte, réserve une génération et son quota, appelle le fournisseur, valide tout le lot puis conserve le résultat privé. Il utilise l’API admin existante avec action=marketing-ai ; aucune nouvelle route Vercel. Configuration et usage du schéma suivent la [documentation officielle Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) et la [référence Responses](https://developers.openai.com/api/reference/resources/responses/methods/create).

9. **Configuration serveur et clé demandée**

   | Variable serveur | Valeur d’exemple / rôle |
   | --- | --- |
   | MARKETING_AI_ENABLED | false par défaut ; opt-in explicite nécessaire |
   | MARKETING_AI_PROVIDER | openai ; autre valeur désactive cet adaptateur |
   | MARKETING_AI_MODEL | vide par défaut ; modèle compatible sorties structurées strictes requis |
   | OPENAI_API_KEY | vide dans l’exemple versionné ; secret exclusivement serveur |

   Aucun préfixe VITE_ et aucun secret dans les fixtures, le rapport ou le bundle client. L’absence d’une seule configuration indispensable désactive la génération. La configuration Firebase Admin et l’authentification existantes sont réutilisées.

   **Clé future : non créée.** L’utilisateur a explicitement choisi une nouvelle clé sécurisée. Le connecteur OpenAI Platform a renvoyé UNAUTHORIZED lors de l’ouverture du sélecteur, y compris après la reconnexion annoncée. Le flux de confirmation de destination a ensuite retourné **not_approved / decline**. Aucun secret n’a été généré ni écrit. Le fichier recommandé .env.local du worktree est ignoré et non suivi. Le skill `openai-platform-api-key` impose explicitement : « If it is declined or canceled, stop. » La création de clé est donc arrêtée ; les validations simulées de la Phase 6 sont terminées.

10. **Structure du prompt**

    Instructions centrales : politique Verdanza, limites des mécaniques, absence d’actions métier et distinction données/instructions. Message utilisateur : enveloppe JSON séparant catalogData et adminBriefData. Schéma fermé indépendant des données. Prix et stocks sont présentés comme faits ; textes, mécaniques et périodes comme propositions à revoir. Dates ISO avec fuseau explicite et contexte Europe/Paris.

11. **Version du prompt**

    MARKETING_AI_PROMPT_VERSION = **verdanza-marketing-v1**, centralisé dans marketingAiSchema.ts et enregistré dans chaque génération et chaque brouillon issu de celle-ci. Les politiques ne sont pas dupliquées dans l’interface.

12. **Schéma des propositions**

    Objet racine proposals, de 1 à 3 éléments selon le brief. Chaque élément contient kind, title, concept, rationale, referencedProductIds et trois configurations promotion/banner/contest, null pour les configurations absentes. Les identifiants proposal-1 à proposal-3 sont attribués par le serveur.

    Chaque objet est fermé avec additionalProperties=false ; tous les champs du contrat sont requis et les options sont explicitement nullables. Enums et limites sont définis pour les sept mécaniques promotionnelles existantes, les placements/variantes de bannière et le concours natif à bon Verdanza. Aucun champ isActive, state, usedCount, stock mutable, participant, tirage, gagnant, gain actif, provenance arbitraire ou commande métier.

13. **Contexte catalogue envoyé**

    Requête serveur avec projection explicite : nom, catégorie, prix public, stock disponible, mode/formats à prix fixes publics, arômes et tags. Le DTO final contient uniquement id/name/category/price/stock/formats/aromas/tags. Les formats utilisent les helpers natifs de prix fixes. Produits actifs, stock positif et prix public positif/finite uniquement. Pas de description libre, référence fournisseur ou document d’import.

    Périmètres : tout le catalogue disponible, catégorie, ou IDs choisis. Maximum 60 produits et 30 IDs sélectionnés. Au-delà de 60 produits actifs interrogés : refus explicite demandant de réduire le périmètre, aucune troncature cachée. Une sélection contenant un produit absent, inactif ou indisponible est refusée.

14. **Minimisation des données**

    Aucune lecture de clients, commandes, adresses, coordonnées, notes internes ou achats fournisseur pour construire le contexte IA. Le client envoie uniquement le brief et les IDs choisis ; son contexte Marketing complet ne part pas au fournisseur. Les coordonnées email/téléphone évidentes sont refusées dans le brief. La génération conserve un hash du brief, pas son texte ni le contexte complet. Secrets, erreur brute fournisseur, réponse brute et raisonnement ne sont pas persistés.

    Cette liste blanche garantit l’exclusion des champs privés ; elle ne constitue pas un détecteur universel de données personnelles qu’un admin placerait lui-même dans un champ public ou le texte libre.

15. **Validation métier après IA**

    Schéma strict et taille maximale, titres/concepts distincts, nombre et type demandés, composition exacte. Tous les IDs proposés sont contrôlés avant et après la normalisation native, y compris un champ cadeau qui serait ensuite éliminé pour une promotion ordinaire. Ciblage, catégorie, cadeaux et références déclarées doivent rester dans le contexte autorisé.

    Réutilisation de validateMarketingParameters Phase 5 : pourcentages/montants/minimums/limites, paliers cadeaux, dates, placements, CTA sûr et complet, contraintes concours. Période future/non expirée ; période imposée respectée ; périodes promotion/bannière identiques pour une campagne. Détection lexicale de certaines allégations interdites. Aucune proposition partielle retenue quand un élément du lot est invalide.

    Les produits référencés sont relus transactionnellement à la sauvegarde AI puis à la revue, approbation, matérialisation et activation : existence, activité, stock et prix public positifs/finis. Les protections Phase 5 sur coupons concours, limites d’usage et configuration métier concurrente restent appliquées. Le stock n’est jamais modifié par ces étapes.

16. **Protection contre les injections**

    Politique serveur explicite : noms, tags, arômes et brief sont des données non fiables. Ils restent dans le message de données et ne modifient ni les instructions centrales ni le schéma. Le fournisseur n’a aucun outil. Une sortie demandant activation, stock, compteur, tirage ou gagnant est rejetée structurellement ; un ID inventé est rejeté par le backend.

    Les tests injectent des consignes malveillantes dans le brief et le nom produit et inspectent la requête fournisseur simulée. Ils prouvent la séparation des données, le contrat et l’absence de capacités, sans prétendre garantir le comportement sémantique d’un modèle réel contre toute injection.

17. **UI Assistant IA**

    Zone Assistant IA dans Admin → Marketing : objectif limité à 2000 caractères, cinq choix de type, trois périmètres, quatre catégories, six tons, 1–3 propositions et période suggérée/imposée. Trois propositions par défaut. Saisie des périodes en Europe/Paris, conversion UTC existante.

    Cartes : titre, concept, texte, type, produits concernés, mécanique, dates, CTA éventuel et justification. Ignorer/restaurer conserve la proposition ; Prévisualiser ouvre l’aperçu privé Phase 5 ; Modifier et Créer le brouillon ouvrent l’éditeur existant avant confirmation de sauvegarde. Une proposition déjà liée à un brouillon ne permet pas une seconde création dans l’UI. Aucune publication ou modification métier par ces actions de consultation.

18. **Proposition → marketingDraft**

    La source est uniquement un couple generationId/proposalId. Le backend retrouve la génération terminée du même admin, vérifie le type et ses produits, puis réserve atomiquement un seul brouillon par proposition. Les métadonnées sont recopiées depuis le serveur, jamais choisies par le client. Création toujours en état draft, origine ai, révision 1.

    Ensuite : sauvegarde → revue → approbation de N → matérialisation inactive de N → confirmation d’activation de N. Les opérations, reçus, audits et moteurs Phase 5 sont réutilisés. Toute édition N+1 invalide la validation de N et conserve la provenance. Une campagne garde l’activation atomique native promotion+bannière ; un concours garde sa machine d’états et ses actions de tirage/gain séparées.

19. **Métadonnées et provenance**

    Génération : UUID, date serveur, admin demandeur, hash de demande, version du prompt, fournisseur/modèle réellement renvoyés, propositions validées, IDs autorisés et liens vers les brouillons. Identifiant de réponse fournisseur et usage entrée/sortie conservés lorsqu’ils sont disponibles et valides.

    Brouillon : origine ai et provenance immutable (génération/proposition, modèle, politique, date, demandeur, IDs). Détails privés consultables dans l’éditeur. Aucun coût monétaire estimé inventé. Quotas et états pending/completed/failed résident dans la même collection technique privée ; aucun second workflow de brouillons.

20. **Coûts, limites et idempotence**

    Maximum 3 propositions, brief 2000 caractères, 60 produits, 30 IDs choisis, contexte 36 000 octets, sortie JSON 64 000 octets, réponse fournisseur 160 000 octets, 5000 tokens de sortie et timeout serveur 25 secondes. Maximum 6 générations par admin par fenêtre d’une heure et intervalle minimal 10 secondes, réservés en transaction avant l’appel.

    Verrou immédiat du double clic UI, UUID durable par demande, empreinte serveur et reprise explicite. Une génération completed est relue sans nouvel appel, même si le fournisseur est ensuite désactivé ou la période imposée expirée. Une génération pending/failed n’est jamais rappelée automatiquement. Les générations précédentes sont conservées côté serveur ; l’historique de leurs IDs et la demande incertaine sont séparés du journal Marketing Phase 5 et isolés par UID.

21. **Erreurs traitées**

    Session/admin absent, brief/date invalide, catalogue vide/hors limite/indisponible, configuration manquante, quota interne/fournisseur, timeout, indisponibilité, refus, JSON invalide, sortie excessive/tronquée, métadonnées modèle absentes, proposition invalide, produit inventé et résultat pending. Messages lisibles, sans erreur brute contenant des données fournisseur.

    Échecs fournisseur connus : état failed durable et reprise sans appel. Réponse HTTP perdue, malformée ou erreur inconnue : conservation du journal et du même UUID. Un échec d’écriture du résultat completed reste incertain et ne déclenche aucun retry du fournisseur. Timeout imposé même si un faux provider ignore AbortSignal. Une erreur de stockage local bloque une nouvelle génération.

22. **IA non configurée**

    Message explicite dans l’assistant et bouton de génération désactivé. Marketing manuel, brouillons existants, confirmations et concours natifs restent disponibles. Les générations déjà terminées peuvent être relues sans configuration fournisseur. Aucun faux résultat ni modèle implicite ; build normal fonctionnel sans clé.

23. **Fichiers créés — 17, rapport inclus**

    api/_server/marketingAi.ts ; marketingAiContract.ts ; marketingAiDraft.ts ; marketingAiProvider.ts ; marketingAiSchema.ts.
    src/types/marketingAi.ts ; src/lib/marketingAiReferences.ts ; src/services/marketingAiService.ts ; src/components/admin/marketing/MarketingAiAssistant.tsx.
    scripts/fixtures/marketingAiData.ts ; scripts/testMarketingAiUnit.ts ; testMarketingAiServer.ts ; testMarketingAiRules.ts ; testMarketingAiClient.ts ; testMarketingAiUi.ts.
    tsconfig.marketing-ai-tests.json ; reports/admin-v3-phase6-marketing-ai.md.

24. **Fichiers modifiés — 10 pour la Phase 6**

    .env.example ; api/_server/contestAdminRoute.ts ; api/_server/marketingAdmin.ts ; firestore.rules ; firestore.cagnotte-read.indexes.json ; package.json ; scripts/runCagnotteLedgerTests.ts ; scripts/verifyLocalSafety.mjs ; src/pages/admin/AdminMarketingPage.tsx ; src/types/marketing.ts.

    Les 74 fichiers d’intégration distante constituent une couche séparée préparée avant IA. Aucune modification Phase 6 de checkout, moteur de promotions, sélection/import fournisseur, comptabilité, stock transactionnel, participants, tirage, gains ou rendu public.

25. **Règles et index préparés localement**

    marketingAiGenerations : lecture/écriture SDK interdites, y compris à l’admin authentifié. Accès uniquement via backend authentifié et lecture de génération limitée à son demandeur. L’index products(isActive, category) est ajouté dans firestore.cagnotte-read.indexes.json, déjà référencé par firebase.json. Aucun index pour un second marketingDrafts ni service autonome. Aucun déploiement de règles/index ; l’émulateur ne prouve pas la construction d’un index de production.

26. **Tests Phase 6 : PASS**

    | Commande | Résultat final |
    | --- | --- |
    | npm run test:marketing-ai-unit | 10 groupes contrat/provider/minimisation avec transport simulé et garde réseau |
    | npm run test:marketing-ai | 20 groupes serveur/workflow + 27 contrôles de règles, émulateur officiel 1.22.0 |
    | npm run test:marketing-ai-client | 6 groupes journal/reprise/historique sans réseau |
    | npm run test:marketing-ai-ui | 16 scénarios sur une fixture unique, un viewport fixe, aucun service externe ni navigation réelle |
    | npm run typecheck:marketing-ai-tests | Compilation stricte des nouveaux tests PASS |

    Couverture : quatre types/libre, 1 et 3 propositions, ciblages, périodes imposées, catalogue vide, configuration/clé/modèle manquants, timeout et réponse interrompue/refusée/malformée, allégations interdites, injections/champs inconnus, IDs inventés, cadeaux hors contexte, coordonnées exclues, admin interdit, quotas, double clic, génération incertaine/rejeu, régénération/historique et ancien résultat après expiration.

    Parcours complet avec faux fournisseur : generation → modification → draft AI → review → approve → materialize inactive → confirmation activate. Révision N+1 invalide N ; compteurs préservés ; coupon concours protégé ; produit supprimé/inactif/rupture bloque la création ; stock perdu après approbation ou matérialisation bloque l’étape suivante ; aucun tirage, gain, email ou stock mutable par la génération.

27. **Régressions finales P1–P5 : PASS**

    Toutes les suites et les nombres du tableau au point 6 sont à nouveau validés sur la base intégrée et l’implémentation IA. Les suites serveur/règles P2–P3 passent via test:selection-pipeline-regressions ; P4 via test:selection-pipeline ; P5 via test:marketing. Promotions, cadeaux, concours, catalogue et fallback sont également relancés. Les émulateurs propres aux tests sont arrêtés après exécution ; aucun processus d’un autre travail sur le port 18085 n’a été utilisé ou arrêté.

28. **Lint, types, build et sécurité locale : PASS**

    npm run lint : aucune erreur ou avertissement final. npm run typecheck : application et Node PASS. npm run typecheck:api : PASS sur l’API transitive, y compris l’assistant. npm run typecheck:marketing-ai-tests : PASS. Revue React effectuée : clés stables, formulaires nommés, erreurs visibles, confirmations existantes, verrou double clic, données locales versionnées, réponses obsolètes ignorées après changement de session et lectures indépendantes en parallèle.

    npm run build:local : PASS, sitemap en check-only, 86 fichiers HTML pré-rendus, contrôle du build normal sur 447 fichiers sans adaptateur de recette interactive. Écritures de build uniquement dans les artefacts/cache locaux ignorés ; services externes bloqués durant le prerender. Avertissement Vite conservé : chunk principal 500,46 kB, supérieur au seuil 500 kB ; ce n’est pas un échec de build.

    npm run verify:local-safety : 0 erreur, garde-fous verify/verify:full inchangés et commandes IA explicitement contrôlées. Journaux finaux : scripts/node_modules/.cache/admin-v3-phase6/final-*.log. Les premiers ajustements de fixtures/locateurs, types et lint ont été corrigés puis les contrôles concernés relancés ; aucun échec final caché.

29. **git diff --check**

    PASS sur le diff Phase 6, nouveaux fichiers inclus par intention d’ajout, et PASS sur le diff cached d’intégration. Aucun marqueur de conflit ni fichier unmerged. Les avertissements de normalisation LF/CRLF ne sont pas des erreurs whitespace. Aucun contenu IA staged pour commit ; aucun commit Phase 6.

30. **Limites et dettes explicites**

    Le fournisseur réel, ses autorisations et un modèle réellement compatible ne sont pas validés par un appel payant : tests entièrement simulés. Création de clé future arrêtée après erreurs d’authentification du connecteur et confirmation de destination non approuvée. Les règles/index et l’API ne sont pas déployés. Fusion locale résolue mais sans commit, à finaliser après validation.

    La politique et les contrôles lexicaux ne garantissent pas la véracité sémantique de tout texte, l’absence universelle de données personnelles, ni une conformité juridique. La revue humaine des caractéristiques, textes, remise annoncée, urgence et règlement concours reste nécessaire. Les IDs/contextes, états, montants et capacités sont contrôlés déterministiquement.

    Une génération dont le processus serveur est interrompu après réservation peut rester pending ; aucun retry automatique, pour empêcher une double facturation. Sa résolution administrative nécessiterait une intervention explicitement autorisée. Les échecs consomment le quota de tentative. Aucun coût monétaire inventé ; métriques de tokens seulement.

    L’historique UI utilise les IDs conservés dans ce navigateur par UID ; les générations serveur restent conservées mais il n’existe pas de navigateur d’historique partagé entre appareils. Pas de purge/cron ajouté. Les références produit initiales du concept restent contrôlées après édition ; retirer un produit du texte ne retire pas automatiquement sa référence historique. Les mécaniques de catégorie/cadeaux restent limitées aux catégories et règles réellement supportées par les moteurs existants.

    Pas de navigation locale multi-viewport ni validation visuelle réelle sur données de production. Suites ciblées demandées exécutées ; chaîne verify:full intégrale non lancée. Aucun élargissement à des opérations distantes.

31. **Résumé du diff et arrêt**

    Diff fonctionnel Phase 6 avant ajout du rapport : **26 fichiers, +1222/-12**, comprenant 16 nouveaux fichiers et 10 modifications. Le rapport ajoute un 27e fichier de documentation. Couche distante déjà préparée : 74 fichiers, +2891/-157. Ces deux chiffres ne doivent pas être confondus avec le diff cumulé depuis le commit Phase 5.

    Assistant privé, adaptateur serveur configurable, contrat fermé, validation native, limites transactionnelles, provenance et reprise durable livrés. Activation uniquement dans le workflow humain Phase 5. HEAD reste ba131884b25c7fe155ce7a10826c751464d8b670 ; aucun commit Phase 6, push, merge vers main, déploiement, écriture Firebase Production ou appel réel de génération IA. Arrêt après ce rapport conformément à la demande.
