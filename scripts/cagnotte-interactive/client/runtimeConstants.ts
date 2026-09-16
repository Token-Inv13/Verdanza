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
export const RECIPE_ALLOWED_PORTS = Object.freeze(Object.values(RECIPE_PORTS));
export const RECIPE_ORIGIN = `http://${RECIPE_HOST}:${RECIPE_PORTS.app}`;
