# Sécurisation des soumissions publiques Verdanza

Date : 1er août 2026  
Périmètre : `POST /api/create-order` et `POST /api/contact`

## État initial contrôlé

- Branche : `main`.
- Commit local et distant : `3a6c72cd4ed53340f008eba68f1388ebc728f680`.
- Déploiement Production initial : `dpl_APh3SiBK7NMDzf1V5P7VN9k1E8Pv`, état `READY`.
- Des modifications et fichiers non suivis préexistaient hors périmètre. Ils ont été conservés et exclus du commit de sécurité.
- `/api/create-order` protégeait déjà la création métier par `checkoutRequestId`, empreinte de payload, transaction Firestore et outbox, mais ne limitait pas le nombre de nouvelles tentatives publiques.
- `/api/contact` possédait déjà un honeypot, mais aucune limitation durable par réseau ou e-mail.

## Architecture mise en place

La protection applicative est centralisée dans `api/_server/publicRateLimit.ts`.

- Stockage durable : collection Firestore `securityRateLimits`.
- Mise à jour atomique de tous les compteurs applicables dans une transaction Firestore unique.
- Identifiants de documents : HMAC-SHA-256 calculé côté serveur avec `RATE_LIMIT_HMAC_SECRET`.
- Signaux combinés quand ils sont disponibles :
  - adresse IP réseau fiable fournie par `x-forwarded-for` sur Vercel ;
  - e-mail normalisé (`NFKC`, espaces retirés, minuscules) ;
  - UUID anonyme stable généré dans le navigateur ;
  - UUID `checkoutRequestId` utilisé pour dédupliquer le comptage d'une même tentative de commande.
- Hors Vercel, un `x-forwarded-for` fourni par le client n'est pas considéré comme fiable ; l'adresse de la socket locale est utilisée pour les tests.
- Les IP, e-mails, UUID navigateur et `checkoutRequestId` ne sont jamais stockés en clair.
- Les métadonnées anti-abus ne sont ni incluses dans l'empreinte commerciale, ni persistées dans la commande.

La protection applicative a été préférée à une règle WAF comme mécanisme principal : le WAF ne peut pas préserver l'idempotence métier ni appliquer les quotas HMAC par e-mail. La protection DDoS native Vercel reste inchangée et aucune règle WAF n'a été publiée.

## Seuils centralisés

Les seuils sont centralisés dans `publicRateLimitRules`.

| Route | Signal | Fenêtre | Maximum |
| --- | --- | ---: | ---: |
| `/api/create-order` | Réseau | 10 minutes | 5 |
| `/api/create-order` | Réseau | 24 heures | 20 |
| `/api/create-order` | E-mail | 30 minutes | 3 |
| `/api/create-order` | E-mail | 24 heures | 8 |
| `/api/create-order` | Navigateur anonyme | 30 minutes | 4 |
| `/api/create-order` | Navigateur anonyme | 24 heures | 10 |
| `/api/contact` | Réseau | 15 minutes | 6 |
| `/api/contact` | Réseau | 24 heures | 20 |
| `/api/contact` | E-mail | 1 heure | 3 |
| `/api/contact` | E-mail | 24 heures | 6 |
| `/api/contact` | Navigateur anonyme | 1 heure | 4 |
| `/api/contact` | Navigateur anonyme | 24 heures | 8 |

Les quotas réseau sont volontairement plus larges que les quotas e-mail pour ne pas pénaliser trop vite un foyer ou un réseau partagé.

## Données Firestore et expiration

Chaque document de compteur contient uniquement : type synthétique, route, type de signal, identifiant de fenêtre, bornes temporelles, compteur, date de mise à jour et champ TTL `expiresAt`. Un document de tentative de checkout contient uniquement un HMAC de l'empreinte commerciale et les dates techniques.

- Aucune IP, adresse e-mail, téléphone, nom, adresse postale, message, contenu de panier, UUID brut ou secret n'est enregistré dans cette collection.
- Les règles Firestore refusent explicitement toute lecture ou écriture client sur `securityRateLimits`.
- Les documents expirent via le champ `expiresAt` ; les compteurs sont conservés 48 heures après la fin de leur fenêtre et les réservations de tentative 48 heures.
- Le nombre de documents reste borné par les fenêtres fixes et leur suppression TTL.
- La politique TTL Firestore `securityRateLimits.expiresAt` a été créée avec un décalage de 0 seconde. Son état de console est passé de `Création` à `Diffusion` pendant la publication ; la suppression physique reste asynchrone selon le fonctionnement de Firestore TTL.
- La règle explicite interdisant tout accès client à `securityRateLimits` a compilé puis a été publiée avec succès sur le projet `verdanza-1f621`.

## Ordre d'exécution et idempotence des commandes

L'ordre est désormais le suivant :

