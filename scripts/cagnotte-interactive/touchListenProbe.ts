import { RECIPE_PRODUCT } from "./constants.js";
import { validateCurrentRecipeProcess } from "./environment.js";
import { closeRecipeFirestore, getRecipeFirestore } from "./firestore.js";

validateCurrentRecipeProcess();
const generation = process.argv[2] ?? "";
if (!/^recovery-[a-z0-9-]{8,80}$/.test(generation)) {
  throw new Error("Génération de reprise Firestore locale invalide.");
}

const db = getRecipeFirestore();
try {
  await db.collection("products").doc(RECIPE_PRODUCT.id).update({
    __recetteListenGeneration: generation,
  });
  console.log(`Sonde Listen locale actualisée : ${generation}.`);
} finally {
  await closeRecipeFirestore();
}
