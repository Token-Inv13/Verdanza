import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RECIPE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const RECIPE_HOST = "127.0.0.1" as const;
export const RECIPE_PROJECT_ID = "demo-verdanza-cagnotte" as const;
export const RECIPE_PORTS = Object.freeze({
  app: 14173,
  api: 14174,
  firestore: 18086,
  auth: 19099,
  hub: 4400,
  logging: 4500,
  firestoreWebsocket: 9150,
});
export const RECIPE_ORIGIN = `http://${RECIPE_HOST}:${RECIPE_PORTS.app}`;
export const RECIPE_CACHE_ROOT = resolve(
  RECIPE_ROOT,
  "node_modules/.cache/verdanza-cagnotte-interactive",
);
export const RECIPE_FIREBASE_CACHE = resolve(RECIPE_ROOT, "node_modules/.cache/cagnotte");
export const RECIPE_PRODUCT = Object.freeze({
  id: "recette-fleur-fictive-100",
  internalReference: "RECETTE-LOCAL-100",
  slug: "fleur-fictive-recette-100",
  name: "Fleur fictive recette — 100 €",
  category: "flowers" as const,
  price: 100,
  fixedPriceMode: "disabled" as const,
  shortDescription: "Produit entièrement fictif réservé à la recette locale isolée.",
  longDescription: "Donnée synthétique. Aucun article réel ni stock de production n’est consulté.",
  image: "/__recette-assets/cagnotte-produit-fictif.svg",
  imageAlt: "Illustration locale d’un produit fictif de recette",
  cbdRate: "Fictif",
  cbgRate: "Fictif",
  thcRate: "0,0 % fictif",
  origin: "Recette locale",
  cultureType: "Autre" as const,
  aromas: ["Fixture locale"],
  tags: ["recette-locale", "donnees-fictives"],
  stock: 20,
  lowStockThreshold: 2,
  isActive: true,
  isFeatured: true,
  seoTitle: "Produit fictif de recette locale",
  seoDescription: "Fixture locale non commerciale.",
});
export const RECIPE_ACCOUNTS = Object.freeze({
  client1: Object.freeze({
    email: "client.un@recette.verdanza.test",
    password: "Recette!Client1-2026",
    displayName: "Client fictif Un",
  }),
  client2: Object.freeze({
    email: "client.deux@recette.verdanza.test",
    password: "Recette!Client2-2026",
    displayName: "Client fictif Deux",
  }),
  admin: Object.freeze({
    email: "admin@recette.verdanza.test",
    password: "Recette!Admin-2026",
    displayName: "Admin fictif",
  }),
});
export const RECIPE_RATE_LIMIT_SECRET = "local-recipe-rate-limit-secret-2026-0001";
export const RECIPE_CURSOR_SECRET = "local-recipe-cursor-secret-2026-00000001";
export const RECIPE_PROGRAM_VERSION = "cagnotte-interactive-local-v1";
export const RECIPE_ALLOWED_PORTS = Object.freeze(Object.values(RECIPE_PORTS));

export function localUrl(port: number, pathname = "/") {
  if (!new Set<number>(RECIPE_ALLOWED_PORTS).has(port)) throw new Error(`Port local non autorisé : ${port}.`);
  return `http://${RECIPE_HOST}:${port}${pathname}`;
}
