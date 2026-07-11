# Phase 4 SEO - Categories et page locale Aix

Date : 2026-07-11  
Branche : `main`  
Etat initial : `7f686d3 seo: add controlled indexnow submissions`  
Perimetre : `/fleurs-cbd`, `/resines-cbd`, `/livraison-express-aix`

## Etat initial

- La branche locale et `origin/main` etaient alignees sur `7f686d3`.
- Les trois pages etaient deja indexables, canonicals, pre-rendues et presentes dans le sitemap.
- Les pages categories affichaient une introduction courte, une notice catalogue et la grille produit.
- La page locale affichait les zones configurees mais peu d'informations editoriales.
- Les fichiers non suivis preexistants sont restes hors perimetre.

## Analyse des pages

### /fleurs-cbd

Intention retenue : presenter la selection de fleurs CBD et aider a comparer les references selon culture, profil, origine connue, disponibilite et prix.

Avant :
- title : `Fleurs CBD - Verdanza CBD`
- description : generique, commune au modele categorie.

Apres :
- title : `Fleurs CBD premium : indoor, greenhouse et hydroponique | Verdanza`
- description : selection fleurs CBD, methodes de culture presentes, livraison locale et postale.

Sections ajoutees :
- comprendre les methodes de culture ;
- comment comparer les fleurs CBD ;
- la selection Verdanza ;
- fleurs a comparer ;
- liens utiles ;
- FAQ visible.

### /resines-cbd

Intention retenue : presenter les resines CBD et distinguer les references selon texture, composition declaree, profil et disponibilite.

Avant :
- title : `Resines CBD - Verdanza CBD`
- description : generique, commune au modele categorie.

Apres :
- title : `Resines CBD premium : selection et profils | Verdanza`
- description : resines disponibles, caracteristiques affichees, livraison locale et postale.

Sections ajoutees :
- comprendre CBD, CBG et autres indications ;
- comment comparer les resines CBD ;
- la selection Verdanza ;
- resines a decouvrir ;
- liens utiles ;
- FAQ visible.

### /livraison-express-aix

Intention retenue : presenter clairement la livraison locale autour d'Aix-en-Provence avec les conditions configurees.

Avant :
- title : `Livraison CBD express Aix-en-Provence - Verdanza`
- H1 : `Livraison express Aix`
- contenu limite aux cartes de zones.

Apres :
- title : `Livraison CBD a Aix-en-Provence et alentours | Verdanza`
- description : livraison locale, zones configurees, minimum, horaires et creneaux.
- H1 : `Livraison de CBD a Aix-en-Provence et alentours`

Sections ajoutees :
- modalites essentielles ;
- zones desservies ;
- comment commander ;
- livraison locale ou postale ;
- liens utiles ;
- FAQ locale.

## Composants et donnees

Composants reutilises :
- `Seo`
- `Breadcrumbs`
- `CatalogNotice`
- `ProductCard`
- `Link` de React Router

Nouveaux composants locaux :
- `CategoryGuide`
- `LocalDeliveryPage`

Donnees utilisees :
- `getProductsByCategory()` depuis `src/data/products.ts`
- `localDeliveryZones` depuis `src/data/deliveryZones.ts`
- `LOCAL_DELIVERY_MINIMUM`, `POSTAL_DELIVERY_MINIMUM`, `POSTAL_FREE_SHIPPING_THRESHOLD`

Informations volontairement exclues :
- adresse physique ;
- carte Google Maps ;
- LocalBusiness / Store ;
- FAQPage ;
- ItemList ;
- Product sur les pages categories ;
- avis, AggregateRating ou Review ;
- promesses medicales ;
- delais garantis non configures ;
- nouvelles pages locales.

## Maillage interne

Ajoute depuis `/fleurs-cbd` :
- `/resines-cbd`
- `/livraison-express-aix`
- `/livraison-postale`
- `/qualite-conformite`
- `/boutique`

Ajoute depuis `/resines-cbd` :
- `/fleurs-cbd`
- `/livraison-express-aix`
- `/livraison-postale`
- `/qualite-conformite`
- `/boutique`

Ajoute depuis `/livraison-express-aix` :
- `/fleurs-cbd`
- `/resines-cbd`
- `/boutique`
- `/livraison-postale`
- `/qualite-conformite`
- `/faq`
- `/contact`

## Audit automatise

Nouveau script :

```bash
npm run audit:seo-landing-pages
```

Controle :
- route indexable ;
- title specifique ;
- description specifique ;
- canonical ;
- robots `index,follow` ;
- un seul H1 ;
- H2 attendus ;
- contenu principal ;
- liens internes obligatoires ;
- absence de liens prives dans le contenu principal ;
- BreadcrumbList ;
- absence de Product, Review, AggregateRating, FAQPage, LocalBusiness ;
- absence d'expressions medicales interdites ;
- contenu fleurs et resines distinct.

## Resultats locaux

Commandes executees :
- `npm run sitemap` : OK, 25 URL.
- `npm run lint` : OK.
- `npm run build` : OK, 50 fichiers HTML pre-rendus.
- `npm run typecheck:api` : OK.
- `npm run audit:prerender` : OK.
- `npm run audit:structured-data` : OK.
- `npm run audit:indexnow` : OK.
- `npm run audit:seo-landing-pages` : OK.
- `npm run audit:runtime -- http://127.0.0.1:4173` : OK.

Smoke Playwright :
- mobile 390 px : OK.
- desktop 1280 px : OK.
- pages testees : `/fleurs-cbd`, `/resines-cbd`, `/livraison-express-aix`.
- liens internes, cartes produits, cartes de zones, age gate, navigation produit, panier et favoris : OK.

## Validation HTML pre-rendu

Les trois pages contiennent dans le HTML initial :
- title specifique ;
- meta description specifique ;
- canonical correcte ;
- robots `index,follow` ;
- un seul H1 ;
- H2 principaux ;
- texte SEO visible ;
- liens internes ;
- BreadcrumbList ;
- aucun Product JSON-LD ;
- aucun contenu prive.

## Limites

- Pas de nouvelle page locale.
- Pas de blog.
- Pas de travail performance.
- Pas de nouvelle donnee structuree locale.
- Les contenus restent limites aux donnees deja disponibles dans le projet.

## IndexNow

URL a notifier apres deploiement :
- `https://verdanza.fr/fleurs-cbd`
- `https://verdanza.fr/resines-cbd`
- `https://verdanza.fr/livraison-express-aix`

Ne pas utiliser `--all-indexable` pour cette phase.

## Google Search Console

URL a reinspecter manuellement apres deploiement :
- `https://verdanza.fr/fleurs-cbd`
- `https://verdanza.fr/resines-cbd`
- `https://verdanza.fr/livraison-express-aix`
