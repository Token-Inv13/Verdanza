# Analytics GA4 dans l'administration

Cette section utilise Google Analytics Data API depuis le serveur uniquement.
Aucun identifiant Google n'est envoye au navigateur.

## Variables Vercel

- `GA4_PROPERTY_ID` : identifiant numerique de la propriete GA4, pas le Measurement ID `G-...`.
- `GOOGLE_CLIENT_EMAIL` et `GOOGLE_PRIVATE_KEY` : identifiants de compte de service.
- Alternative : `GOOGLE_SERVICE_ACCOUNT_JSON` ou `GOOGLE_SERVICE_ACCOUNT_BASE64`.

## Configuration Google

1. Ouvrir ou creer un projet Google Cloud.
2. Activer Google Analytics Data API.
3. Creer un compte de service ou reutiliser une identite de service dediee.
4. Dans Google Analytics, ajouter cette identite sur la propriete GA4 avec le role Viewer.
5. Recuperer le Property ID numerique dans Admin GA4 > Details de la propriete.
6. Ajouter les variables dans Vercel Production, Preview si necessaire.
7. Redeployer l'application.

## Notes de securite

- L'API est protegee par l'authentification Admin existante.
- Les rapports sont agreges et en lecture seule.
- Les routes `/admin` et les domaines `vercel.app` sont exclus des rapports standards.
- Les rapports standards sont caches environ 12 minutes.
- Le temps reel utilise un cache court d'environ 60 secondes.
