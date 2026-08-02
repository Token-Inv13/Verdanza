# Correction responsive Admin Produits — VDZ-AUD-004

Date : 2 août 2026

Production : <https://verdanza.fr/admin/produits>

Commit applicatif : `598cf88cdad142de42caa6e437f0d02db87494a7`

Déploiement applicatif : `dpl_881giiX6sSLwTSNkyCQcJx3eSaD3`

État Vercel contrôlé : `READY`

## Cause exacte

La table Produits conserve volontairement une largeur minimale de 1 040 px. Son conteneur avait déjà `overflow-x-auto`, mais la grille utilisait une colonne implicite `auto` sur les petits écrans et une seconde piste `1fr` sur desktop. Les deux enfants directs de la grille avaient également la largeur minimale automatique des éléments de grille.

La contribution `min-content` de la table remontait donc jusqu'à sa piste, au parent de grille puis au document. Le scroller interne atteignait 1 040 px au lieu de se réduire à la largeur disponible.

## Correction appliquée

- colonne mobile explicite et réductible avec `grid-cols-1` (`minmax(0, 1fr)` généré par Tailwind) ;
- seconde colonne desktop remplacée par `minmax(0, 1fr)` ;
- `min-w-0` ajouté aux deux éléments directs de la grille : formulaire et catalogue ;
- `overflow-x-auto` et `min-w-[1040px]` conservés sur la table ;
- aucune colonne, police, action ou information masquée ou comprimée.

## Fichiers modifiés

- `src/pages/admin/AdminPage.tsx` : trois contraintes de largeur dans le seul module Produits ;
- `scripts/testAdminProductsResponsive.ts` : contrat source et contrôle Chromium aux trois dimensions ;
- `package.json` : commande `test:admin-products-responsive` ;
- ce rapport d'exécution.

`src/styles/index.css` et les composants Admin partagés n'ont pas nécessité de modification.

## Mesures avant correction — Production

| Fenêtre contrôlée | Largeur document cliente | Largeur document scrollable | Débordement global | Grille Produits | Formulaire | Catalogue / scroller |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 390 × 844 | 375 px | 1 058 px | +683 px | 343 / 1 042 px | 1 042 px | 1 042 / 1 040 px |
| 768 × 900 | 753 px | 1 066 px | +313 px | 705 / 1 042 px | 1 042 px | 1 042 / 1 040 px |
| 1280 × 900 | 1 265 px | 1 778 px | +513 px | 941 / 1 486 px | 420 px | 1 042 / 1 040 px |

Les valeurs séparées par `/` indiquent respectivement la largeur cliente et la largeur scrollable, ou la largeur du conteneur et celle de son contenu selon la colonne.

## Mesures après correction

Le test Chromium automatisé impose les dimensions exactes et vérifie `document.documentElement.scrollWidth <= clientWidth`.

| Viewport Chromium | Document client / scroll | Formulaire | Élément catalogue | Scroller table client / scroll |
| --- | ---: | ---: | ---: | ---: |
| 390 × 844 | 390 / 390 px | 358 px | 358 px | 356 / 1 040 px |
| 768 × 900 | 768 / 768 px | 720 px | 720 px | 718 / 1 040 px |
| 1280 × 900 | 1 280 / 1 280 px | 420 px | 512 px | 510 / 1 040 px |

Contrôle complémentaire sur la Production authentifiée :

| Vue réelle | Document client / scroll | Grille | Formulaire | Catalogue | Scroller table client / scroll |
| --- | ---: | ---: | ---: | ---: | ---: |
| fenêtre compacte Edge | 477 / 477 px | 445 px | 445 px | 445 px | 443 / 1 040 px |
| fenêtre Edge 768 px | 743 / 743 px | 695 px | 695 px | 695 px | 693 / 1 040 px |
| desktop maximisé | 1 897 / 1 897 px | 1 573 px | 420 px | 1 129 px | 1 127 / 1 127 px |

À toutes les largeurs contrôlées, le document n'a plus de débordement horizontal. La table défile dans son propre conteneur lorsque sa largeur minimale dépasse l'espace disponible. Sur desktop large, elle occupe simplement l'espace disponible sans défilement inutile.

## Résultats fonctionnels et accessibilité

- filtres Produits : 15 au total, 13 actifs et 2 inactifs ;
- filtre Inactifs : deux lignes affichées, toutes deux en rupture ;
- filtre Actifs : treize lignes affichées, dont une rupture ;
- module Stocks contrôlé en lecture seule : 12 stock OK, 0 stock bas, 3 ruptures ;
- aucun bouton `Enregistrer`, `Éditer`, indicateur Actif/Mis en avant ou contrôle d'image n'a été masqué ;
- navigation clavier : `Tab` passe de `Tous` à `Actifs` ; l'anneau de focus champagne est visible ;
- console navigateur : aucune erreur ;
- aucune sauvegarde produit, aucun changement de stock et aucune action métier exécutés.

## Tests exécutés

| Commande | Résultat |
| --- | --- |
| `npm run test:admin-products-responsive` | PASS — trois largeurs, aucun overflow global, scroll table interne |
| `npm run lint` | PASS |
| `npm run build` | PASS — 38 URL sitemap, 66 fichiers HTML pré-rendus localement |
| `npm run typecheck:api` | PASS |
| `npm run test:catalog` | PASS — 12 tests |
| `npm run test:admin-archives` | PASS |
| `npm run audit:runtime` | PASS après lancement du preview local attendu sur le port 4173 |
| `npm run audit:performance` | PASS |

La première tentative d'`audit:runtime` a uniquement rencontré `ERR_CONNECTION_REFUSED` parce que le preview n'était pas encore lancé. La relance dans son environnement attendu a réussi.

## Git et déploiement

- base vérifiée avant modification : `64bbfcb0d6340bf6660349b346afb24f86b5fae9` ;
- commit applicatif : `598cf88cdad142de42caa6e437f0d02db87494a7` — `fix: contain admin products responsive layout` ;
- push : `main` vers `origin/main`, sans force push ;
- déploiement Production : `dpl_881giiX6sSLwTSNkyCQcJx3eSaD3` ;
- état final contrôlé par l'API Vercel : `READY` ;
- validation finale effectuée sur `https://verdanza.fr/admin/produits`.

## Intégrité du périmètre

Aucun produit, stock, prix, fichier Firestore, commande, paiement, élément SEO, Analytics ou livraison n'a été modifié. Les fichiers locaux préexistants hors mission ont été conservés et exclus du commit applicatif.
