# Rapport SEO — hôtes canoniques et favicon Verdanza

Date de validation : 1er août 2026  
Production : https://verdanza.fr  
Commit de référence : `c2ac856e938050286984dd343186e0a8658d2c05`  
Commit final : `86797e902dcf60341c0859c1a26828dafa9c4fcc`

## Résultat

Les alias publics stables ne servent plus une copie indexable du site. Ils répondent désormais par une redirection HTTP 308 directe vers `https://verdanza.fr`, en conservant le chemin et les paramètres de requête. Le domaine canonique continue de répondre directement en HTTP 200.

Le favicon est désormais déclaré explicitement dans le HTML initial en ICO et PNG, avec un manifeste minimal valide. Toutes les variantes ont été générées techniquement depuis le badge officiel existant, sans redessiner ni altérer le logo source.

## Cause du résultat Vercel dans Bing

`https://verdanza-opal.vercel.app` était un alias public stable rattaché au même déploiement et répondait en HTTP 200 avec le contenu complet. La balise canonical vers `verdanza.fr` constituait un signal correct, mais elle n'empêchait pas le moteur d'explorer et d'afficher séparément cet alias. La correction principale est donc une redirection serveur permanente, pas un `noindex` ou une règle `robots.txt`.

## Inventaire des domaines

| Hôte | Avant | Après | Décision |
| --- | --- | --- | --- |
| `verdanza.fr` | 200 | 200 | Domaine canonique unique |
| `www.verdanza.fr` | 200 | 308 vers `verdanza.fr` | Alias public canonicalisé |
| `verdanza-cbd.fr` | 200 | 308 vers `verdanza.fr` | Domaine secondaire canonicalisé |
| `www.verdanza-cbd.fr` | 200 | 308 vers `verdanza.fr` | Domaine secondaire canonicalisé |
| `verdanza-opal.vercel.app` | 200 | 308 vers `verdanza.fr` | Alias public Vercel canonicalisé |
| `verdenza.fr` | 308 | 308 vers `verdanza.fr` | Redirection de faute de frappe conservée |
| `www.verdenza.fr` | 308 | 308 vers `verdanza.fr` | Redirection de faute de frappe conservée |
| `verdanza-token-inv13s-projects.vercel.app` | 302 vers authentification Vercel | 302 | Alias technique protégé conservé pour les tests |
| `verdanza-git-main-token-inv13s-projects.vercel.app` | 302 vers authentification Vercel | 302 | Alias de branche protégé conservé |

Aucune règle générique n'a été appliquée aux URL uniques de déploiement Vercel. Les previews techniques restent utilisables et protégées.

## Redirections mises en place

Quatre hôtes publics disposent chacun de deux règles explicites dans `vercel.json` :

- une règle exacte pour `/` ;
- une règle `/:path*` pour les autres chemins.

Cette séparation est nécessaire car le premier déploiement a montré en production que `/:path*` conservait correctement `/boutique`, `/blog` et `?source=test`, mais ne capturait pas la racine `/`. L'audit production a bloqué IndexNow, puis le commit correctif `86797e9` a ajouté les quatre règles racine.

La validation finale couvre, pour les six hôtes redirigés, les chemins `/`, `/boutique`, `/blog` et `/blog?source=test` : les 24 réponses sont des 308 directs avec une seule destination, sans boucle ni double saut.

Le service des bannières normalise aussi les anciennes URL absolues `https://verdanza-opal.vercel.app/...` vers `https://verdanza.fr/...`. Un test empêche leur réintroduction sans modifier les données de promotion.

## Canonicals, sitemap et données structurées

- Le sitemap contient toujours exactement 38 URL, toutes sous `https://verdanza.fr`.
- Aucune URL `vercel.app` n'est présente dans le sitemap ou dans le balisage indexable pré-rendu.
- Les canonicals des pages publiques contrôlées sont absolues et utilisent `https://verdanza.fr`.
- `WebSite` et `OnlineStore` utilisent le domaine canonique et le nom `Verdanza`.
- Le logo JSON-LD reste l'image officielle `https://verdanza.fr/verdanza-logo.png`.
- Les pages privées restent en `noindex,nofollow`.
- `robots.txt`, les données structurées produit et le contenu du sitemap n'ont pas été modifiés.

## Favicon officiel

Source utilisée : `public/verdanza-badge.png`.

- PNG sRGB valide ;
- 1254 × 1254 px ;
- ratio 1:1 ;
- 1 098 904 octets ;
- trois canaux, sans transparence ;
- fichier source inchangé.

