import { printRecipeAccess, startRecipeHarness } from "./harness.js";

const harness = await startRecipeHarness("manual");
printRecipeAccess(harness);

await new Promise<void>((resolve) => {
  const stop = () => resolve();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
});

await harness.stop();
console.log("Recette locale arrêtée : tous les ports dédiés sont libérés.");
