# SEO phase 3 - Donnees structurees et fils d'Ariane

Date : 2026-07-10  
Etat initial : `bbdea35`  
Domaine canonique : `https://verdanza.fr`  
Perimetre : JSON-LD fiable, Product, WebSite, OnlineStore, BreadcrumbList et fils d'Ariane visibles.

## Etat initial

Les phases 1 et 2 etaient validees en production. Les pages publiques etaient deja prerendered avec meta title, description, canonical, robots, OG/Twitter et sitemap.

Constats avant modification :
- aucun JSON-LD existant ;
- aucun fil d'Ariane visible ;
- 11 produits publics actifs ;
- catalogue SEO local et Firestore aligne, hors stock operationnel ;
- avis clients internes non publies ;
- routes noindex deja presentes pour panier, checkout, compte, admin et pages de fallback.

## Architecture choisie

Ajouts principaux :
- `src/components/JsonLd.tsx` : injection controlee de scripts `application/ld+json`.
- `src/components/Breadcrumbs.tsx` : fil visible accessible et generation optionnelle de `BreadcrumbList`.
- `src/lib/siteUrl.ts` : normalisation d'URL absolues `https://verdanza.fr`.
- `src/lib/structuredData.ts` : builders JSON-LD et fonction centrale de disponibilite produit.
- `scripts/auditStructuredData.ts` : audit des fichiers HTML generes dans `dist`.

`JsonLd` utilise un identifiant stable `data-jsonld-id`, remplace le contenu lors des navigations SPA et supprime le script au demontage. La serialisation echappe les caracteres sensibles comme `<`, `>`, `&`, U+2028 et U+2029.

Le serveur de `scripts/prerender.ts` utilise maintenant le shell `index.html` original non mute comme fallback pendant tout le rendu. Cela evite qu'un schema de la page d'accueil soit reutilise comme template sur les autres routes prerendered.

## Fichiers modifies

- `package.json`
- `src/components/Breadcrumbs.tsx`
- `src/components/JsonLd.tsx`
- `src/lib/siteUrl.ts`
- `src/lib/structuredData.ts`
- `src/pages/HomePage.tsx`
- `src/pages/ShopPage.tsx`
- `src/pages/CategoryPage.tsx`
- `src/pages/ProductPage.tsx`
- `src/pages/DeliveryPage.tsx`
- `src/pages/ContentPage.tsx`
- `src/pages/LegalPage.tsx`
- `scripts/prerender.ts`
- `scripts/auditStructuredData.ts`
- `SEO_PHASE_3_STRUCTURED_DATA.md`

## Schemas ajoutes

Accueil :
- `WebSite`
- `OnlineStore`

Pages publiques hors accueil :
- `BreadcrumbList`

Fiches produit valides et indexables :
- `Product`
- `Offer`, integre dans `Product`
- `BreadcrumbList`

Pages noindex, privees, panier, checkout, admin et fallback :
- aucun schema commercial public ;
- aucun `Product` ;
- aucun `BreadcrumbList` structure.

## Regles Product

Chaque fiche produit valide utilise uniquement les donnees publiques du catalogue :
- `name` : nom public ;
- `description` : `longDescription` visible ;
- `image` : URL absolue de l'image produit ;
- `sku` : identifiant produit stable ;
- `category` : `Fleur CBD` ou `Resine CBD` ;
- `url` : canonical absolue ;
- `price` : prix numerique au gramme ;
- `priceCurrency` : `EUR` ;
- `itemCondition` : `https://schema.org/NewCondition` ;
- `seller` : `https://verdanza.fr/#organization`.

## Disponibilite

La fonction centrale `productAvailability(product)` applique :
- `https://schema.org/InStock` si le produit est commandable et affiche un bouton d'ajout panier ;
- `https://schema.org/OutOfStock` si `comingSoon === true` ou `stockStatus === "coming_soon"`.

Les produits en arrivage ne sont pas marques `PreOrder`, car ils ne sont pas commandables en precommande.

## Exclusions volontaires

Avis et notes :
- aucun `aggregateRating` ;
- aucun `review` ;
- les avis existants sont internes et non publics.

Marque produit :
- aucun `brand` automatique ;
- Verdanza est declare comme vendeur via `seller`, pas comme producteur ou marque fabricant.

OnlineStore :
- nom : `Verdanza` ;
- URL : `https://verdanza.fr/` ;
- logo : `https://verdanza.fr/verdanza-logo.png` ;
- email et contactPoint : `contact@verdanza.fr`, deja affiche publiquement.

