# Validation production SEO phases 1 et 2

Date de validation : 2026-07-10  
Domaine valide : https://verdanza.fr  
Projet Vercel : token-inv13s-projects/verdanza  
Deploiement production valide : https://verdanza-9ckp8saux-token-inv13s-projects.vercel.app  
Commit deploye : `5805e3b`

## Perimetre

Validation demandee avant toute phase 3. Aucune donnee structuree, aucun blog et aucune PWA n'ont ete ajoutes.

Phases couvertes :
- Phase 1 : metadata, canonicals, robots, sitemap.
- Phase 2 : pre-rendu HTML initial des routes publiques, produits et routes noindex utiles.

## Deploiement Vercel

Le push initial des commits SEO `b8f5cff` et `4d1e568` a declenche un build Vercel en erreur, car le pre-rendu Playwright necessitait Chromium dans l'image de build.

Corrections deployees :
- `0bb8246` : installation de Chromium Playwright pendant l'installation Vercel.
- `32234fd` : essai `--with-deps`, invalide sur Vercel car `apt-get` n'est pas disponible.
- `535a87a` : installation des dependances Chromium via `dnf install -y nspr nss`, conforme a l'image Amazon Linux 2023 de Vercel.
- `5805e3b` : tolerance explicite des erreurs reseau Firestore attendues pendant le pre-rendu, les services externes etant bloques pour produire un rendu statique stable.

Resultat final Vercel :
- Branche : `main`
- Commit : `5805e3b`
- Statut : `Ready`
- Build : termine en production.
- Commande d'installation : `npm install && dnf install -y nspr nss && npx playwright install chromium`
- Commande de build : `npm run build`
- Sortie : `dist`
- Sitemap genere : 25 URLs.
- Pre-rendu : 50 fichiers HTML generes dans `dist`.

## Validations locales

Commandes executees avec succes :
- `npm run sitemap` : 25 URLs.
- `npm run lint` : OK.
- `npm run typecheck:api` : OK.
- `npm run build` : OK, 50 fichiers HTML pre-rendus.
- `npm run audit:prerender` : OK.
- `npm run audit:runtime -- http://127.0.0.1:4173` : OK avant deploiement.
- `npm run audit:seo -- http://127.0.0.1:4173` : OK avant deploiement.

Note : Vite signale un warning de taille de chunk superieur a 500 kB. Ce warning n'a pas bloque le build et ne change pas la validation SEO des phases 1 et 2.

## Statuts HTTP production

Routes verifiees en production :

| Route | Statut | Resultat |
| --- | ---: | --- |
| `/` | 200 | OK |
| `/boutique` | 200 | OK |
| `/fleurs-cbd` | 200 | OK |
| `/resines-cbd` | 200 | OK |
| `/livraison-express-aix` | 200 | OK |
| `/produits/golden-static` | 200 | OK |
| `/produits/mango-haze-cbd` | 200 | OK |
| `/produits/plutonium-cbd-hydroponique` | 200 | OK |
| `/connexion` | 200 | OK, noindex |
| `/panier` | 200 | OK, noindex |
| `/sitemap.xml` | 200 | OK |
| `/robots.txt` | 200 | OK |
| `/route-inconnue-seo-test-20260710` | 404 | OK |
| `/produits/slug-inconnu-seo-test-20260710` | 404 | OK |

Les routes inconnues ne retombent pas sur une homepage 200.

## HTML initial production

Routes HTML controlees :
- `/`
- `/boutique`
- `/fleurs-cbd`
- `/resines-cbd`
- `/livraison-express-aix`
- `/produits/golden-static`
- `/produits/mango-haze-cbd`
- `/produits/plutonium-cbd-hydroponique`
- `/connexion`
- `/panier`

Constats :
- Chaque route renvoie un HTML initial non vide.
- Chaque route controlee contient un `title`, une meta description, une canonical, une meta robots, OG title, OG URL et Twitter card.
- Chaque route controlee contient exactement un H1.
- Les routes indexables ont `robots=index,follow`.
- `/connexion` et `/panier` ont `robots=noindex,nofollow`.
- Les canonicals des sous-pages pointent vers leur URL propre, pas vers la racine.
- Les fiches produit controlees exposent du contenu produit dans le HTML initial.

## Sitemap et robots

`https://verdanza.fr/sitemap.xml` :
- 25 URLs.
- 0 route privee ou noindex detectee.
- 25/25 URLs en 200.
- 25/25 canonicals alignees avec l'URL du sitemap.

`https://verdanza.fr/robots.txt` :

```txt
User-agent: *
Allow: /

Sitemap: https://verdanza.fr/sitemap.xml
```

Le robots.txt n'interdit pas le crawl des ressources publiques et declare le sitemap canonique.

## Smoke test navigateur production

Smoke test Playwright execute sur desktop 1280x900 et mobile 390x844, avec validation explicite de l'age gate.

Resultats :
- Homepage chargee, H1 unique.
- Boutique chargee, produit `Golden Static` visible.
- Fiche produit `Golden Static` chargee.
- Bouton d'ajout panier disponible.
- Ajout panier fonctionnel.
- Panier contient `Golden Static`.
- `/connexion`, `/compte` et `/admin` restent en `noindex,nofollow`.
- Aucune erreur console non attendue.

Les scripts `audit:seo` et `audit:runtime` sur production expirent avec `networkidle`, car Firebase garde des connexions reseau ouvertes. La validation production a donc ete faite avec des controles HTTP/HTML directs et un smoke test navigateur base sur `domcontentloaded`, plus adapte au comportement runtime de l'app.

## Catalogue local vs Firestore

Comparaison lecture seule sur le projet Firebase `verdanza-1f621`, collection `products`.

Resultats :
- Produits locaux : 11.
- Produits Firestore : 11.
- Produits actifs locaux : 11.
- Produits actifs Firestore : 11.
- Produits manquants dans Firestore : 0.
- Produits supplementaires dans Firestore : 0.
- Divergences SEO/catalogue sur `slug`, `name`, `category`, `price`, `isActive`, `isFeatured`, `stockStatus`, `comingSoon`, `seoTitle`, `seoDescription`, `image` : 0.

Divergences constatees uniquement sur `stock` :
- `resin-golden-static` : local 100, Firestore 20.
- `resin-supreme-purple-cbd` : local 100, Firestore 21.
- `flower-cookie-kush-indoor` : local 100, Firestore 18.
- `flower-petites-tetes-og-kush` : local 100, Firestore 19.
- `flower-harlequin-greenhouse` : local 100, Firestore 19.

Ces differences ne bloquent pas la validation SEO : le script de seed existant preserve volontairement les stocks operationnels Firestore.

## Conclusion

Validation production SEO phases 1 et 2 : OK.

Le site public `https://verdanza.fr` sert bien les pages indexables avec un HTML initial crawlable, des canonicals propres, des robots coherents, un sitemap propre et des routes inconnues en 404. Les pages privees ou transactionnelles controlees restent en noindex.

La phase 3 peut demarrer. Neanmoins, les points suivants doivent rester hors phase 3 ou etre traites separement :
- optimiser plus tard le chunk JavaScript principal si la performance devient prioritaire ;
- adapter les scripts d'audit production pour ne plus utiliser `networkidle` sur une app Firebase ;
- garder le suivi stock Firestore comme donnee operationnelle distincte du catalogue SEO local.
