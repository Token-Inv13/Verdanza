# Feuille de route SEO Verdanza

## Etat actuel

- Le site utilise des titres, descriptions, URL canoniques et balises Open Graph par page via le composant `Seo`.
- `robots.txt` bloque deja les espaces Admin, compte et checkout.
- `sitemap.xml` couvre les principales pages publiques, mais doit etre maintenu avec le catalogue.
- Le rendu est une SPA Vite : les metadonnees sont injectees cote client. Un prerendu ou SSR pourra etre etudie si l'indexation reelle montre des limites.
- Aucune PWA n'est configuree : pas de manifeste, pas de service worker et pas de mode hors ligne.

## Priorite 1 - Fondations techniques

- Auditer chaque page pour garantir un `title`, une meta description et une URL canonique uniques.
- Ajouter les balises Twitter Card dynamiques au composant `Seo`.
- Definir `noindex,nofollow` sur connexion, inscription, panier, checkout, confirmation et toutes les pages de compte/Admin.
- Mettre a jour automatiquement le sitemap a partir des routes publiques et des produits actifs.
- Ajouter au sitemap les nouvelles fiches produit publiees.
- Verifier une seule balise H1 par page et une hierarchie H2/H3 logique.
- Controler les liens internes, redirections, pages 404 et images manquantes.
- Mesurer Core Web Vitals, poids des images et chargement des polices.
- Evaluer le prerendu des pages publiques avant d'envisager une migration SSR.

## Priorite 2 - Catalogue

- Conserver un titre et une description uniques pour chaque produit.
- Renseigner des textes alternatifs descriptifs pour chaque image produit.
- Ajouter des donnees structurees `Product` uniquement avec les donnees reelles disponibles.
- Ne pas inclure de notes ou d'avis dans le balisage tant que les avis restent internes.
- Documenter prix, disponibilite, categorie, origine et culture sans promesse medicale.
- Relier chaque fiche aux pages categorie, livraison et qualite.

## Priorite 3 - SEO local

- Consolider la page de livraison locale autour d'Aix-en-Provence avec un texte utile et non repetitif.
- Etudier une URL dediee `/livraison-cbd-aix-en-provence` avec canonical propre.
- Travailler naturellement les sujets : CBD Aix-en-Provence, livraison CBD Aix-en-Provence, fleurs CBD Aix-en-Provence et boutique CBD en ligne France.
- Ne publier que les zones et horaires reellement disponibles.
- Preparer une fiche d'etablissement locale seulement apres validation des informations legales publiques.

## Priorite 4 - Confiance et conformite

- Enrichir progressivement Qualite et conformite, Livraison, FAQ, CGV, Confidentialite et Retours.
- Garder un ton factuel, sans allegation therapeutique ni promesse medicale.
- Utiliser les informations et analyses transmises par les producteurs sans revendiquer une relation directe non verifiee.
- Faire valider les informations legales avant toute diffusion supplementaire.

## Architecture blog proposee

- `/blog` : liste paginee des articles publies.
- `/blog/:slug` : article avec titre, extrait, auteur, date, categorie et metadonnees.
- Categories initiales : Guide CBD, Fleurs CBD, Resines CBD, Livraison CBD, Qualite et conformite, Conseils d'achat, Actualites Verdanza, CBD a Aix-en-Provence.
- Statuts futurs : brouillon, programme, publie, archive. Les brouillons restent en `noindex`.
- Ajouter `Article` en donnees structurees, Open Graph, canonical et inclusion au sitemap uniquement apres publication.

## Ligne editoriale

- Contenu informatif, sobre et utile.
- Aucun conseil medical, claim sante ou promesse therapeutique.
- Mettre en avant selection, conformite, tracabilite, conservation et lecture des fiches produit.
- Relier chaque article a une page utile : boutique, fleurs, resines, livraison ou qualite.
- Utiliser des appels a l'action sobres : `Decouvrir la selection Verdanza`, `Voir les produits disponibles`, `Consulter les informations de livraison`.

## Premiers sujets

1. Comment choisir une fleur CBD ?
2. Difference entre fleurs CBD et resines CBD
3. Qu'est-ce qu'une resine CBD ?
4. CBD : comprendre le taux de THC
5. Pourquoi Verdanza privilegie une selection courte
6. Livraison CBD a Aix-en-Provence : comment cela fonctionne ?
7. Comment lire une fiche produit CBD ?
8. CBD en France : points essentiels a connaitre
9. Comment conserver ses fleurs CBD ?
10. Comment Verdanza selectionne ses produits ?

Pour chaque article : definir un mot-cle principal, une intention, un titre SEO, une meta description, un plan H2/H3, les liens internes et une date de revision.

## PWA - Integration progressive

1. Ajouter un manifeste avec nom, nom court, couleurs, `start_url` et mode `standalone`.
2. Produire des icones 192 px, 512 px et maskable a partir du logo valide.
3. Ajouter un service worker avec une strategie prudente pour les assets statiques.
4. Ne jamais mettre en cache de maniere persistante les donnees compte, panier, commande ou Admin.
5. Tester installation, mise a jour, navigation standalone et comportement hors ligne sur Android et iOS.

## Ordre de realisation recommande

1. Corriger `noindex`, Twitter Card et sitemap catalogue.
2. Auditer les metadonnees et titres de toutes les routes publiques.
3. Ajouter les donnees structurees produit sans avis publics.
4. Optimiser la page livraison locale.
5. Valider l'architecture et le mode de publication du blog.
6. Publier deux articles piliers, puis un rythme hebdomadaire soutenable.
7. Integrer la PWA seulement apres validation des besoins hors ligne et des regles de cache.