Informations exclues :
- adresse physique ;
- telephone ;
- SIREN, SIRET, TVA ;
- legalName ;
- horaires ;
- LocalBusiness ;
- CBDStore invente ;
- comptes sociaux ;
- politiques livraison/retour structurees approximatives ;
- SearchAction.

## Fils d'Ariane visibles

Pages avec fil visible :
- `/boutique` : Accueil > Boutique
- `/fleurs-cbd` : Accueil > Fleurs CBD
- `/resines-cbd` : Accueil > Resines CBD
- `/livraison-express-aix` : Accueil > Livraison express Aix
- `/livraison-postale` : Accueil > Livraison postale
- `/qualite-conformite` : Accueil > Qualite & conformite
- `/a-propos` : Accueil > A propos
- `/faq` : Accueil > FAQ
- `/contact` : Accueil > Contact
- `/mentions-legales` : Accueil > Informations legales
- `/cgv` : Accueil > Informations legales > Conditions generales de vente
- `/confidentialite` : Accueil > Informations legales > Politique de confidentialite
- `/retours` : Accueil > Informations legales > Politique de retour
- fiches fleurs : Accueil > Fleur CBD > Nom du produit
- fiches resines : Accueil > Resine CBD > Nom du produit

La page d'accueil n'a pas de fil d'Ariane. Les pages noindex n'ont pas de BreadcrumbList structure.

## Audit JSON-LD

Commande ajoutee :

```bash
npm run audit:structured-data
```

Resultat :
- 1 `WebSite` et 1 `OnlineStore` sur l'accueil ;
- aucun `Product` sur l'accueil ;
- 1 `BreadcrumbList` sur chaque page publique indexable hors accueil ;
- 1 `Product`, 1 `Offer` integre et 1 `BreadcrumbList` sur chaque fiche produit active ;
- aucun schema commercial public sur les pages noindex ;
- prix numeriques et `EUR` valides ;
- disponibilites `InStock` / `OutOfStock` conformes au comportement visible ;
- aucun `aggregateRating` ;
- aucun `review` ;
- positions BreadcrumbList continues ;
- dernier breadcrumb aligne avec la canonical.

## Tests executes

Commandes executees avec succes :

```bash
npm run sitemap
npm run lint
npm run build
npm run typecheck:api
npm run audit:prerender
npm run audit:structured-data
npm run audit:runtime -- http://127.0.0.1:4173
npm run audit:seo -- http://127.0.0.1:4173
```

Smoke test Playwright local sur desktop 1280 px et mobile 390 px :
- validation age gate ;
- accueil vers boutique ;
- boutique vers produit ;
- produit fleur vers produit resine ;
- produit vers categorie ;
- produit vers panier noindex ;
- absence de Product sur page privee/noindex ;
- jamais deux Product simultanes dans le DOM ;
- panier fonctionnel ;
- bouton favoris fonctionnel avec message utilisateur ;
- aucune erreur console inattendue.

## URLs a tester manuellement

Rich Results Test Google :
- Produit disponible resine : `https://verdanza.fr/produits/golden-static`
- Produit disponible fleur : `https://verdanza.fr/produits/cookie-kush-indoor`
- Produit en arrivage : `https://verdanza.fr/produits/mango-haze-cbd`
- Page categorie fleurs : `https://verdanza.fr/fleurs-cbd`
- Page categorie resines : `https://verdanza.fr/resines-cbd`
- Page d'accueil : `https://verdanza.fr/`

Ces tests manuels verifient l'eligibilite technique. Ils ne garantissent pas l'affichage effectif d'un resultat enrichi par Google.

## Limites restantes

- L'audit production `networkidle` reste inadapte aux connexions Firebase persistantes ; utiliser `domcontentloaded` ou des attentes explicites.
- Les libelles de categorie JSON-LD utilisent volontairement `Resine CBD` sans accent dans la categorie produit pour rester sobres et stables.
- Les stocks Firestore restent operationnels et distincts des stocks locaux ; la disponibilite JSON-LD depend du comportement public `comingSoon` / `stockStatus`.
- Le chunk JavaScript principal reste au-dessus de 500 kB, sans impact bloquant sur cette phase.

## Actions apres deploiement

- Lancer Google Rich Results Test sur les URLs listees.
- Inspecter une fiche disponible et une fiche en arrivage dans Search Console apres indexation.
- Verifier en production que le dernier deploiement Vercel contient bien le commit de phase 3.
- Ne pas ajouter d'avis, de marque produit ou de donnees legales structurees tant que ces informations ne sont pas publiques et confirmees.
