# Alignement des harnais d'audit sur la Production

Date : 2 août 2026
Branche : `main`
Production : `https://verdanza.fr`
Commit de départ : `e35fc5d8d2031ff44a7ebc6f5a7ec1b05670e91c`
Déploiement de départ : `dpl_HKHdXvatpU5gEF9JYkuWZVSyLqNB` (`READY`)

## Conclusion

Les cinq faux négatifs connus ont été supprimés sans modifier le comportement public ou métier de Verdanza. Les contrôles SEO, runtime, images, données structurées, hôtes et IndexNow restent stricts. Aucun appel IndexNow ni aucune demande Search Console n'a été réalisé.

Le sitemap reste inchangé à 38 URL canoniques. Une URL réellement inconnue répond toujours en HTTP 404 en Production. Le manifeste et le favicon répondent en HTTP 200. L'audit runtime final ne relève aucune nouvelle erreur console.

## Causes et corrections

### 1. `audit:images`

**Cause avant correction** : la présence de la hero était recherchée dans le HTML initial, alors que l'AgeGate masque volontairement le contenu de la page d'accueil avant confirmation.

**Correction du harnais** :

- contrôle de l'existence et du poids maximal des variantes optimisées dans `dist` ;
- ouverture du build dans Chromium avec confirmation d'âge locale ;
- contrôle de l'image réellement rendue, de `src`, `srcset`, `sizes`, `fetchpriority`, du chargement, des dimensions déclarées et naturelles ;
- conservation des contrôles existants sur les images sources lourdes, les dimensions et les variantes produit/blog.

### 2. `audit:prerender`

**Cause avant correction** : les documents 404 volontaires étaient soumis aux mêmes exigences de canonical et `og:url` que les pages indexables.

**Correction du harnais** :

- les pages indexables conservent toutes les exigences existantes ;
- les documents de fallback sont servis en HTTP 404 par le harnais prerender et doivent contenir `noindex` ;
- canonical et `og:url` ne sont pas requis sur une 404 volontaire ; leur présence fait désormais échouer le contrôle ;
- une URL synthétique inconnue vérifie également le document `404.html` avec un statut 404.

### 3. `audit:seo`

**Cause avant correction** : Vite Preview applique un fallback SPA et répond 200 aux URL inconnues, contrairement au déploiement Vercel.

**Correction du harnais** :

- ajout d'un serveur statique d'audit qui sert les fichiers pré-rendus et renvoie `404.html` avec HTTP 404 pour une URL véritablement inconnue ;
- ajout d'une URL synthétique inconnue, obligatoirement en HTTP 404 et `noindex` ;
- conservation de toutes les exigences title, description, canonical, robots, Open Graph, Twitter, H1 et sitemap sur les pages indexables ;
- conservation des exigences `noindex`, absence de canonical et absence du sitemap sur les fixtures de fallback.

**Nuance Production constatée** : `/route-introuvable-test` et `/produits/produit-introuvable-test` sont des fichiers pré-rendus enregistrés. Vercel les sert donc en HTTP 200 avec `noindex`, sans canonical. Ils ne sont pas assimilés à une URL inconnue. Une URL réellement inconnue reste exigée en 404. Cette distinction a été vérifiée directement sur `verdanza.fr` et n'a nécessité aucun changement de routage.

### 4. `audit:seo-landing-pages`

**Cause avant correction** : la comparaison littérale de `href` rejetait `/livraison-locale#zones-ouvertes` alors que la destination était correcte.

**Correction du harnais** :

- comparaison de l'origine, du pathname et de la query indépendamment du fragment ;
- lorsque le lien contient un fragment, vérification que l'identifiant ciblé existe dans la page pré-rendue de destination ;
- conservation du contrôle de destination et du maillage interne.

### 5. `test:indexnow`

**Cause avant correction** : le test attendait littéralement `URL count: 25` alors que le sitemap généré contient 38 URL.

**Correction du harnais** :

