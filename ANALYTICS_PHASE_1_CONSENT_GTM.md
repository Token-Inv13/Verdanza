# Phase 1 Analytics - Consentement, GTM et GA4

Date : 2026-07-12  
Branche : `main`  
État initial : `aa1b5de seo: launch blog with two pillar guides`

## État initial

- Le projet avait une couche `src/lib/analytics.ts` minimale qui poussait directement des événements dans `dataLayer`.
- `CheckoutSuccessPage` envoyait un événement client `purchase` dès l'arrivée sur la page de succès.
- Aucun consentement préalable ne contrôlait Google Tag Manager ou Google Analytics.
- Le sitemap contenait 28 URLs et le pré-rendu comptait 53 fichiers HTML.
- Les fichiers non suivis existants sont restés hors périmètre.

## Identifiants publics

- Google Tag Manager : `GTM-W76PFW2X`.
- Google Analytics 4 : `G-E9XNP7BJ2Y`.
- Variables ajoutées dans `.env.example` :
  - `VITE_GTM_ID=GTM-W76PFW2X`
  - `VITE_GA4_MEASUREMENT_ID=G-E9XNP7BJ2Y`
- Variables ajoutées dans Vercel Production et Preview.
- Aucun secret GA4 API n'a été créé.

## Architecture

- `src/lib/consent.ts` : lecture, écriture et retrait des cookies Analytics propriétaires.
- `src/lib/googleTagManager.ts` : `dataLayer`, shim `gtag`, consent mode par défaut, injection GTM idempotente.
- `src/context/ConsentContext.tsx` : état de consentement versionné.
- `src/components/CookieConsentBanner.tsx` : bannière après validation de l'âge.
- `src/components/CookiePreferencesDialog.tsx` : panneau de préférences et retrait.
- `src/components/AnalyticsRouteTracker.tsx` : suivi SPA après consentement.
- `src/lib/analytics.ts` : helpers GA4 typés, sans file d'attente avant acceptation.
- `scripts/auditAnalytics.ts` : audit statique et runtime Playwright.

## Comportements

Avant choix :
- aucun chargement GTM ;
- aucune requête Google Analytics ;
- aucun cookie `_ga` ;
- `dataLayer` et `gtag` initialisés localement avec `analytics_storage: denied`.

Après refus :
- consentement stocké avec `analytics: false` ;
- aucun événement Analytics envoyé ;
- panier, favoris, connexion, commande et blog restent utilisables.

Après acceptation :
- consentement stocké avec `analytics: true` ;
- `analytics_storage: granted` ;
- `ad_storage`, `ad_user_data` et `ad_personalization` restent `denied` ;
- un seul script `https://www.googletagmanager.com/gtm.js?id=GTM-W76PFW2X` est injecté.

Après retrait :
- `analytics_storage` repasse à `denied` ;
- les nouveaux événements sont bloqués immédiatement ;
- les cookies `_ga` et `_ga_*` du domaine courant sont supprimés lorsque le navigateur l'autorise ;
- aucun rechargement automatique n'est imposé.

## Événements intégrés

- `page_view` : navigation SPA après consentement.
- `view_item_list` : accueil, boutique, fleurs CBD, résines CBD.
- `select_item` : ouverture d'une fiche depuis une carte produit.
- `view_item` : consultation d'une fiche produit.
- `add_to_cart` : ajout réel au panier.
- `remove_from_cart` : retrait d'une quantité ou suppression de ligne.
- `view_cart` : ouverture du panier non vide.
- `add_to_wishlist` : ajout réel aux favoris.
- `begin_checkout` : arrivée sur `/checkout` avec panier non vide.
- `add_shipping_info` : mode de livraison sélectionné ou confirmé.
- `delivery_method_selected` : méthode de livraison contrôlée.
- `local_delivery_zone_selected` : zone locale publique sélectionnée.
- `add_payment_info` : mode de règlement souhaité sélectionné.
- `order_submitted` : réponse OK de `/api/create-order`.
- `login` et `sign_up` : succès réel d'authentification.
- `contact_click` : email ou formulaire, sans coordonnée.
- `blog_article_view` : consultation d'article.
- `blog_read_progress` : seuils 25 %, 50 %, 75 %, 90 %.

