import type { Auth, User } from "firebase/auth";
import { app } from "./firebase";
import { RECIPE_HOST, RECIPE_PORTS } from "./runtimeConstants";

type FirebaseAuthModule = typeof import("firebase/auth");
let modulePromise: Promise<FirebaseAuthModule> | null = null;
let authPromise: Promise<Auth> | null = null;

function loadModule() {
  modulePromise ??= import("firebase/auth");
  return modulePromise;
}

export async function getFirebaseAuth() {
  authPromise ??= loadModule().then((firebaseAuth) => {
    let auth: Auth;
    try {
      auth = firebaseAuth.initializeAuth(app, {
        persistence: [
          firebaseAuth.indexedDBLocalPersistence,
          firebaseAuth.browserLocalPersistence,
          firebaseAuth.browserSessionPersistence,
        ],
      });
    } catch {
      auth = firebaseAuth.getAuth(app);
    }
    firebaseAuth.connectAuthEmulator(auth, `http://${RECIPE_HOST}:${RECIPE_PORTS.auth}`, {
      disableWarnings: true,
    });
    auth.languageCode = "fr";
    return auth;
  });
  return authPromise;
}

export async function loadFirebaseAuthApi() {
  const [firebaseAuth, auth] = await Promise.all([loadModule(), getFirebaseAuth()]);
  return { firebaseAuth, auth };
}

export async function getCurrentFirebaseUser() {
  return (await getFirebaseAuth()).currentUser;
}

export async function getFirebaseIdToken() {
  return (await getCurrentFirebaseUser())?.getIdToken();
}

export type FirebaseUser = User;