- lecture dynamique des URL du sitemap généré ;
- vérification du nombre calculé ;
- égalité exacte, dans le même ordre, entre les URL du sitemap et le lot qui serait soumis ;
- maintien du dry-run et vérification qu'aucune requête réseau n'est effectuée.

## Preuve que les contrôles restent stricts

Trois mutations temporaires ont été injectées uniquement dans la copie de validation puis intégralement restaurées :

| Régression simulée | Résultat attendu | Résultat observé |
| --- | --- | --- |
| Variante hero optimisée absente | `audit:images` échoue | Échec confirmé, code 1 |
| Canonical absent sur `/fleurs-cbd` | `audit:prerender` échoue | Échec confirmé, code 1 |
| Fragment interne inexistant depuis `/livraison` | `audit:seo-landing-pages` échoue | Échec confirmé, code 1 |

Les assertions du test IndexNow comparent la liste complète du sitemap au lot de soumission simulé, et le test dry-run confirme qu'aucun appel réseau n'est réalisé. L'audit SEO exige séparément qu'une URL synthétique inconnue réponde 404 avec `noindex`.

## Résultats avant et après

| Harnais | Avant | Après |
| --- | --- | --- |
| `audit:images` | Échec : hero absente du HTML initial derrière l'AgeGate | Réussi : hero contrôlée dans le build et au runtime après confirmation d'âge |
| `audit:prerender` | Échec : canonical et `og:url` absents des 404 | Réussi : 404 + `noindex`, sans exigence de canonical/`og:url` |
| `audit:seo` | Échec : serveur SPA local en 200 sur URL inconnue | Réussi : URL inconnue en 404 + `noindex` |
| `audit:seo-landing-pages` | Échec : lien avec `#zones-ouvertes` rejeté | Réussi : pathname accepté et fragment cible vérifié |
| `test:indexnow` | Échec : nombre 25 codé en dur | Réussi : 38 URL calculées et liste exacte vérifiée |

## Commandes exécutées

Toutes les commandes demandées ont réussi sur une copie Git propre contenant uniquement les modifications de la mission :

- `npm run lint`
- `npm run build` — 38 URL dans le sitemap, 66 fichiers HTML pré-rendus
- `npm run typecheck:api`
- `npm run audit:images`
- `npm run audit:prerender`
- `npm run audit:seo`
- `npm run audit:seo-landing-pages`
- `npm run test:indexnow`
- `npm run audit:indexnow`
- `npm run audit:runtime`
- `npm run audit:structured-data`
- `npm run audit:seo-hosts`
- `npm run audit:performance`

Contrôles supplémentaires contre la Production :

- `npm run audit:seo -- https://verdanza.fr` : réussi ;
- `npm run audit:runtime -- https://verdanza.fr` : réussi ;
- URL réellement inconnue : HTTP 404 ;
- sitemap : 38 URL ;
- `manifest.webmanifest` : HTTP 200 ;
- `favicon.ico` : HTTP 200.

## Git et déploiements

Commit principal :

- `4858c62c741f923dae07126cec666cdc4ae3f0f5` — `test: align audit harnesses with production behavior`
- déploiement : `dpl_7QvzsukoT4XvzCdwKSC3AhuPJtj7` — `READY`

Commit de précision après confrontation au statut HTTP réel des deux fixtures pré-rendues :

- `03e4546d1099900e65d694a8500e72d9c5e18de0` — `test: distinguish prerender fixtures from unknown routes`
- déploiement final : `dpl_GCXZNSFtLTgSa4GZ3aMTYPvoUDqQ` — `READY`

## Périmètre préservé

Aucun composant React, route applicative, canonical réel, AgeGate, commande, stock, configuration Firebase, Analytics, donnée métier ou logique publique n'a été modifié. Les fichiers locaux préexistants hors mission ont été exclus des commits. Aucun appel IndexNow réel et aucune action Search Console n'ont été déclenchés.
