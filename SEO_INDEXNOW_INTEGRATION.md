# Integration IndexNow controlee

Date : 2026-07-11  
Etat initial : `5a855e1`  
Domaine : `https://verdanza.fr`  
Sitemap actuel : 25 URL publiques indexables

## Etat initial

Avant integration :
- branche courante : `main` ;
- commit de reference present : `5a855e1` ;
- aucune integration IndexNow existante ;
- aucune soumission automatique dans `build`, `prerender` ou `sitemap` ;
- les fichiers non suivis preexistants sont restes hors perimetre.

## Architecture retenue

L'integration est volontairement manuelle et controlee :
- configuration centrale dans `scripts/indexNowConfig.ts` ;
- validation et soumission dans `scripts/indexNowCore.ts` ;
- CLI dans `scripts/submitIndexNow.ts` ;
- verification production dans `scripts/verifyIndexNow.ts` ;
- audit local dans `scripts/auditIndexNow.ts` ;
- tests sans API reelle dans `scripts/testIndexNow.ts`.

Le build ne soumet rien a IndexNow. Le sitemap reste la source reguliere de decouverte ; IndexNow sert uniquement a notifier un changement significatif.

## Cle IndexNow

Cle creee : `bb8a90d1...63258d36`  
Format : 64 caracteres hexadecimaux  
Fichier public : `public/bb8a90d117269057375f535f579afe04bcdde0229d8705bef738522c63258d36.txt`  
URL apres deploiement : `https://verdanza.fr/bb8a90d117269057375f535f579afe04bcdde0229d8705bef738522c63258d36.txt`

La cle IndexNow est publique par nature car le fichier doit etre accessible par les moteurs. Elle n'est pas issue de Google Search Console, Firebase, Vercel ou GitHub.

## Commandes npm

Audit local :

```bash
npm run audit:indexnow
```

Tests sans requete officielle :

```bash
npm run test:indexnow
```

Simulation :

```bash
npm run indexnow -- --all-indexable --dry-run
```

Verification apres deploiement :

```bash
npm run indexnow:verify
```

Soumission reelle :

```bash
npm run indexnow -- --url https://verdanza.fr/produits/golden-static
```

## Fonctionnement des options

`--url` soumet une URL publique existante et indexable. Elle doit appartenir au sitemap courant.

```bash
npm run indexnow -- --url https://verdanza.fr/produits/golden-static
```

Plusieurs `--url` peuvent etre fournis :

```bash
npm run indexnow -- \
  --url https://verdanza.fr/fleurs-cbd \
  --url https://verdanza.fr/produits/golden-static
```

`--all-indexable` reutilise `sitemapUrls()` depuis `scripts/seoRoutes.ts`. Aucune deuxieme liste manuelle des 25 URL n'est maintenue.

```bash
npm run indexnow -- --all-indexable
```

`--deleted` sert a signaler une ancienne URL supprimee, redirigee, 404 ou 410. Elle doit toujours appartenir a `verdanza.fr`, mais elle n'a pas besoin d'etre dans le sitemap.

```bash
npm run indexnow -- --deleted https://verdanza.fr/produits/ancien-produit
```

`--dry-run` affiche le lot normalise sans requete externe :

```bash
npm run indexnow -- --all-indexable --dry-run
```

## Validations d'URL

Le script accepte uniquement :
- URL absolues ;
- protocole `https` ;
- hote exact `verdanza.fr` ;
- URL publiques et indexables pour `--url` ;
- anciennes URL de `verdanza.fr` pour `--deleted`.

Le script normalise :
- suppression des fragments ;
- suppression des query strings ;
- suppression des slashs finaux hors racine ;
- deduplication.

Le script refuse :
- autre domaine ;
- `http` ;
- identifiants dans l'URL ;
- marqueurs sensibles comme token, secret, apiKey, session, firebase ;
- routes admin ;
- routes compte ;
- panier ;
- checkout ;
- connexion et inscription ;
- fallback et routes de test ;
- lots de plus de 10 000 URL.

## Reponses HTTP IndexNow

Codes geres :
- `200` : soumission recue ;
- `202` : soumission recue, validation de cle en attente ;
- `400` : format invalide ;
- `403` : cle absente, invalide ou inaccessible ;
- `422` : URL ou host non conforme ;
- `429` : trop de requetes ;
- autres `4xx` / `5xx` : erreur documentee.

Un `200` ou `202` n'est jamais une garantie d'indexation.

