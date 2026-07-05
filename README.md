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
VERDANZA_CONTACT_PHONE=07 80 81 41 37
```

Emails envoyes :

- confirmation client apres commande ;
- notification admin a `ADMIN_NOTIFICATION_EMAIL` ;
- mise a jour client lors d'un changement de statut admin ;
- formulaire contact vers `ADMIN_NOTIFICATION_EMAIL`.

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
RESEND_API_KEY=
EMAIL_FROM=
ADMIN_NOTIFICATION_EMAIL=contact@verdanza.fr
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
- contacter les clients ;
- modifier le statut de commande ;
- modifier le statut de reglement ;
- ajouter une reference de reglement ;
- ajouter un numero de suivi postal ;
- ajouter une note interne ;
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
