# Verdanza — Configuration GitHub, Firebase, Stripe

Date : 20 juin 2026  
Projet : Verdanza / Verdanza CBD  
Objectif : fournir à Codex les informations de configuration nécessaires pour initialiser proprement le projet web.

---

## 1. Dépôt GitHub

Dépôt principal du projet :

```text
https://github.com/Token-Inv13/Verdanza.git
```

Commande de clonage :

```bash
git clone https://github.com/Token-Inv13/Verdanza.git
cd Verdanza
```

Dossier local actuel indiqué :

```text
C:\Users\token\Documents\DEV\verdanza cbd
```

Le fichier JSON Firebase complet est indiqué comme présent dans le dossier principal local :

```text
C:\Users\token\Documents\DEV\verdanza cbd
```

Codex devra vérifier ce fichier local et s’en servir uniquement comme référence de configuration.  
Ne pas versionner ce fichier JSON s’il contient des informations sensibles.

---

## 2. Configuration Firebase

Configuration Firebase fournie :

```ts
const firebaseConfig = {
  apiKey: "AIzaSyCI5h39eTGGn-bd0jOCP9onIMjtP-qmcWc",
  authDomain: "verdanza-1f621.firebaseapp.com",
  projectId: "verdanza-1f621",
  storageBucket: "verdanza-1f621.firebasestorage.app",
  messagingSenderId: "270786583904",
  appId: "1:270786583904:web:0e71079a592dfd31c7d205",
  measurementId: "G-E9XNP7BJ2Y"
};
```

Variables d’environnement recommandées pour Vite :

```env
VITE_FIREBASE_API_KEY="AIzaSyCI5h39eTGGn-bd0jOCP9onIMjtP-qmcWc"
VITE_FIREBASE_AUTH_DOMAIN="verdanza-1f621.firebaseapp.com"
VITE_FIREBASE_PROJECT_ID="verdanza-1f621"
VITE_FIREBASE_STORAGE_BUCKET="verdanza-1f621.firebasestorage.app"
VITE_FIREBASE_MESSAGING_SENDER_ID="270786583904"
VITE_FIREBASE_APP_ID="1:270786583904:web:0e71079a592dfd31c7d205"
VITE_FIREBASE_MEASUREMENT_ID="G-E9XNP7BJ2Y"
```

Fichier conseillé :

```text
.env.local
```

Fichier exemple à versionner :

```text
.env.example
```

---

## 3. Configuration Stripe

Stripe est prévu en mode test au départ.

Clé publique test fournie :

```env
VITE_STRIPE_PUBLIC_KEY="pk_test_51TkV2BEhe0nwq4VZwayqrImZUPcPPDCpaiAGIPLrEmUKjbuLEyEEC1KITulshSvfG6Tus5NfsqYb4SCx2ZdUsfsG00xKZJo4KU"
```

La clé secrète Stripe doit être utilisée uniquement côté serveur.

Variable à créer dans `.env.local`, dans les variables Vercel, et dans l’environnement des fonctions serveur :

```env
STRIPE_SECRET_KEY="<coller ici la clé secrète Stripe test>"
```

Important : ne jamais exposer `STRIPE_SECRET_KEY` côté frontend.  
Ne jamais utiliser une variable `VITE_` pour une clé secrète Stripe.

---

## 4. Exemple `.env.local`

Créer localement un fichier :

```text
.env.local
```

Contenu recommandé :

```env
# Firebase — client
VITE_FIREBASE_API_KEY="AIzaSyCI5h39eTGGn-bd0jOCP9onIMjtP-qmcWc"
VITE_FIREBASE_AUTH_DOMAIN="verdanza-1f621.firebaseapp.com"
VITE_FIREBASE_PROJECT_ID="verdanza-1f621"
VITE_FIREBASE_STORAGE_BUCKET="verdanza-1f621.firebasestorage.app"
VITE_FIREBASE_MESSAGING_SENDER_ID="270786583904"
VITE_FIREBASE_APP_ID="1:270786583904:web:0e71079a592dfd31c7d205"
VITE_FIREBASE_MEASUREMENT_ID="G-E9XNP7BJ2Y"

# Stripe — client
VITE_STRIPE_PUBLIC_KEY="pk_test_51TkV2BEhe0nwq4VZwayqrImZUPcPPDCpaiAGIPLrEmUKjbuLEyEEC1KITulshSvfG6Tus5NfsqYb4SCx2ZdUsfsG00xKZJo4KU"

# Stripe — serveur uniquement
STRIPE_SECRET_KEY="<coller ici la clé secrète Stripe test>"

# Application
VITE_APP_NAME="Verdanza"
VITE_APP_ENV="development"
VITE_APP_URL="http://localhost:5173"
```

---

## 5. Exemple `.env.example`

Créer et versionner un fichier :

```text
.env.example
```

Contenu recommandé :

```env
# Firebase — client
VITE_FIREBASE_API_KEY=""
VITE_FIREBASE_AUTH_DOMAIN=""
VITE_FIREBASE_PROJECT_ID=""
VITE_FIREBASE_STORAGE_BUCKET=""
VITE_FIREBASE_MESSAGING_SENDER_ID=""
VITE_FIREBASE_APP_ID=""
VITE_FIREBASE_MEASUREMENT_ID=""

# Stripe — client
VITE_STRIPE_PUBLIC_KEY=""

# Stripe — serveur uniquement
STRIPE_SECRET_KEY=""

# Application
VITE_APP_NAME="Verdanza"
VITE_APP_ENV="development"
VITE_APP_URL="http://localhost:5173"
```

---

## 6. `.gitignore` obligatoire

Vérifier que le projet contient bien ces exclusions :