## Paramètres et PII

Les items GA4 contiennent seulement :
- `item_id`, `item_name`, `item_category`, `item_variant`, `price`, `quantity`.

Les événements avec montant contiennent :
- `currency: EUR`, `value`, `items`.

Les événements de commande contiennent :
- `transaction_id`, `currency`, `value`, `coupon`, `shipping_tier`, `payment_method`, `items`.

Ne sont pas envoyés :
- email ;
- téléphone ;
- nom ;
- adresse ;
- message client ;
- UID Firebase ;
- contenu libre de formulaire ;
- données bancaires ;
- marge, coût fournisseur ou stock interne détaillé.

## Purchase

Le faux `purchase` client a été supprimé.  
La commande transmise utilise `order_submitted` après succès de `/api/create-order`, avec déduplication navigateur par `sessionStorage`.

Future phase serveur à prévoir :
- envoyer `purchase` uniquement quand `paymentStatus` passe réellement à `paid` ;
- utiliser GA4 Measurement Protocol ;
- stocker `GA4_API_SECRET` uniquement côté Vercel serveur ;
- dédupliquer durablement dans Firestore ;
- ne pas envoyer d'achat si le client n'avait pas autorisé Analytics.

## Audits et tests

Commandes validées :
- `npm run images:generate` : OK.
- `npm run audit:images` : OK.
- `npm run sitemap` : OK, 28 URLs.
- `npm run lint` : OK.
- `npm run build` : OK, 53 fichiers HTML pré-rendus.
- `npm run typecheck:api` : OK.
- `npm run audit:prerender` : OK.
- `npm run audit:structured-data` : OK.
- `npm run audit:indexnow` : OK.
- `npm run audit:seo-landing-pages` : OK.
- `npm run audit:blog` : OK.
- `npm run analyze:bundle` : OK.
- `npm run audit:performance` : OK.
- `npm run audit:analytics` : OK.
- `npm run audit:runtime -- http://127.0.0.1:4173` : OK.

Tests réseau et cookies via `audit:analytics` :
- session vierge : AgeGate visible, aucune requête Google, aucun cookie `_ga`.
- après âge mais avant choix : bannière visible, aucune requête Google.
- après refus : aucune requête Google, aucun cookie `_ga`, panier fonctionnel.
- après acceptation : un seul script GTM, consentement Analytics enregistré, événement autorisé.
- après retrait : cookies Analytics supprimés lorsque possible, nouveaux événements bloqués, site utilisable.

Smoke visuel :
- mobile 390 px : OK.
- desktop 1280 px : OK.
- AgeGate, bannière, préférences, refus, acceptation, retrait : OK.
- absence d'overflow horizontal sur le panneau vérifié.

## Procédure Tag Assistant

Ne pas publier le conteneur GTM avant contrôle manuel.

1. Ouvrir Google Tag Manager.
2. Ouvrir le conteneur `GTM-W76PFW2X`.
3. Cliquer sur `Prévisualiser`.
4. Saisir `https://verdanza.fr`.
5. Sur le site, valider l'âge.
6. Vérifier qu'avant acceptation aucun tag Google ne se déclenche.
7. Cliquer `Tout refuser` et vérifier qu'aucune balise GA4 ne part.
8. Rouvrir `Gérer mes cookies`, cliquer `Tout accepter`.
9. Vérifier le chargement du conteneur et de la balise `Balise Google - GA4 Verdanza`.
10. Naviguer vers boutique, fiche produit, ajout panier, panier, checkout et blog.
11. Vérifier les événements dans Tag Assistant : `view_item_list`, `select_item`, `view_item`, `add_to_cart`, `view_cart`, `begin_checkout`, `blog_article_view`.
12. Rouvrir `Gérer mes cookies`, refuser, puis vérifier que les nouveaux événements ne partent plus.

## Limites

- Aucune vérification dans l'interface GA4 n'est automatisée.
- Aucun événement serveur `purchase` n'est implémenté dans cette phase.
- Le conteneur GTM doit rester non publié tant que le contrôle manuel Tag Assistant n'est pas terminé.
- La section confidentialité décrit l'état technique et ne remplace pas une validation juridique définitive.
