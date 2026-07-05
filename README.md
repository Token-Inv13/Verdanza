# Verdanza CBD

Boutique en ligne Verdanza : catalogue CBD premium au gramme, panier, commande sans reglement en ligne, livraison locale autour d'Aix-en-Provence, livraison postale en France, cockpit admin Firestore, Firebase Auth et emails transactionnels.

## Stack

- React + Vite + TypeScript
- Tailwind CSS
- React Router
- Firebase Auth / Firestore
- Vercel Functions
- Resend pour les emails transactionnels
- Twilio optionnel pour les alertes telephone admin

## Installation

```bash
npm install
npm run dev
```

## Scripts

```bash
npm run lint
npm run typecheck:api
npm run build
npm run seed:products -- --yes
npm run seed:delivery-zones -- --yes
npm run seed:admin -- --yes
npm run seed:admin-auth -- --yes
```

## Commande Sans Reglement En Ligne

Le client peut :

- consulter les produits ;
- ajouter au panier ;
- remplir ses informations ;
- choisir livraison locale ou postale ;
- valider la commande ;
- recevoir une confirmation ;
- etre contacte directement par Verdanza.

Le reglement final est confirme manuellement par telephone ou email.

Contact public :

- telephone : `07 80 81 41 37`
- email : `contact@verdanza.fr`

## Flux Serveur

`api/create-order.ts` :

- valide le panier ;
- relit les produits depuis Firestore ;
- refuse les produits inactifs ;
- verifie le stock ;
- recalcule les prix cote serveur ;
- applique les codes promo actifs ;
- controle le minimum de livraison locale ;
- cree la commande ;
- decremente le stock ;
- cree les mouvements de stock ;
- envoie les emails client et admin ;
- declenche les alertes telephone admin si Twilio est configure.

La commande est creee avec :

```ts
orderStatus: "contact_required"
paymentStatus: "to_confirm"
paymentProvider: "manual"
```

## Livraison

Livraison locale Aix-en-Provence et alentours :

- disponible 7j/7 ;
- de 11h a 01h ;
- minimum de commande : 30 EUR ;
- reglement confirme directement avec le client apres validation.

Livraison postale en France :

- adresse complete requise ;
- frais, disponibilites et reglement confirmes directement avec le client apres validation ;
- pas de minimum automatique impose cote client hors configuration Firestore.

## Emails

Variables serveur :

```env
RESEND_API_KEY=
EMAIL_FROM=
ADMIN_NOTIFICATION_EMAIL=contact@verdanza.fr
ADMIN_NOTIFICATION_EMAILS=contact@verdanza.fr,verdanza.1@gmail.com
VERDANZA_CONTACT_PHONE=07 80 81 41 37
```

Emails envoyes :

- confirmation client apres commande ;
- notification admin aux adresses `ADMIN_NOTIFICATION_EMAILS` ;
- mise a jour client lors d'un changement de statut admin ;
- formulaire contact vers les adresses admin ;
- facture client avec PDF joint depuis l'admin.

Les emails ne doivent contenir aucune mention de prestataire de reglement en ligne.

## Alertes Telephone Admin

Variables SMS Twilio optionnelles :

```env
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_SMS_FROM=
ADMIN_ALERT_PHONE=
```

Variables WhatsApp Twilio optionnelles :

```env
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
ADMIN_ALERT_WHATSAPP=whatsapp:+33XXXXXXXXX
```

Si Twilio n'est pas configure, la commande et les emails continuent normalement.

## Variables Vercel

Ajouter en Production et Preview :

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
VITE_APP_URL=https://verdanza.fr
VITE_CONTACT_EMAIL=contact@verdanza.fr
VITE_CONTACT_PHONE=07 80 81 41 37
RESEND_API_KEY=
EMAIL_FROM=
ADMIN_NOTIFICATION_EMAIL=contact@verdanza.fr
ADMIN_NOTIFICATION_EMAILS=contact@verdanza.fr,verdanza.1@gmail.com
VERDANZA_CONTACT_PHONE=07 80 81 41 37
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
FIREBASE_SERVICE_ACCOUNT_BASE64=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_SMS_FROM=
ADMIN_ALERT_PHONE=
TWILIO_WHATSAPP_FROM=
ADMIN_ALERT_WHATSAPP=
```

Ne jamais versionner `.env.local`, cle Firebase Admin, cle Resend ou secret Twilio.

## Admin

Le cockpit admin permet :

- voir les commandes ;
- contacter les clients par appel, WhatsApp, SMS ou message copie ;
- modifier le statut de commande ;
- modifier le statut de reglement ;
- ajouter une reference de reglement ;
- ajouter un numero de suivi postal ;
- ajouter une note interne ;
- creer une facture brouillon depuis une commande ;
- creer une facture manuelle pour une vente directe ;
- telecharger une facture PDF ;
- envoyer une facture par email au client ;
- gerer produits, stocks, zones de livraison, coupons et clients.

Statuts commande :

- `new`
- `contact_required`
- `confirmed`
- `preparing`
- `out_for_delivery`
- `shipped`
- `delivered`
- `cancelled`

Statuts reglement :

- `to_confirm`
- `pending`
- `paid`
- `cancelled`

## Facturation

Le module facturation est accessible uniquement dans l'admin.

Comportement :

- une commande web peut generer une facture brouillon ;
- une vente hors site peut generer une facture manuelle ;
- la numerotation suit le format `VER-YYYY-0001` ;
- les factures validees ne doivent pas etre modifiees silencieusement ;
- les PDF et l'envoi email sont proteges par authentification admin.

Configuration provisoire par defaut :

- nom commercial : `Verdanza`
- nom affiche : `Token APP`
- telephone : `07 80 81 41 37`
- email : `contact@verdanza.fr`
- regime TVA : non configure
- informations legales : non validees manuellement

Important : les informations personnelles issues du certificat SIRENE ne sont pas
affichees cote client tant que la configuration n'est pas validee manuellement.
L'admin affiche un avertissement avant l'envoi officiel d'une facture si les
informations legales ou TVA ne sont pas confirmees.

Les champs SIREN/SIRET peuvent etre pre-renseignes dans l'admin, mais la raison
sociale, la forme juridique, l'adresse, le regime TVA et les mentions obligatoires
doivent etre verifies avant emission officielle.

## Verification

Avant de deployer :

```bash
npm run lint
npm run typecheck:api
npm run build
```

Tests manuels recommandes :

- panier ;
- checkout ;
- commande locale ;
- commande postale ;
- email client ;
- email admin ;
- cockpit admin ;
- mobile ;
- desktop ;
- console navigateur sans erreur.
