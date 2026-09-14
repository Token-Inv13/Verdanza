import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { RECIPE_FIREBASE_CACHE, RECIPE_ROOT } from "./constants.js";

export function assertInteractivePrerequisites() {
  const firebasePackage = JSON.parse(readFileSync(resolve(RECIPE_ROOT, "node_modules/firebase-tools/package.json"), "utf8")) as { version?: string };
  if (firebasePackage.version !== "15.28.1") throw new Error("Exécutez npm run prepare:cagnotte-interactive : firebase-tools 15.28.1 manque.");
  const jar = resolve(RECIPE_FIREBASE_CACHE, "cloud-firestore-emulator-v1.22.0.jar");
  if (!existsSync(jar)) throw new Error("Exécutez npm run prepare:cagnotte-interactive : Firestore Emulator manque.");
  const digest = createHash("sha256").update(readFileSync(jar)).digest("hex");
  if (digest !== "9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c") {
    throw new Error("Firestore Emulator préparé possède une empreinte inattendue.");
  }
  if (!existsSync(chromium.executablePath())) throw new Error("Exécutez npm run prepare:cagnotte-interactive : Chromium Playwright manque.");
}
