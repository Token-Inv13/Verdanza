import { getApp, getApps, initializeApp } from "firebase/app";
import { connectFirestoreEmulator, initializeFirestore, setLogLevel } from "firebase/firestore";
import { RECIPE_HOST, RECIPE_PORTS, RECIPE_PROJECT_ID } from "./runtimeConstants";

if (import.meta.env.VITE_FIREBASE_PROJECT_ID !== RECIPE_PROJECT_ID) {
  throw new Error("RECETTE LOCALE: projet Firebase client incohérent, démarrage refusé.");
}

export const firebaseConfig = Object.freeze({
  apiKey: "demo-api-key",
  authDomain: `${RECIPE_PROJECT_ID}.firebaseapp.com`,
  projectId: RECIPE_PROJECT_ID,
  storageBucket: `${RECIPE_PROJECT_ID}.appspot.com`,
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:localrecipe",
});
export const isFirebaseConfigured = true;
export const app = getApps().some((entry) => entry.name === "verdanza-cagnotte-interactive")
  ? getApp("verdanza-cagnotte-interactive")
  : initializeApp(firebaseConfig, "verdanza-cagnotte-interactive");
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});
connectFirestoreEmulator(db, RECIPE_HOST, RECIPE_PORTS.firestore);
setLogLevel("error");

export async function getFirebaseAnalytics() {
  return null;
}

export async function getFirebaseStorage(): Promise<never> {
  throw new Error("RECETTE LOCALE: Firebase Storage est neutralisé.");
}