1. validation et normalisation du `checkoutRequestId` ;
2. calcul de l'empreinte commerciale ;
3. recherche de la réservation de commande existante ;
4. retour de la commande existante pour une même clé et un même payload, même si les quotas sont désormais atteints ;
5. conservation du conflit HTTP 409 pour une même clé avec un payload différent ;
6. contrôle honeypot et durée minimale ;
7. transaction atomique du limiteur uniquement pour une nouvelle tentative ;
8. pricing serveur, authentification facultative, transaction de stock/promotion/commande et effets secondaires existants.

La réservation HMAC de la tentative dans le limiteur empêche deux requêtes concurrentes portant le même `checkoutRequestId` d'être comptées deux fois. La transaction de commande existante reste l'autorité finale : une seule commande, un seul mouvement de stock, un seul comptage de promotion et une seule outbox.

## Blocage, UX et panne du limiteur

- Dépassement : HTTP `429`, en-tête `Retry-After`, code synthétique `public_submission_rate_limited` et message générique invitant à patienter.
- Aucun pricing, écriture de commande, mouvement de stock, facture, e-mail, SMS, WhatsApp ou événement Analytics n'est déclenché après un blocage.
- Le panier et le `checkoutRequestId` restent présents dans le navigateur ; l'utilisateur peut réessayer plus tard.
- Honeypot contact : réponse neutre existante conservée, sans e-mail.
- Honeypot checkout et soumission manifestement trop rapide : blocage générique sans CAPTCHA visible.
- Si la configuration HMAC est absente ou si le stockage du limiteur est indisponible, le limiteur adopte le mode fail-open afin de ne pas rendre la boutique inutilisable. Un log synthétique `rate_limit_error` est produit ; les contrôles métier restent actifs.

## Journalisation

Seuls les événements synthétiques suivants sont émis par le limiteur :

- `rate_limit_allowed` ;
- `rate_limit_blocked` ;
- `rate_limit_error`.

Le payload contient la route, les fenêtres concernées, un code synthétique, la seule présence ou absence d'authentification et un horodatage. Il ne contient aucun identifiant brut, aucune empreinte complète, aucune donnée client et aucune exception fournisseur.

## Vérifications automatisées

- `npm run lint` : réussi.
- `npm run build` : réussi, 38 URL dans le sitemap et 66 pages prérendues.
- `npm run typecheck:api` : réussi.
- `npm run test:public-rate-limits` : 27/27 réussis.
- `npm run test:order-reliability` : 12/12 réussis.
- `npm run test:catalog` : 12/12 réussis.
- `npm run test:checkout-payment-options` : réussi.
- `npm run test:fixed-price-formats` : 19/19 réussis.
- `npm run test:promotions` : réussi.
- `npm run test:customer-invoices` : réussi.
- `npm run test:admin-archives` : réussi.
- `npm run test:api-import` : réussi.
- `npm run audit:runtime` : réussi.
- `npm run audit:analytics` : réussi.
- `npm run audit:analytics-purchase` : réussi.

Les 27 scénarios dédiés couvrent notamment la concurrence, les limites réseau/e-mail/navigateur, les réseaux partagés, la normalisation d'e-mail, les fenêtres, le retry idempotent après saturation, le conflit de payload, l'absence d'écriture sur blocage, les deux modes fail-open, les honeypots, le délai minimal, le `Retry-After`, les règles Firestore et l'absence de PII brute dans les documents et logs.

## Vérification navigateur locale

- Formulaire de contact : présent, honeypot masqué, bouton utilisable, aucune largeur hors écran en affichage bureau ou mobile.
- Checkout invité : panier local conservé, message confirmant que la commande sans compte reste disponible, formulaire et honeypot présents, aucune largeur hors écran.
- Le cas `429` est validé par test automatisé de la réponse et du message UI ; l'intégration navigateur ne permet pas d'intercepter ce POST sans appel serveur. Aucun POST de commande ou contact n'a donc été envoyé.
- Le chemin connecté est couvert par le code existant : token Firebase uniquement si un utilisateur est présent et préremplissage du profil sans changement. Aucune connexion Google n'a été effectuée pendant cette validation afin de ne transmettre aucune identité.
- Une alerte React de développement préexistante concernant `fetchPriority` a été observée lors du passage par la boutique. Elle ne provient pas de cette modification et n'apparaît pas sur un onglet checkout frais. Aucun défaut console lié au limiteur n'a été observé.

## Production

- Variable serveur ajoutée comme valeur sensible, jamais exposée avec un préfixe `VITE_` : `RATE_LIMIT_HMAC_SECRET`.
- Environnements configurés : Production et Preview. La valeur n'a été ni affichée, ni loggée, ni écrite dans le dépôt.
- Commit prévu : `security: rate limit public order and contact submissions` ; le SHA final est fourni dans le compte-rendu de livraison afin d'éviter une référence circulaire dans le commit lui-même.
- Déploiement Production : l'identifiant final et l'état `READY` sont fournis dans le compte-rendu de livraison après contrôle Vercel.

Aucune commande fictive, aucun événement `purchase`, aucun e-mail, SMS ou WhatsApp de test n'a été envoyé en production.
