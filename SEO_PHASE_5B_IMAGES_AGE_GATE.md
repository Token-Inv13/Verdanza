# Phase 5B performance - images et age gate

## Perimetre

- Routes de reference : `/`, `/boutique`, `/fleurs-cbd`, `/resines-cbd`, `/produits/golden-static`.
- Parcours complementaires verifies : `/panier`, `/compte/favoris`.
- Hors perimetre : blog, PWA, split JavaScript agressif, changement d'URL SEO, changement des donnees structurees produit.

## Changements

- Ajout d'un pipeline `npm run images:generate` base sur `sharp`.
- Ajout d'un manifeste `src/lib/generatedImageVariants.ts` pour conserver les sources originales en fallback.
- Ajout de variantes WebP pour les 11 images produit reellement referencees.
- Ajout de variantes WebP pour le hero, le badge age gate et le logo.
- Raccordement des images optimisees dans les cartes produit, fiches produit, panier, favoris, hero, header, footer et age gate.
- Stabilisation de l'age gate : dimensions d'image explicites, role dialog, scroll body verrouille pendant l'overlay.
- Ajout de `npm run audit:images` pour verifier variantes, budgets, HTML prerendu, absence de chemins Windows et absence d'encodage corrompu.

## Poids image local

Source : `reports/performance/images-latest.json`.

- Images produit source referencees : 1 988 KB.
- Plus grandes variantes carte produit cumulees : 1 070 KB.
- Variantes detail produit cumulees : 1 589 KB.
- Hero : 134 KB source, 25 KB en 768w, 57 KB en 1280w, 100 KB en 1672w.
- Badge age gate : 1 073 KB source, 3 KB en 112w, 7 KB en 224w.
- Logo : 939 KB source, 2 KB en 180w, 5 KB en 320w.

## Mesures production avant deploiement

Source : `.perf/phase5b-lighthouse-before/summary.json`.

| Page | Mobile perf | Mobile LCP | Mobile bytes | Desktop perf | Desktop LCP | Desktop bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | 67 | 15 276 ms | 3 369 KB | 84 | 2 645 ms | 3 234 KB |
| `/boutique` | 54 | 15 680 ms | 4 450 KB | 72 | 2 905 ms | 4 316 KB |
| `/fleurs-cbd` | 59 | 17 121 ms | 4 081 KB | 80 | 2 925 ms | 3 946 KB |
| `/resines-cbd` | 63 | 15 214 ms | 2 830 KB | 83 | 2 911 ms | 2 696 KB |
| `/produits/golden-static` | 66 | 14 858 ms | 2 709 KB | 85 | 2 663 ms | 2 575 KB |

Note : Lighthouse a genere les rapports JSON mais a remonte une erreur Windows `EPERM` au nettoyage de ses profils temporaires.

Source : `.perf/phase5b-production-before/summary.json`.

- Images transferees avant optimisation : 2 264 KB a 4 004 KB selon page.
- Sources lourdes rendues avant optimisation : 2 a 3 par page selon profil.

## Validation locale apres optimisation

- `npm run images:generate` : OK.
- `npm run sitemap` : 25 URL.
- `npm run lint` : OK.
- `npm run build` : OK, 50 HTML prerendus.
- `npm run typecheck:api` : OK.
- `npm run audit:prerender` : OK.
- `npm run audit:structured-data` : OK.
- `npm run audit:indexnow` : OK.
- `npm run audit:seo-landing-pages` : OK.
- `npm run audit:performance` : OK.
- `npm run audit:images` : OK.
- Controle Playwright local 390 px et 1280 px : OK sur 14 combinaisons route/viewport, sans overflow horizontal, sans erreur console, sans image eager cassee, sans source lourde rendue sur les pages publiques verifiees.

## Points preserves

- Les URL publiques et slugs ne changent pas.
- Les donnees structurees produit conservent les images source existantes.
- Le sitemap reste a 25 URL.
- Le prerendu reste a 50 fichiers HTML.
- Les fichiers source de travail volumineux restent presents dans `public/Fiche produit`, mais ne sont pas rendus par les pages publiques auditees.

