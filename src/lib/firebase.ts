import { initializeApp, getApp, getApps } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore, setLogLevel } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const publicFirebaseFallback = {
  apiKey: "AIzaSyCI5h39eTGGn-bd0jOCP9onIMjtP-qmcWc",
  authDomain: "verdanza-1f621.firebaseapp.com",
  projectId: "verdanza-1f621",
  storageBucket: "verdanza-1f621.firebasestorage.app",
  messagingSenderId: "270786583904",
  appId: "1:270786583904:web:0e71079a592dfd31c7d205",
  measurementId: "G-E9XNP7BJ2Y",
};

const viteEnv = import.meta.env ?? {};

export const firebaseConfig = {
  apiKey: viteEnv.VITE_FIREBASE_API_KEY || publicFirebaseFallback.apiKey,
  authDomain: viteEnv.VITE_FIREBASE_AUTH_DOMAIN || publicFirebaseFallback.authDomain,
  projectId: viteEnv.VITE_FIREBASE_PROJECT_ID || publicFirebaseFallback.projectId,
  storageBucket: viteEnv.VITE_FIREBASE_STORAGE_BUCKET || publicFirebaseFallback.storageBucket,
  messagingSenderId:
    viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || publicFirebaseFallback.messagingSenderId,
  appId: viteEnv.VITE_FIREBASE_APP_ID || publicFirebaseFallback.appId,
  measurementId: viteEnv.VITE_FIREBASE_MEASUREMENT_ID || publicFirebaseFallback.measurementId,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.storageBucket &&
    firebaseConfig.messagingSenderId &&
    firebaseConfig.appId,
);

export const app = isFirebaseConfigured
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

if (viteEnv.PROD) {
  setLogLevel("silent");
}

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const storage = app ? getStorage(app) : null;

export async function getFirebaseAnalytics() {
  if (!app) return null;
  if (typeof window === "undefined") return null;
  const supported = await isSupported();
  return supported ? getAnalytics(app) : null;
}
