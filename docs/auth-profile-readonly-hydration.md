# Hydratation Auth et profil client

La restauration d'une session Firebase, les notifications `onAuthStateChanged`,
la navigation admin/compte/checkout/blog et `refreshCustomerProfile()` lisent
uniquement `customers/<uid>` via `getCustomerProfile(uid)`. Un document absent
donne `customerProfile=null` et reste absent. L'autorisation admin repose sur
`adminUsers`, sans création ou synchronisation du profil customer.

`createCustomerProfileIfMissing(user)` est réservé aux intentions explicites :

- inscription email/password, après mise à jour volontaire du nom Auth ;
- première inscription Google identifiée par
  `getAdditionalUserInfo(credential)?.isNewUser === true` ;
- enregistrement volontaire de la page Profil quand le profil est absent.

La création se fait en transaction et préserve intégralement tout document
déjà présent. Un login Google existant, ou une information de première
inscription indisponible, ne crée pas de profil. Ce dernier cas conserve
`null` jusqu'à un enregistrement volontaire ; aucun bootstrap silencieux
n'est exécuté lors de la navigation.

L'enregistrement du formulaire appelle `updateCustomerProfile()`, qui écrit
seulement `displayName`, `phone` et `updatedAt`, puis relit via le refresh.
Les compteurs de commandes, dépenses et fidélité ne sont pas synchronisés
par Auth. Checkout et blog gardent leurs fallbacks vers l'utilisateur Auth
quand le profil est `null`.

Les règles Firestore, Referral/Cagnotte et leurs données commerciales ne
changent pas. Cette qualification utilise exclusivement des mocks/fixtures
locales ; aucun Auth Production, gate maintenance, dry-run Referral,
migration ou apply n'est exécuté.

`npm run test:auth-profile-hydration` exécute le vrai provider React, les
services customer, le gate admin et le formulaire Profil avec un transport
Firebase synthétique. Chaque lecture et chaque écriture sont comptées ;
tout trafic externe est refusé. La suite est exécutée par `verify` et la CI,
avec `npm run typecheck:auth-profile-tests`.
