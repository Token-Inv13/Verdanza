import { app } from "./firebase";
import type { Auth, User } from "firebase/auth";

type FirebaseAuthModule = typeof import("firebase/auth");

let authModulePromise: Promise<FirebaseAuthModule> | null = null;
let authInstancePromise: Promise<Auth | null> | null = null;
let authInstance: Auth | null = null;

function loadFirebaseAuthModule() {
  authModulePromise ??= import("firebase/auth");
  return authModulePromise;
}

export async function getFirebaseAuth() {
  const firebaseApp = app;
  if (!firebaseApp) return null;
  if (authInstance) return authInstance;

  authInstancePromise ??= loadFirebaseAuthModule().then((firebaseAuth) => {
    try {
      authInstance = firebaseAuth.initializeAuth(firebaseApp, {
        persistence: [
          firebaseAuth.indexedDBLocalPersistence,
          firebaseAuth.browserLocalPersistence,
          firebaseAuth.browserSessionPersistence,
        ],
        popupRedirectResolver: firebaseAuth.browserPopupRedirectResolver,
      });
    } catch {
      authInstance = firebaseAuth.getAuth(firebaseApp);
    }

    authInstance.languageCode = "fr";

    return authInstance;
  });

  return authInstancePromise;
}

export async function loadFirebaseAuthApi() {
  const [firebaseAuth, auth] = await Promise.all([
    loadFirebaseAuthModule(),
    getFirebaseAuth(),
  ]);

  return { firebaseAuth, auth };
}

export async function getCurrentFirebaseUser() {
  const auth = await getFirebaseAuth();
  return auth?.currentUser ?? null;
}

export async function getFirebaseIdToken() {
  return (await getCurrentFirebaseUser())?.getIdToken();
}

export type FirebaseUser = User;