## Procedures Verdanza

Nouveau produit disponible :

```bash
npm run indexnow -- \
  --url https://verdanza.fr/boutique \
  --url https://verdanza.fr/fleurs-cbd \
  --url https://verdanza.fr/produits/nouveau-produit
```

Modification importante d'un produit :

```bash
npm run indexnow -- \
  --url https://verdanza.fr/produits/golden-static
```

Changement prix ou disponibilite :

```bash
npm run indexnow -- \
  --url https://verdanza.fr/produits/golden-static
```

Suppression d'un produit :

```bash
npm run indexnow -- \
  --deleted https://verdanza.fr/produits/ancien-produit
```

Premiere soumission apres deploiement de cette integration :

```bash
npm run indexnow:verify
npm run indexnow -- --all-indexable
```

Cette premiere soumission globale est justifiee par la refonte SEO recente. Ensuite, cibler uniquement les URL modifiees.

## Rotation de cle

1. Generer une nouvelle cle forte.
2. Mettre a jour `scripts/indexNowConfig.ts`.
3. Supprimer l'ancien fichier `public/{ancienne-cle}.txt`.
4. Ajouter `public/{nouvelle-cle}.txt`.
5. Lancer `npm run build`.
6. Lancer `npm run audit:indexnow`.
7. Deployer.
8. Lancer `npm run indexnow:verify`.

## Sitemap vs IndexNow

Le sitemap reste le registre public des URL indexables. Il est stable, consultable par les moteurs et soumis dans Google Search Console / Bing Webmaster Tools.

IndexNow est une notification active. Il sert a signaler rapidement un changement, mais ne remplace ni le sitemap, ni le crawl, ni les decisions d'indexation des moteurs.

## Controle Bing Webmaster Tools

Apres deploiement et premiere soumission :
- verifier que `https://verdanza.fr/sitemap.xml` reste accepte ;
- verifier l'etat des soumissions IndexNow si l'interface les expose ;
- surveiller les erreurs de cle ou d'URL ;
- ne pas relancer une soumission globale si aucune page n'a change.

## Resultats locaux

Commandes executees :
- `npm run sitemap` : 25 URL.
- `npm run lint` : OK.
- `npm run build` : OK, 50 HTML prerendered.
- `npm run typecheck:api` : OK.
- `npm run audit:prerender` : OK.
- `npm run audit:structured-data` : OK.
- `npm run audit:indexnow` : OK.
- `npm run test:indexnow` : OK.
- `npm run indexnow -- --all-indexable --dry-run` : OK, 25 URL, aucune requete externe.

## URL prevues pour la premiere soumission

- `https://verdanza.fr/`
- `https://verdanza.fr/boutique`
- `https://verdanza.fr/fleurs-cbd`
- `https://verdanza.fr/resines-cbd`
- `https://verdanza.fr/livraison-express-aix`
- `https://verdanza.fr/livraison-postale`
- `https://verdanza.fr/qualite-conformite`
- `https://verdanza.fr/a-propos`
- `https://verdanza.fr/faq`
- `https://verdanza.fr/contact`
- `https://verdanza.fr/mentions-legales`
- `https://verdanza.fr/cgv`
- `https://verdanza.fr/confidentialite`
- `https://verdanza.fr/retours`
- `https://verdanza.fr/produits/golden-static`
- `https://verdanza.fr/produits/supreme-purple-cbd`
- `https://verdanza.fr/produits/cookie-kush-indoor`
- `https://verdanza.fr/produits/petites-tetes-og-kush`
- `https://verdanza.fr/produits/harlequin-greenhouse`
- `https://verdanza.fr/produits/la-mousse`
- `https://verdanza.fr/produits/mango-haze-cbd`
- `https://verdanza.fr/produits/mandarine-cbd`
- `https://verdanza.fr/produits/amnesia-cbd-hydroponique`
- `https://verdanza.fr/produits/blue-dream-cbd`
- `https://verdanza.fr/produits/plutonium-cbd-hydroponique`

## Limites et future automatisation

Cette phase ne connecte pas IndexNow aux modifications Admin ou Firestore. Une automatisation future pourra etre etudiee quand le workflow editorial sera stabilise, par exemple apres validation admin d'une fiche produit, changement de prix, changement de disponibilite ou publication d'un article.

Cette automatisation devra rester anti-spam, regrouper les URL utiles et ne jamais soumettre automatiquement a chaque redeploiement technique.
