# Correction de l’état ARIA du menu mobile

Date : 2 août 2026

Anomalie : `VDZ-AUD-008`

Branche : `main`

## Cause

Le bouton du menu mobile pilotait correctement l’état React et l’affichage visuel du panneau, mais cet état n’était pas exposé aux technologies d’assistance. Le bouton n’avait ni `aria-expanded` ni `aria-controls`, le panneau n’avait pas d’identifiant stable et la touche Échap n’était pas gérée avec restauration du focus.

## Correction ciblée

- ajout de l’identifiant stable `mobile-navigation-menu` au panneau ;
- ajout de `aria-controls="mobile-navigation-menu"` au bouton ;
- ajout de `aria-expanded`, synchronisé avec l’état React réel ;
- libellé explicite et contextuel : `Ouvrir le menu mobile` ou `Fermer le menu mobile` ;
- fermeture par Échap avec restitution du focus au bouton ;
- conservation de la fermeture existante après activation d’un lien ;
- aucun changement de classes, de design, de route ou de contenu.

## Comportement clavier

Le bouton reste activable au clavier selon le comportement natif d’un élément `button`. Lorsque le panneau est ouvert, Échap le ferme et replace le focus sur le bouton. Les liens conservent leur navigation clavier et ferment le panneau après activation.

## Tests automatisés

| Contrôle | Résultat |
| --- | --- |
| `npm run lint` | Réussi |
| `npm run build` | Réussi, sitemap inchangé à 38 URL |
| `npm run typecheck:api` | Réussi |
| `npm run audit:runtime` | Réussi en local |
| `npm run audit:performance` | Réussi |
| Menu fermé : `aria-expanded=false` | Réussi |
| Menu ouvert : `aria-expanded=true` | Réussi |
| `aria-controls` cible un panneau existant | Réussi |
| Échap ferme et restaure le focus | Réussi |
| Activation d’un lien ferme le menu | Réussi |
| Débordement à 390 px | Aucun, `scrollWidth=390`, `clientWidth=390` |
| Erreurs console sur le parcours ciblé | Aucune |

Le harnais runtime global exécuté directement contre la production retrouve séparément une limite préexistante hors périmètre : la route volontairement inconnue `/url-totalement-inconnue-test` répond en 404, puis le harnais signale la ressource 404 et l’absence de canonical sur cette page. Aucun échec du menu mobile n’a été relevé. Le contrôle production ciblé sur la page d’accueil ne produit aucune erreur console.

## Git et production

- commit fonctionnel : `7b047531072cdac7e23647d603b90da541df7ae4` (`fix: expose mobile menu state to assistive technology`) ;
- déploiement Production : `dpl_9ukyK8bLTEKcgpuije4CrvTH19jy` ;
- domaine : `https://verdanza.fr` ;
- état Vercel : `READY` ;
- alias de production appliqués sans erreur.

## Périmètre

Seuls `src/layouts/MainLayout.tsx`, `scripts/auditRuntime.ts` et ce rapport ont été concernés. Les fichiers locaux préexistants hors mission ont été préservés. Firebase Auth, SEO, Analytics, les routes, les contenus et les données métier n’ont pas été modifiés.
