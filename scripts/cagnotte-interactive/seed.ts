import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Timestamp } from "firebase-admin/firestore";
import {
  localUrl,
  RECIPE_ACCOUNTS,
  RECIPE_PORTS,
  RECIPE_PRODUCT,
  RECIPE_PROJECT_ID,
} from "./constants.js";
import { validateCurrentRecipeProcess } from "./environment.js";
import { closeRecipeFirestore, getRecipeFirestore } from "./firestore.js";

validateCurrentRecipeProcess();
const db = getRecipeFirestore();
const createdAt = Timestamp.fromMillis(Date.UTC(2026, 0, 1));

try {
  const identities = Object.fromEntries(
    await Promise.all(Object.entries(RECIPE_ACCOUNTS).map(async ([key, account]) => {
      const identity = await createAuthAccount(account);
      return [key, identity] as const;
    })),
  ) as Record<keyof typeof RECIPE_ACCOUNTS, { uid: string; email: string }>;

  const batch = db.batch();
  batch.set(db.collection("products").doc(RECIPE_PRODUCT.id), {
    ...RECIPE_PRODUCT,
    createdAt,
    updatedAt: createdAt,
  });
  for (const [key, account] of Object.entries(RECIPE_ACCOUNTS) as Array<
    [keyof typeof RECIPE_ACCOUNTS, (typeof RECIPE_ACCOUNTS)[keyof typeof RECIPE_ACCOUNTS]]
  >) {
    const identity = identities[key];
    batch.set(db.collection("customers").doc(identity.uid), {
      uid: identity.uid,
      email: account.email,
      displayName: account.displayName,
      phone: "",
      role: "customer",
      loyaltyPoints: 0,
      orderCount: 0,
      totalSpent: 0,
      createdAt,
      updatedAt: createdAt,
    });
  }
  batch.set(db.collection("adminUsers").doc(identities.admin.uid), {
    uid: identities.admin.uid,
    email: RECIPE_ACCOUNTS.admin.email,
    role: "owner",
    isActive: true,
    createdAt,
    updatedAt: createdAt,
  });
  await batch.commit();

  const manifest = {
    projectId: RECIPE_PROJECT_ID,
    productId: RECIPE_PRODUCT.id,
    identities,
    walletDocumentsInitiallyPresent: (await db.collection("cagnotteWallets").get()).size,
  };
  const runDirectory = process.env.VERDANZA_RECETTE_RUN_DIR;
  if (!runDirectory) throw new Error("ISOLATION: dossier d’exécution absent.");
  await mkdir(runDirectory, { recursive: true });
  await writeFile(resolve(runDirectory, "fixtures.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Fixtures fictives prêtes : ${JSON.stringify(manifest)}`);
} finally {
  await closeRecipeFirestore();
}

async function createAuthAccount(account: { email: string; password: string; displayName: string }) {
  const signUp = await fetch(
    localUrl(RECIPE_PORTS.auth, "/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: account.email, password: account.password, returnSecureToken: true }),
    },
  );
  const payload = await signUp.json().catch(() => ({})) as {
    localId?: string;
    idToken?: string;
    email?: string;
    error?: { message?: string };
  };
  if (!signUp.ok || !payload.localId || !payload.idToken) {
    throw new Error(`Création Auth Emulator refusée : ${payload.error?.message || signUp.status}.`);
  }
  const update = await fetch(
    localUrl(RECIPE_PORTS.auth, "/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-api-key"),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: payload.idToken, displayName: account.displayName, returnSecureToken: false }),
    },
  );
  if (!update.ok) throw new Error(`Mise à jour du compte fictif refusée : HTTP ${update.status}.`);
  return { uid: payload.localId, email: payload.email || account.email };
}
