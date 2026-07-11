# Phase 4 SEO - Catégories et page locale Aix

Date : 2026-07-11  
Branche : `main`  
État initial : `7f686d3 seo: add controlled indexnow submissions`  
Périmètre : `/fleurs-cbd`, `/resines-cbd`, `/livraison-express-aix`

## État initial

- La branche locale et `origin/main` étaient alignées sur `7f686d3`.
- Les trois pages étaient déjà indexables, canonicals, pré-rendues et présentes dans le sitemap.
- Les pages catégories affichaient une introduction courte, une notice catalogue et la grille produit.
- La page locale affichait les zones configurées mais peu d'informations éditoriales.
- Les fichiers non suivis préexistants sont restés hors périmètre.

## Analyse des pages

### /fleurs-cbd

Intention retenue : présenter la sélection de fleurs CBD et aider à comparer les références selon culture, profil, origine connue, disponibilité et prix.

Avant :
- title : `Fleurs CBD - Verdanza CBD`
- description : générique, commune au modèle catégorie.

Après :
- title : `Fleurs CBD premium : indoor, greenhouse et hydroponique | Verdanza`
- description : sélection fleurs CBD, méthodes de culture présentes, livraison locale et postale.

Sections ajoutées :
- comprendre les méthodes de culture ;
- comment comparer les fleurs CBD ;
- la sélection Verdanza ;
- fleurs à comparer ;
- liens utiles ;
- FAQ visible.

### /resines-cbd

Intention retenue : présenter les résines CBD et distinguer les références selon texture, composition déclarée, profil et disponibilité.

Avant :
- title : `Résines CBD - Verdanza CBD`
- description : générique, commune au modèle catégorie.

Après :
- title : `Résines CBD premium : sélection et profils | Verdanza`
- description : résines disponibles, caractéristiques affichées, livraison locale et postale.

Sections ajoutées :
- comprendre CBD, CBG et autres indications ;
- comment comparer les résines CBD ;
- la sélection Verdanza ;
- résines à découvrir ;
- liens utiles ;
- FAQ visible.

### /livraison-express-aix

Intention retenue : présenter clairement la livraison locale autour d'Aix-en-Provence avec les conditions configurées.

Avant :
- title : `Livraison CBD express Aix-en-Provence - Verdanza`
- H1 : `Livraison express Aix`
- contenu limité aux cartes de zones.

Après :
- title : `Livraison CBD à Aix-en-Provence et alentours | Verdanza`
- description : livraison locale, zones configurées, minimum, horaires et créneaux.
- H1 : `Livraison de CBD à Aix-en-Provence et alentours`

Sections ajoutées :
- modalités essentielles ;
- zones desservies ;
- comment commander ;
- livraison locale ou postale ;
- liens utiles ;
- FAQ locale.

## Composants et données

Composants réutilisés :
- `Seo`
- `Breadcrumbs`
- `CatalogNotice`
- `ProductCard`
- `Link` de React Router

Nouveaux composants locaux :
- `CategoryGuide`
- `LocalDeliveryPage`

Données utilisées :
- `getProductsByCategory()` depuis `src/data/products.ts`
- `localDeliveryZones` depuis `src/data/deliveryZones.ts`
- `LOCAL_DELIVERY_MINIMUM`, `POSTAL_DELIVERY_MINIMUM`, `POSTAL_FREE_SHIPPING_THRESHOLD`

Informations volontairement exclues :
- adresse physique ;
- carte Google Maps ;
- LocalBusiness / Store ;
- FAQPage ;
- ItemList ;
- Product sur les pages catégories ;
- avis, AggregateRating ou Review ;
- promesses médicales ;
- délais garantis non configurés ;
- nouvelles pages locales.

## Maillage interne

Ajouté depuis `/fleurs-cbd` :
- `/resines-cbd`
- `/livraison-express-aix`
- `/livraison-postale`
- `/qualite-conformite`
- `/boutique`

Ajouté depuis `/resines-cbd` :
- `/fleurs-cbd`
- `/livraison-express-aix`
- `/livraison-postale`
- `/qualite-conformite`
- `/boutique`

Ajouté depuis `/livraison-express-aix` :
- `/fleurs-cbd`
- `/resines-cbd`
- `/boutique`
- `/livraison-postale`
- `/qualite-conformite`
- `/faq`
- `/contact`

## Audit automatisé

Nouveau script :

```bash
npm run audit:seo-landing-pages
```

Contrôle :
- route indexable ;
- title spécifique ;
- description spécifique ;
- canonical ;
- robots `index,follow` ;
- un seul H1 ;
- H2 attendus ;
- contenu principal ;
- liens internes obligatoires ;
- absence de liens privés dans le contenu principal ;
- BreadcrumbList ;
- absence de Product, Review, AggregateRating, FAQPage, LocalBusiness ;
- absence d'expressions médicales interdites ;
- absence des formes françaises non accentuées introduites pendant la phase 4 ;
- absence de caractères UTF-8 corrompus ;
- contenu fleurs et résines distinct.

## Résultats locaux

Commandes exécutées :
- `npm run sitemap` : OK, 25 URL.
- `npm run lint` : OK.
- `npm run build` : OK, 50 fichiers HTML pré-rendus.
- `npm run typecheck:api` : OK.
- `npm run audit:prerender` : OK.
- `npm run audit:structured-data` : OK.
- `npm run audit:indexnow` : OK.
- `npm run audit:seo-landing-pages` : OK.
- `npm run audit:runtime -- http://127.0.0.1:4173` : OK.

Smoke Playwright :
- mobile 390 px : OK.
- desktop 1280 px : OK.
- pages testées : `/fleurs-cbd`, `/resines-cbd`, `/livraison-express-aix`.
- liens internes, cartes produits, cartes de zones, age gate, navigation produit, panier et favoris : OK.

## Validation HTML pré-rendu

Les trois pages contiennent dans le HTML initial :
- title spécifique ;
- meta description spécifique ;
- canonical correcte ;
- robots `index,follow` ;
- un seul H1 ;
- H2 principaux ;
- texte SEO visible ;
- liens internes ;
- BreadcrumbList ;
- aucun Product JSON-LD ;
- aucun contenu privé.

## Limites

- Pas de nouvelle page locale.
- Pas de blog.
- Pas de travail performance.
- Pas de nouvelle donnée structurée locale.
- Les contenus restent limités aux données déjà disponibles dans le projet.

## IndexNow

URL à notifier après déploiement :
- `https://verdanza.fr/fleurs-cbd`
- `https://verdanza.fr/resines-cbd`
- `https://verdanza.fr/livraison-express-aix`

Ne pas utiliser `--all-indexable` pour cette phase.

## Google Search Console

URL à réinspecter manuellement après déploiement :
- `https://verdanza.fr/fleurs-cbd`
- `https://verdanza.fr/resines-cbd`
- `https://verdanza.fr/livraison-express-aix`
