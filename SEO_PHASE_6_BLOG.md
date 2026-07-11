# Phase 6 SEO - Blog guides CBD

Date : 2026-07-11  
Branche : `main`  
État initial : `0a48748 perf: optimize product images and first visit rendering`  
Périmètre : `/blog`, `/blog/fleur-cbd-ou-resine-cbd-differences`, `/blog/indoor-greenhouse-hydroponique-differences`

## Objectif

Créer une première architecture de blog statique, publier deux guides piliers CBD, renforcer le maillage interne vers les catégories et produits existants, et exposer des données structurées `BlogPosting` sans modifier les URLs commerciales validées.

## Pages publiées

### /blog

- Title : `Guides CBD : fleurs, résines et méthodes de culture | Verdanza`
- Description : `Guides Verdanza pour comprendre les fleurs CBD, les résines CBD, les méthodes de culture et les critères de comparaison sans promesse médicale.`
- Rôle : page index des guides publiés.
- Données structurées : `BreadcrumbList` uniquement.

### /blog/fleur-cbd-ou-resine-cbd-differences

- Title : `Fleur CBD ou résine CBD : différences et critères de choix | Verdanza`
- Description : `Comprendre les différences entre fleur CBD et résine CBD : présentation, texture, profils, fiches produit et critères de comparaison sans promesse médicale.`
- H1 : `Fleur CBD ou résine CBD : quelles différences ?`
- Auteur : `Rédaction Verdanza`
- Date de publication : `2026-07-11T21:00:00+02:00`
- Date de modification : `2026-07-11T21:00:00+02:00`
- Données structurées : `BlogPosting` et `BreadcrumbList`.

### /blog/indoor-greenhouse-hydroponique-differences

- Title : `Indoor, greenhouse et hydroponique : quelles différences ? | Verdanza`
- Description : `Guide factuel pour comprendre indoor, greenhouse et hydroponique sur les fiches CBD Verdanza, avec distinction entre environnement et méthode de culture.`
- H1 : `Indoor, greenhouse ou hydroponique : comprendre les méthodes de culture`
- Auteur : `Rédaction Verdanza`
- Date de publication : `2026-07-11T21:00:00+02:00`
- Date de modification : `2026-07-11T21:00:00+02:00`
- Données structurées : `BlogPosting` et `BreadcrumbList`.

## Architecture ajoutée

- `src/types/blog.ts` : types des articles et blocs éditoriaux.
- `src/data/blogArticles.tsx` : registre typé des articles publiés.
- `src/pages/BlogPage.tsx` : index blog.
- `src/pages/BlogArticlePage.tsx` : rendu des articles et fallback noindex.
- `src/components/BlogCard.tsx` : carte article réutilisable.
- `src/components/BlogArticleRenderer.tsx` : rendu des blocs sans `dangerouslySetInnerHTML`.
- `src/lib/dateFormat.ts` : formatage de date français.
- `buildBlogPostingJsonLd()` dans `src/lib/structuredData.ts`.

## Images

Images générées depuis les ressources Verdanza existantes via `npm run images:generate`.

- Article fleur/résine :
  - `/images/blog/fleur-cbd-ou-resine-cbd-1x1.webp` : 108 KB.
  - `/images/blog/fleur-cbd-ou-resine-cbd-4x3.webp` : 139 KB.
  - `/images/blog/fleur-cbd-ou-resine-cbd-16x9.webp` : 177 KB.
- Article cultures :
  - `/images/blog/indoor-greenhouse-hydroponique-1x1.webp` : 114 KB.
  - `/images/blog/indoor-greenhouse-hydroponique-4x3.webp` : 149 KB.
  - `/images/blog/indoor-greenhouse-hydroponique-16x9.webp` : 195 KB.

Budget appliqué par `npm run audit:images` et `npm run audit:blog` : 240 KB maximum par image blog.

## Maillage interne

Ajouts principaux :

- Navigation principale : lien `Guides` vers `/blog`.
- Footer : lien `Guides CBD` vers `/blog`.
- Accueil : section de deux cartes guides.
- `/fleurs-cbd` : liens vers les deux guides.
- `/resines-cbd` : lien vers le guide fleur/résine.
- Articles : liens vers `/fleurs-cbd`, `/resines-cbd`, `/qualite-conformite`, `/livraison-postale`, `/livraison-express-aix`, `/boutique` et produits pertinents.

