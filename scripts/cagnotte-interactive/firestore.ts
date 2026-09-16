import { Firestore } from "firebase-admin/firestore";
import { RECIPE_HOST, RECIPE_PORTS, RECIPE_PROJECT_ID } from "./constants.js";
import { validateCurrentRecipeProcess } from "./environment.js";

let firestore: Firestore | null = null;

export function getRecipeFirestore() {
  validateCurrentRecipeProcess();
  firestore ??= new Firestore({
    projectId: RECIPE_PROJECT_ID,
    host: RECIPE_HOST,
    port: RECIPE_PORTS.firestore,
    ssl: false,
    universeDomain: "googleapis.com",
    ignoreUndefinedProperties: false,
  });
  return firestore;
}

export async function closeRecipeFirestore() {
  if (!firestore) return;
  await firestore.terminate();
  firestore = null;
}