```gitignore
# Environment
.env
.env.local
.env.development.local
.env.production.local
.env.test.local

# Firebase / service accounts
firebaseConfig.json
serviceAccountKey.json
*.service-account.json
*.firebase-admin.json

# Dependencies / build
node_modules
dist
.vite

# Logs
*.log
npm-debug.log*
yarn-debug.log*
pnpm-debug.log*
```

Ne jamais commiter :

- `.env.local`
- clé secrète Stripe
- clé service account Firebase Admin
- fichier JSON Firebase sensible
- webhook secret Stripe

---

## 7. Fichier Firebase client recommandé

Créer :

```text
src/lib/firebase.ts
```

Exemple :

```ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export async function getFirebaseAnalytics() {
  if (typeof window === "undefined") return null;
  const supported = await isSupported();
  return supported ? getAnalytics(app) : null;
}
```

---

## 8. Fichier Stripe client recommandé

Créer :

```text
src/lib/stripe.ts
```

Exemple :

```ts
import { loadStripe } from "@stripe/stripe-js";

const stripePublicKey = import.meta.env.VITE_STRIPE_PUBLIC_KEY;

if (!stripePublicKey) {
  throw new Error("Missing VITE_STRIPE_PUBLIC_KEY");
}

export const stripePromise = loadStripe(stripePublicKey);
```

---

## 9. Stripe Checkout — architecture recommandée

Ne pas créer les sessions Stripe directement dans le frontend.

Prévoir une route serveur ou une Firebase Function :

```text
POST /api/create-checkout-session
```

Responsabilité :

- recevoir le panier ;
- vérifier les produits en base Firestore ;
- recalculer les prix côté serveur ;
- créer la session Stripe Checkout ;
- retourner l’URL Stripe Checkout au client.

Prévoir aussi un webhook :

```text
POST /api/stripe-webhook
```

Responsabilité :

- écouter `checkout.session.completed` ;
- vérifier la signature Stripe ;
- marquer la commande comme payée ;
- réserver ou déduire le stock ;
- créer l’événement de commande dans Firestore ;
- envoyer un email ou préparer la notification.

Variables futures à prévoir :

```env
STRIPE_WEBHOOK_SECRET=""
```

---

## 10. Firebase — services à activer

Services recommandés pour Verdanza :

- Firebase Auth
- Firestore Database
- Firebase Storage
- Firebase Hosting optionnel
- Firebase Functions si utilisées pour Stripe
- Firebase Analytics optionnel

Auth providers à prévoir au minimum :

- Email/password
- Google optionnel
- Admin via rôle personnalisé ou collection `adminUsers`

---

## 11. Collections Firestore attendues

Collections prévues :

```text
products
categories
orders
customers
stockMovements
deliveryZones
coupons
settings
adminUsers
supplierProducts
labReports
```

Codex devra créer une structure propre pour ces collections côté types TypeScript.

---

## 12. Règles de sécurité Firestore — intention

Les règles exactes seront à écrire après la structure finale, mais l’intention est :

- lecture publique uniquement sur les produits actifs ;
- écriture produits uniquement admin ;
- lecture commande uniquement par le client concerné ou admin ;
- écriture commande via serveur sécurisé ;
- écriture stock uniquement admin/serveur ;
- accès admin uniquement aux utilisateurs autorisés ;
- aucune clé sensible dans Firestore.

---

## 13. Variables Vercel à configurer

Dans Vercel, ajouter :

```env
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_MEASUREMENT_ID
VITE_STRIPE_PUBLIC_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
VITE_APP_NAME
VITE_APP_ENV
VITE_APP_URL
```

Pour `VITE_APP_URL`, utiliser l’URL de production lorsque le domaine sera prêt.

---

## 14. Instruction de sécurité pour Codex

Codex doit respecter ces règles :

1. Ne jamais afficher la clé secrète Stripe dans le code frontend.
2. Ne jamais créer de fichier `.env.local` versionné.
3. Ne jamais commiter de service account Firebase.
4. Créer un `.env.example` propre avec des valeurs vides.
5. Charger les variables d’environnement avec validation.
6. Bloquer le build si les variables critiques sont absentes.
7. Prévoir une architecture Stripe côté serveur.
8. Prévoir des règles Firestore strictes.
9. Prévoir des rôles admin séparés des comptes clients.
10. Préparer la migration vers les clés Stripe live plus tard.

---

## 15. Prompt court pour Codex — configuration initiale

```text
Configure le projet Verdanza avec GitHub, Firebase et Stripe en mode test.

Dépôt : https://github.com/Token-Inv13/Verdanza.git

Objectifs :
- créer la structure des variables d’environnement Vite ;
- créer `.env.example` sans secrets ;
- vérifier que `.env.local` est ignoré par Git ;
- créer `src/lib/firebase.ts` avec Firebase Auth, Firestore, Storage et Analytics optionnel ;
- créer `src/lib/stripe.ts` avec `loadStripe` côté client ;
- préparer une architecture Stripe Checkout côté serveur ;
- ne jamais exposer `STRIPE_SECRET_KEY` côté frontend ;
- préparer les collections Firestore attendues ;
- préparer les types TypeScript liés à produits, commandes, clients, stocks et livraisons ;
- documenter les variables Vercel à créer ;
- vérifier que le projet reste compatible React + Vite + TypeScript + Firebase + Stripe + Vercel.

Contraintes :
- aucune clé secrète dans le dépôt ;
- `.env.local` non versionné ;
- `.env.example` versionné ;
- règles de sécurité prévues dès le départ ;
- admin cockpit prévu dans l’architecture.
```

---

## 16. Notes finales

Ce document complète les fichiers précédents :

- cadrage marque / site / admin cockpit ;
- sélection produits Verdanza ;
- configuration GitHub / Firebase / Stripe.

Il sert de fichier de référence pour lancer proprement la première implémentation Codex.