Le badge reste reconnaissable à 16 × 16 par sa silhouette circulaire et son symbole central. Les détails fins et le texte ne peuvent pas être lus à cette taille, ce qui est attendu pour l'asset officiel. Le fond blanc opaque protège le rendu sur fond sombre ; sur fond clair, les traits officiels très pâles conservent un contraste limité. Aucun renforcement ou redessin n'a été effectué afin de respecter strictement l'identité existante.

| Fichier | Dimensions/contenu | Poids |
| --- | --- | ---: |
| `favicon.ico` | entrées 16, 32 et 48 px | 5 129 octets |
| `favicon-48x48.png` | 48 × 48 px | 2 957 octets |
| `favicon-96x96.png` | 96 × 96 px | 9 537 octets |
| `favicon-192x192.png` | 192 × 192 px | 34 863 octets |
| `favicon-512x512.png` | 512 × 512 px | 210 372 octets |
| `apple-touch-icon.png` | 180 × 180 px | 31 114 octets |

Les fichiers sont carrés, non déformés et servis en HTTP 200 avec les types MIME attendus. Le générateur déterministe `scripts/generateFavicons.ts` utilise uniquement le badge officiel et fait partie de `npm run images:generate`.

## Manifeste et HTML initial

`public/manifest.webmanifest` est un manifeste JSON minimal valide : nom et nom court `Verdanza`, couleurs de marque existantes, démarrage sur `/`, icônes PNG 192 × 192 et 512 × 512. Il ne constitue pas une refonte PWA.

Le HTML initial déclare :

- `/favicon.ico` ;
- les PNG 48, 96 et 192 px ;
- `/apple-touch-icon.png` en 180 px ;
- `/manifest.webmanifest`.

## Tests exécutés

Résultats verts :

- `npm run images:generate` ;
- `npm run sitemap` — 38 URL, nombre inchangé ;
- `npm run lint` ;
- `npm run build` — 65 fichiers HTML pré-rendus dans l'arbre Git isolé ;
- `npm run typecheck:api` ;
- `npm run audit:structured-data` dans l'arbre Git isolé ;
- `npm run audit:performance` ;
- `npm run audit:runtime -- http://127.0.0.1:4173` ;
- audit runtime isolé sur le contenu exact du commit ;
- `npm run audit:seo-hosts` ;
- `npm run audit:seo-hosts -- --production` ;
- `npm run test:promotions`.

Contrôles production inclus dans `audit:seo-hosts` : canonique 200, alias 308, chemins et query strings conservés, canonicals, sitemap, absence de Vercel indexable, fichiers favicon et manifeste, dimensions, MIME, URL inconnue en 404 et `GET /api/create-order` en 405.

Trois échecs préexistants et hors périmètre ont été reproduits dans l'arbre Git isolé :

- `audit:images` exige l'image héro optimisée dans le HTML initial alors que la page la masque volontairement avant confirmation de majorité ;
- `audit:prerender` exige canonical et `og:url` sur les pages de test 404, alors que ces pages `noindex` les omettent ;
- `audit:seo` voit les routes de test inconnues en 200 dans son serveur statique interne, bien que la production renvoie correctement 404.

Ils ne sont pas causés par les redirections ou les favicons et n'ont pas été contournés par une modification hors périmètre. Les modifications locales préexistantes du dossier de travail ont également été exclues de tous les commits.

## Commits et déploiement

- `a35630358bed05ceaba7fb4897fe8debc0b75031` — `seo: canonicalize production hosts and strengthen favicon`
- `86797e902dcf60341c0859c1a26828dafa9c4fcc` — `fix: redirect noncanonical host roots`

Les deux commits ont été poussés sur `main` sans force push.

Déploiement Production final :

- ID : `dpl_CnSHixxTZHTGjMkVZKbmNVaJ3ZBP` ;
- SHA : `86797e902dcf60341c0859c1a26828dafa9c4fcc` ;
- statut : `READY` ;
- erreur d'alias : aucune ;
- logs runtime erreur/fatal/warning après validation : aucun événement.

## Notification des moteurs

Une seule notification IndexNow a été envoyée après validation complète :

- URL : `https://verdanza.fr/` ;
- nombre d'URL : 1 ;
- réponse : HTTP 200, soumission reçue ;
- aucun alias Vercel et aucune option `--all-indexable` envoyés.

L'acceptation IndexNow ne garantit pas l'indexation immédiate. L'ancien résultat Bing de l'alias Vercel peut rester visible jusqu'à la prochaine exploration et au retrait progressif de l'ancienne URL.

Étape manuelle restante : demander, si souhaité, une nouvelle indexation de `https://verdanza.fr/` dans Google Search Console. Aucune demande automatique Google n'a été effectuée.