Les liens privés, panier, compte, checkout et admin ne sont pas ajoutés dans le contenu éditorial indexable.

## Données structurées

Chaque article publié expose exactement :

- un `BlogPosting` ;
- un `BreadcrumbList` ;
- aucune donnée `Product`, `Offer`, `Review`, `AggregateRating`, `FAQPage` ou `MedicalWebPage`.

Le `BlogPosting` contient l'URL canonique, le titre, la description, trois images, les dates, `inLanguage`, l'auteur organisation et le publisher existant.

## Sitemap et pré-rendu

- Sitemap avant phase : 25 URLs.
- Sitemap après phase : 28 URLs.
- Routes pré-rendues avant phase : 50.
- Routes pré-rendues après phase : 53.

Note : le compteur local officiel du script `prerender` compte les sorties de routes primaires. La Phase 6 ajoute bien trois pages pré-rendues supplémentaires : `/blog` et les deux articles.

## Contrôles éditoriaux

Les contenus restent factuels :

- pas de promesse médicale ;
- pas de dosage conseillé ;
- pas d'effet garanti ;
- pas de recommandation de consommation ;
- distinction claire entre environnement de culture et méthode hydroponique ;
- mention des produits à venir uniquement comme références annoncées, sans lien d'achat inexistant.

## Audits locaux

Commandes exécutées :

- `npm run images:generate` : OK.
- `npm run sitemap` : OK, 28 URLs.
- `npm run lint` : OK.
- `npm run build` : OK, 53 fichiers HTML pré-rendus.
- `npm run typecheck:api` : OK.
- `npm run audit:prerender` : OK.
- `npm run audit:structured-data` : OK.
- `npm run audit:indexnow` : OK, 28 URLs indexables.
- `npm run audit:seo-landing-pages` : OK.
- `npm run audit:images` : OK.
- `npm run analyze:bundle` : OK.
- `npm run audit:performance` : OK.
- `npm run audit:blog` : OK.
- `npm run audit:runtime -- http://127.0.0.1:4173` : OK.

Contrôle visuel Playwright local :

- mobile 390 px : OK.
- desktop 1280 px : OK.
- routes vérifiées : `/`, `/blog`, les deux articles, `/fleurs-cbd`, `/resines-cbd`, `/produits/cookie-kush-indoor`.
- contrôles : HTTP 200, un seul H1, absence d'overflow horizontal, images article chargées, `BlogPosting` présent sur les articles, aucun `Product` schema sur les articles.

Scan UTF-8 :

- `src`, `dist`, `public/sitemap.xml`, `public/robots.txt` : aucun caractère UTF-8 corrompu détecté.

## Limites et suite

- Le blog est statique et typé, sans CMS.
- L'ajout d'un troisième article se fait dans `src/data/blogArticles.tsx`, avec images générées par `scripts/generateImages.ts`.
- Aucun travail de performance additionnel, aucune PWA et aucune refonte commerciale n'ont été inclus dans cette phase.
- Une future phase CMS pourra remplacer le registre statique si le volume éditorial augmente.

## IndexNow prévu après production

Notification ciblée unique :

- `https://verdanza.fr/blog`
- `https://verdanza.fr/blog/fleur-cbd-ou-resine-cbd-differences`
- `https://verdanza.fr/blog/indoor-greenhouse-hydroponique-differences`
- `https://verdanza.fr/`

Notification complémentaire ciblée, car le maillage interne visible a changé :

- `https://verdanza.fr/fleurs-cbd`
- `https://verdanza.fr/resines-cbd`

Ne pas utiliser `--all-indexable` pour cette phase.

## Google Search Console

URLs à inspecter après déploiement :

- `https://verdanza.fr/blog`
- `https://verdanza.fr/blog/fleur-cbd-ou-resine-cbd-differences`
- `https://verdanza.fr/blog/indoor-greenhouse-hydroponique-differences`
- `https://verdanza.fr/`
- `https://verdanza.fr/fleurs-cbd`
- `https://verdanza.fr/resines-cbd`
