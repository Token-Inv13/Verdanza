# Phase 5 performance - Verdanza.fr

Date locale : 2026-07-11

Commit de référence : `afab586`

## Objectif

Optimiser le chargement initial sans modifier le SEO éditorial, les URL, les données structurées, le tunnel commerce ou l'apparence publique validée.

## Méthode

- Build de référence puis build optimisé via `npm run build`.
- Serveur local : `npm run preview -- --host 127.0.0.1 --port 4173`.
- Lighthouse 13.4.0 avec Chromium Playwright, 5 routes, mobile et desktop, 3 passages par couple route/profil.
- Mesures complémentaires Playwright avec `localStorage.verdanza-age-confirmed=true` pour isoler l'expérience après validation d'âge.
- Rapports JSON générés dans `reports/performance/phase5-before.json`, `reports/performance/phase5-after.json` et `reports/performance/bundle-latest.json`.
- PageSpeed Insights / CrUX interrogé côté production. La baseline ne contenait pas de données terrain URL/origine suffisantes ; la passe après a retourné HTTP 429, donc aucune valeur INP/CrUX n'est reportée.

## Optimisations appliquées

- Découpage de routes avec `React.lazy` et `Suspense` pour les zones admin, compte, panier, checkout, auth et pages légales.
- Découpage Vite explicite des bibliothèques stables : `vendor-firebase`, `vendor-react`, socle applicatif public.
- Hydratation catalogue stabilisée : `useProducts()` démarre sur les produits locaux actifs avant synchronisation Firestore.
- Dimensions explicites sur les images produit et sur l'image hero.
- Image hero prioritaire sur la page d'accueil avec `fetchPriority="high"` et sans lazy-loading.
- Images des premières cartes produit chargées en priorité limitée, puis lazy-loading pour le reste.
- Headers Vercel : cache immutable pour `/assets/*`, cache court avec stale-while-revalidate pour les images publiques non hashées.
- Ajout de `npm run analyze:bundle` et `npm run audit:performance`.

## Bundle

| Élément | Avant | Après |
| --- | ---: | ---: |
| JS initial total gzip | 231 KB | 205 KB |
| Plus gros JS gzip | 231 KB, chunk unique | 120 KB, `vendor-firebase` |
| JS applicatif public gzip | 231 KB inclus dans chunk unique | 21 KB |
| Admin page gzip | inclus dans chunk unique | 17 KB hors initial public |
| CSS gzip | 6 KB | 6 KB |
| HTML pré-rendu | 50 routes | 50 routes |

Les gros fichiers image restent le principal poids réseau : plusieurs fiches PNG produit dépassent 1,5 MB. Elles n'ont pas été converties dans cette phase pour éviter une modification visuelle ou produit non demandée.

## Lighthouse local - première visite

Médianes sur 3 passages. Première visite = age gate visible.

| Route | Profil | Score avant -> après | LCP avant -> après | CLS avant -> après | TBT avant -> après |
| --- | --- | ---: | ---: | ---: | ---: |
| `/` | desktop | 83 -> 84 | 2895 -> 2758 ms | 0.007 -> 0.007 | 12 -> 0 ms |
| `/` | mobile | 61 -> 56 | 18105 -> 16822 ms | 0 -> 0 | 308 -> 514 ms |
| `/boutique` | desktop | 56 -> 81 | 3524 -> 3355 ms | 0.975 -> 0.001 | 3 -> 29 ms |
| `/boutique` | mobile | 59 -> 65 | 21744 -> 21400 ms | 0.186 -> 0.038 | 64 -> 216 ms |
| `/fleurs-cbd` | desktop | 81 -> 82 | 3349 -> 3285 ms | 0 -> 0 | 16 -> 21 ms |
| `/fleurs-cbd` | mobile | 67 -> 65 | 21161 -> 21059 ms | 0.106 -> 0.015 | 88 -> 213 ms |
| `/livraison-express-aix` | desktop | 86 -> 88 | 2292 -> 2320 ms | 0 -> 0 | 128 -> 0 ms |
| `/livraison-express-aix` | mobile | 65 -> 54 | 13756 -> 13810 ms | 0 -> 0.288 | 168 -> 113 ms |
| `/produits/golden-static` | desktop | 86 -> 86 | 2504 -> 2536 ms | 0 -> 0.001 | 0 -> 0 ms |
| `/produits/golden-static` | mobile | 67 -> 68 | 15266 -> 14862 ms | 0 -> 0.015 | 116 -> 102 ms |

Les scores première visite restent fortement influencés par l'age gate et les images LCP. Le gain le plus net est la suppression des shifts liés au remplacement tardif des grilles produit.

## Playwright local - âge confirmé

Médianes sur 3 passages avec confirmation d'âge déjà présente.

| Route | Profil | LCP avant -> après | CLS avant -> après | TBT avant -> après |
| --- | --- | ---: | ---: | ---: |
| `/` | mobile | 332 -> 280 ms | 0.012 -> 0 | 12 -> 12 ms |
| `/boutique` | mobile | 272 -> 348 ms | 0.174 -> 0 | 16 -> 60 ms |
| `/fleurs-cbd` | mobile | 468 -> 324 ms | 0.296 -> 0 | 85 -> 63 ms |
| `/livraison-express-aix` | mobile | 316 -> 300 ms | 0.062 -> 0 | 41 -> 59 ms |
| `/produits/golden-static` | mobile | 356 -> 312 ms | 0.724 -> 0 | 41 -> 81 ms |
| `/` | desktop | 388 -> 300 ms | 0.008 -> 0.008 | 36 -> 17 ms |
| `/boutique` | desktop | 404 -> 320 ms | 0.374 -> 0 | 55 -> 53 ms |
| `/fleurs-cbd` | desktop | 388 -> 324 ms | 0.373 -> 0 | 72 -> 79 ms |
| `/livraison-express-aix` | desktop | 316 -> 320 ms | 0.033 -> 0.033 | 49 -> 44 ms |
| `/produits/golden-static` | desktop | 372 -> 308 ms | 0.201 -> 0.001 | 38 -> 39 ms |

## Décisions non retenues

- Pas de passage à `hydrateRoot` : le pré-rendu et la synchronisation Firestore rendent le risque de mismatch trop élevé pour cette phase.
- Pas de suppression ou contournement de l'age gate.
- Pas de conversion massive des images produit : sujet séparé, avec risque visuel et besoin de validation produit. Les images non hashées gardent donc un cache court plutôt qu'un cache annuel.
- Pas de PWA, pas de blog, pas de modification éditoriale.
- Pas d'IndexNow : les modifications sont techniques et ne changent pas les contenus indexables.

## Audits attendus

- `npm run sitemap`
- `npm run lint`
- `npm run build`
- `npm run typecheck:api`
- `npm run audit:prerender`
- `npm run audit:structured-data`
- `npm run audit:indexnow`
- `npm run audit:seo-landing-pages`
- `npm run analyze:bundle`
- `npm run audit:performance`
- `npm run audit:runtime -- http://127.0.0.1:4173`
