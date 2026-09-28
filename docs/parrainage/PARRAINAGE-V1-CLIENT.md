# Expérience client Parrainage V1

Le programme reste OFF par absence de configuration. Ce lot ne définit aucune variable, aucun secret et aucun flag sur Vercel. Aucune migration V5, réconciliation, donnée Production ou infrastructure Firebase n'est exécutée.

## Ouvertures distinctes

`VITE_REFERRAL_DISPLAY_ENABLED` autorise uniquement l'affichage dans `/avantages`, le compte et la route d'invitation. `VITE_REFERRAL_CHECKOUT_DISPLAY_ENABLED` autorise uniquement le panneau du checkout manuel. Seule la chaîne exacte `"true"` ouvre chacun de ces flags. Leur absence conserve les écrans actuels, sans requête ni token Referral. Le wrapper Stripe Test impose `referralEnabled: false` et refuse les requêtes contenant `referralUse`.

Le runtime serveur reste une garde indépendante : `off` refuse avant Auth/Firestore/keyring ; `drain` permet le GET propriétaire ; les actions de création restent réservées à `active` opérationnel. Les flags UI n'ouvrent aucune capacité serveur.

## Lecture propriétaire

GET `/api/referral` renvoie `referral-self-v1` : code existant ou null, relation minimale du propriétaire et `sponsorSummary` agrégé. Les mappings propriétaire/code sont validés strictement. Un parrain devenu inéligible ne reçoit pas son code. La lecture ne génère jamais de code. Les relations sont validées avec le contrat serveur existant ; la requête par sponsor lit au maximum 101 documents et refuse au-delà de 100, sans totaux partiels.

Les compteurs pending/rewarded représentent des récompenses nominales historiques (10 € chacune), pas un solde disponible. Le panneau précise que seul le wallet, après régularisation, définit le montant utilisable. Aucun UID tiers, nom, email, commande ou claim HMAC ne figure dans la projection.

## Invitations

`/parrainage/:code` est protégé par `AccountAuthGate`, noindex et absent du sitemap. Cette route est exclue de l'analytics pour éviter de transmettre le code dans une page view. La connexion conserve pathname, query et fragment pour revenir à l'invitation. Aucun cookie, stockage local d'attribution ou association automatique. Le bouton « Associer cette invitation à mon compte » est le seul déclencheur de POST link. Dans le compte, « Créer mon lien de parrainage » est le seul déclencheur de ensure_code. Le lien partageable utilise l'origine courante ; le texte reste sélectionnable si le presse-papiers échoue.

## Checkout et consentement

Le panneau n'apparaît que derrière le flag checkout et pour un client authentifié. « Vérifier mon avantage parrainage » demande un devis serveur avec `referralUse.requested: true` et le token Firebase courant. Le client affiche les centimes renvoyés ; il ne calcule ni remise, ni seuil, ni fidélité, ni allocation.

« Appliquer les 5 € » mémorise exactement quoteVersion, quoteFingerprint, acceptedReferralDiscountCents et acceptedPayableCents. Ces faits sont conservés seulement en mémoire. Toute modification du panier, format, quantité, adresse, livraison, code promo ou cadeau invalide l'acceptation. Avant création, un nouveau devis est obligatoire : un changement impose une nouvelle acceptation et empêche la commande. Une réponse non appliquée ou une panne n'entraîne jamais de fallback silencieux au plein tarif ; continuer sans parrainage exige une action explicite.

Un conflit `REFERRAL_CAGNOTTE_CONFLICT` conserve les choix existants et bloque la commande. Le client choisit soit le parrainage sans wallet (effacement explicite de la préférence, nouveau devis avec requestedCents=0 puis nouvelle acceptation), soit son wallet (demande Referral désactivée, nouveau devis wallet). Le montant Referral accepté a sa propre ligne, distincte d'une promotion ou d'un financement cagnotte. La réponse de création et le résumé succès n'exposent que `referralUse.discountCents`, si un snapshot existe.

Les tentatives incertaines réutilisent le mécanisme existant : requête gelée, identifiant et acceptation identiques au retry. Les réponses tardives après changement de contexte/identité sont ignorées.

## Validation

`npm run test:referral-backend` conserve les invariants métier et ajoute la projection sur émulateur. `npm run test:referral-client` exécute les contrats services/consentement et les scénarios de rendu Playwright, avec dépendances synthétiques et trafic externe refusé. Les scénarios couvrent flags OFF, connexion/retour au lien, clics explicites, presse-papiers, erreurs, devis modifié et les deux choix wallet. La suite et son typecheck sont intégrés à `verify`, donc réellement exécutés en CI. Les autres suites cagnotte, commandes, comptabilité, GA4 et isolation Stripe restent exigées.
