import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  initializeFirestore,
  terminate,
} from "firebase/firestore";
import {
  RECIPE_HOST,
  RECIPE_PORTS,
  RECIPE_PRODUCT,
  RECIPE_PROJECT_ID,
} from "./constants.js";
import { validateCurrentRecipeProcess } from "./environment.js";

validateCurrentRecipeProcess();

const app = initializeApp({
  apiKey: "demo-api-key",
  authDomain: `${RECIPE_PROJECT_ID}.firebaseapp.com`,
  projectId: RECIPE_PROJECT_ID,
  appId: "1:000000000000:web:localrecipe-warmup",
}, `verdanza-cagnotte-listen-warmup-${process.pid}`);
const database = initializeFirestore(app, { experimentalForceLongPolling: true });
connectFirestoreEmulator(database, RECIPE_HOST, RECIPE_PORTS.firestore);

const startedAt = Date.now();
try {
  const snapshot = await bounded(
    getDocFromServer(doc(database, "products", RECIPE_PRODUCT.id)),
    30_000,
    "listener Firestore local de préchauffage",
  );
  assert.equal(snapshot.exists(), true, "le produit fictif doit être reçu depuis l’émulateur");
  console.log(JSON.stringify({
    projectId: RECIPE_PROJECT_ID,
    documentId: RECIPE_PRODUCT.id,
    source: "server",
    durationMs: Date.now() - startedAt,
  }));
} finally {
  await Promise.allSettled([terminate(database), deleteApp(app)]);
}

async function bounded<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} indisponible après ${timeoutMs} ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
