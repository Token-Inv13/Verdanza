# Atelier de sélection dans l'admin Verdanza

## Accès et séparation des données

- Route privée : `/admin/selection`, protégée par la connexion Firebase et le contrôle `adminUsers` déjà utilisés par l'admin.
- API : `/api/selection`. Toutes les opérations de lecture et d'écriture des sélections exigent un jeton Firebase et un compte admin actif, vérifiés côté serveur.
- `productSelections` contient les liens fournisseurs, formats, coûts, notes de test et décisions. Les règles Firestore interdisent tout accès direct depuis un client.
- `productSelectionSheets` ne contient que la projection nécessaire aux fiches clients, avec les chemins techniques des PDF et images. La page publique reçoit une réponse limitée aux champs d'affichage, sans notes ni prix fournisseur.
- Les fichiers sont conservés dans Firebase Storage. L'API publique ne sert un PDF ou une image que si la fiche correspondante est encore publiée.

## Reprendre l'atelier local

1. Dans l'atelier local, exporter une sauvegarde JSON ou récupérer son `products.json` sans le modifier.
2. Ouvrir `/admin/selection` avec le compte admin habituel, puis **Importer JSON**.
3. Lire l'aperçu des références et le nombre de doublons, puis **Confirmer l'import**.
4. Vérifier chaque fiche et ajouter une image que Verdanza peut publier. L'import ne publie rien.

L'import accepte au plus 100 produits par fichier. Il ignore les références déjà présentes en comparant le lien fournisseur normalisé, ou à défaut le nom et le fournisseur. Il n'écrase aucune sélection existante et conserve les caractéristiques fournisseur du JSON local. **Exporter JSON** fournit une sauvegarde des données privées de l'admin ; les fichiers image et PDF restent dans Firebase Storage et ne sont pas inclus dans cette sauvegarde.

## Préparer et publier une fiche

1. Classer la référence **En boutique**. Le produit marchand existant peut être lié par son identifiant Firestore. Si un produit est lié, il doit être actif pour publier.
2. Compléter le nom public, le type fleur ou résine, le goût, les arômes, l'intensité, la famille aromatique et l'aspect.
3. Ajouter une image JPEG, PNG ou WebP depuis l'éditeur. Le navigateur la convertit en JPEG optimisé avant l'envoi.
4. Télécharger **Créer le PDF** pour vérifier le recto verso A6. Si un texte dépasse l'espace disponible, l'outil demande de le raccourcir au lieu de le couper silencieusement.
5. Cliquer **Publier la fiche** et confirmer. Le PDF et l'image deviennent visibles sur `/fiches-produits` après chargement de la page. Une fiche modifiée depuis sa publication peut être remise à jour avec le même bouton.

Une fiche quitte automatiquement la bibliothèque publique si son étape n'est plus **En boutique**. **Dépublier** permet aussi de la retirer sans changer son étape. Les PDF historiques présents dans `public/fiches-produits` et les dix fiches déjà codées dans le site restent indépendants ; la nouvelle bibliothèque se charge en complément. Aucun produit marchand, stock ou prix de vente n'est créé par la publication d'un PDF.

Après la bascule vers l'admin, utiliser ce nouveau parcours pour les nouvelles publications. Le bouton de publication de l'ancien atelier local utilise un autre mécanisme (écriture Git dans le catalogue statique) et ne met pas à jour les sélections privées de l'admin.

## Import depuis un lien fournisseur

L'import direct accepte actuellement les pages HTTPS de `originecbd.fr` et `legrossisteducbd.shop`/`.com`. Il lit les données produit structurées, les variantes WooCommerce et certains paliers affichés. La fiche proposée est un brouillon : l'admin doit vérifier les formats, prix, molécules, provenances et descriptions avant enregistrement. Les autres fournisseurs peuvent être saisis manuellement ou importés via JSON.

## Validation locale

Depuis le dépôt Verdanza, exécuter `npm run typecheck`, `npm run test:admin-selection`, `npm run build:local`, `npm run test:product-sheets`, `npm run test:product-sheet-selector`, `npm run test:product-sheets-ui-v2` et `npm run test:selection-public-library`.

Les tests utilisent des produits fictifs et un endpoint public simulé. Ils ne créent aucune donnée Firebase, aucun PDF public et aucune mise en ligne. Avant une mise en production, vérifier la configuration du bucket Firebase Storage sur l'environnement ciblé, puis faire une recette avec une sélection de test autorisée dans cet environnement.
