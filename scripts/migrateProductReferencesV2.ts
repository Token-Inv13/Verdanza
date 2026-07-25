import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { getRequiredAdminDb } from "./_firebaseAdminScript.js";
import { generateProductReferenceRandomCode } from "../api/_server/productReferences.js";
import {
  createProductInternalReference,
  isLegacyProductInternalReference,
  isProductInternalReference,
  normalizeInternalReference,
  normalizeLegacyInternalReferences,
  productReferenceCategoryCode,
  PRODUCT_REFERENCE_CONFIRMATION,
} from "../src/lib/productReferences.js";
import type { ProductCategory } from "../src/types/index.js";

export const PRODUCT_REFERENCE_MIGRATION_PROJECT_ID = "verdanza-1f621";
export const PRODUCT_REFERENCE_MIGRATION_PLAN_DIR = path.join(
  "reports",
  "product-reference-migration-v2",
);
export const PRODUCT_REFERENCE_MIGRATION_PLAN_PATH = path.join(
  PRODUCT_REFERENCE_MIGRATION_PLAN_DIR,
  "plan-2026-07-25.json",
);

type ExpectedProductReference = {
  productId: string;
  productName: string;
  category: ProductCategory;
  oldReference: string | null;
};

type ProductReferenceMigrationDocument = {
  id: string;
  exists: boolean;
  data?: Record<string, unknown>;
};

export type ProductReferenceMigrationPlanEntry = {
  productId: string;
  productName: string;
  category: ProductCategory;
  categoryCode: string;
  oldReference: string | null;
  newReference: string;
  legacyInternalReferencesBefore: string[];
  legacyInternalReferencesAfter: string[];
  reservation: {
    reference: string;
    productId: string;
    categoryCode: string;
  };
  status: "to_update" | "already_compliant" | "blocked";
  reasons: string[];
};

export type ProductReferenceMigrationPlan = {
  version: 2;
  projectId: string;
  createdAt: string;
  fingerprint: string;
  entries: ProductReferenceMigrationPlanEntry[];
};

export const expectedProductReferenceMigrations: ExpectedProductReference[] = [
  expected("flower-amnesia-cbd-hydroponique", "Amnesia", "flowers", "VDZ-000001"),
  expected("flower-blue-dream-cbd", "Blue Dream", "flowers", "VDZ-000002"),
  expected("flower-cookie-kush-indoor", "Cookie Kush Indoor", "flowers", "VDZ-000003"),
  expected("flower-harlequin-greenhouse", "Harlequin Greenhouse", "flowers", "VDZ-000004"),
  expected("flower-mandarine-cbd", "Mandarine", "flowers", "VDZ-000005"),
  expected("flower-mango-haze-cbd", "Mango Haze", "flowers", "VDZ-000006"),
  expected("flower-petites-tetes-og-kush", "OG Kush", "flowers", "VDZ-000007"),
  expected("flower-plutonium-cbd-hydroponique", "Plutonium", "flowers", "VDZ-000008"),
  expected("resin-3x-filtre-cbd-cbg", "3X Filtre CBD/CBG", "resins", "VDZ-000009"),
  expected("resin-creamy-piatella-cbd", "Creamy Piatella", "resins", "VDZ-000010"),
  expected("resin-golden-static", "Golden Static", "resins", "VDZ-000011"),
  expected("resin-la-mousse", "La Mousse", "resins", "VDZ-000012"),
  expected("resin-le-beldia-cbn-cbd", "Le Beldia CBN + CBD", "resins", "VDZ-000013"),
  expected("resin-supreme-purple-cbd", "Supreme Purple", "resins", "VDZ-000014"),
  expected("resin-supreme-50-cbd", "Supreme 50 % CBD", "resins", null),
];

function expected(
  productId: string,
  productName: string,
  category: ProductCategory,
  oldReference: string | null,
): ExpectedProductReference {
  return { productId, productName, category, oldReference };
}

export async function runProductReferenceMigration({
  db,
  projectId,
  apply,
  confirm,
  planPath = PRODUCT_REFERENCE_MIGRATION_PLAN_PATH,
  now = new Date(),
}: {
  db: FirebaseFirestore.Firestore;
  projectId: string;
  apply: boolean;
  confirm?: string;
  planPath?: string;
  now?: Date;
}) {
  if (projectId !== PRODUCT_REFERENCE_MIGRATION_PROJECT_ID) {
    throw new Error(
      `Projet Firebase refuse: ${projectId || "(inconnu)"} au lieu de ${PRODUCT_REFERENCE_MIGRATION_PROJECT_ID}.`,
    );
  }
  if (apply && confirm !== PRODUCT_REFERENCE_CONFIRMATION) {
    throw new Error(`Ecriture refusee sans --confirm=${PRODUCT_REFERENCE_CONFIRMATION}.`);
  }

  const productsSnapshot = await db.collection("products").get();
  const documents = productsSnapshot.docs.map((entry) => ({
    id: entry.id,
    exists: true,
    data: entry.data(),
  }));
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const expectedIds = new Set(expectedProductReferenceMigrations.map((entry) => entry.productId));
  const unexpectedIds = documents.filter((document) => !expectedIds.has(document.id));
  if (documents.length !== expectedProductReferenceMigrations.length || unexpectedIds.length) {
    throw new Error(
      `Inventaire produits refuse: ${documents.length} produit(s), ${unexpectedIds.length} produit(s) inattendu(s).`,
    );
  }

  const plan = await loadOrCreatePlan({
    db,
    projectId,
    documentsById,
    planPath,
    now,
  });
  const analyses = await analyzePlanAgainstFirestore({ db, plan, documentsById });
  const blocked = analyses.entries.filter((entry) => entry.status === "blocked");
  const toUpdate = analyses.entries.filter((entry) => entry.status === "to_update");
  const alreadyCompliant = analyses.entries.filter((entry) => entry.status === "already_compliant");

  if (apply && blocked.length) {
    throw new Error(`Migration refusee: ${blocked.length} produit(s) bloque(s).`);
  }

  if (apply) {
    await applyPlan(db, analyses);
  }

  return {
    projectId,
    apply,
    planPath,
    fingerprint: analyses.fingerprint,
    entries: analyses.entries,
    summary: {
      toUpdate: toUpdate.length,
      alreadyCompliant: alreadyCompliant.length,
      missing: analyses.missing,
      blocked: blocked.length,
      written: apply ? toUpdate.length : 0,
    },
  };
}

async function loadOrCreatePlan({
  db,
  projectId,
  documentsById,
  planPath,
  now,
}: {
  db: FirebaseFirestore.Firestore;
  projectId: string;
  documentsById: Map<string, ProductReferenceMigrationDocument>;
  planPath: string;
  now: Date;
}) {
  if (existsSync(planPath)) {
    const parsed = JSON.parse(await readFile(planPath, "utf8")) as ProductReferenceMigrationPlan;
    assertPlanFingerprint(parsed);
    return parsed;
  }

  const entries = await buildPlanEntries(db, documentsById);
  const plan: ProductReferenceMigrationPlan = {
    version: 2,
    projectId,
    createdAt: now.toISOString(),
    fingerprint: "",
    entries,
  };
  plan.fingerprint = planFingerprint(plan);
  await mkdir(path.dirname(planPath), { recursive: true });
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return plan;
}

async function buildPlanEntries(
  db: FirebaseFirestore.Firestore,
  documentsById: Map<string, ProductReferenceMigrationDocument>,
) {
  const usedNewReferences = new Set<string>();
  const entries: ProductReferenceMigrationPlanEntry[] = [];
  const currentReferences = new Map<string, string>();

  for (const expectedProduct of expectedProductReferenceMigrations) {
    const document = documentsById.get(expectedProduct.productId);
    const currentReference = normalizeInternalReference(document?.data?.internalReference);
    if (!currentReference) continue;
    if (currentReferences.has(currentReference)) {
      throw new Error(
        `Reference actuelle dupliquee ${currentReference}: ${currentReferences.get(currentReference)} et ${expectedProduct.productId}.`,
      );
    }
    currentReferences.set(currentReference, expectedProduct.productId);
  }

  for (const expectedProduct of expectedProductReferenceMigrations) {
    const document = documentsById.get(expectedProduct.productId);
    const data = document?.data || {};
    const category = String(data.category || "");
    const currentReference = normalizeInternalReference(data.internalReference);
    const legacyBefore = normalizeLegacyInternalReferences(data.legacyInternalReferences);
    const categoryCode = productReferenceCategoryCode(expectedProduct.category);
    const reasons: string[] = [];

    if (!document?.exists) reasons.push("Document products introuvable.");
    if (category !== expectedProduct.category) {
      reasons.push(`Categorie inattendue: ${category || "(vide)"}.`);
    }
    if (expectedProduct.oldReference && currentReference !== expectedProduct.oldReference) {
      reasons.push(`Ancienne reference inattendue: ${currentReference || "(vide)"}.`);
    }
    if (!expectedProduct.oldReference && currentReference) {
      reasons.push(`Reference inattendue pour produit sans reference: ${currentReference}.`);
    }
    if (expectedProduct.oldReference && !isLegacyProductInternalReference(expectedProduct.oldReference)) {
      reasons.push(`Ancienne reference attendue invalide: ${expectedProduct.oldReference}.`);
    }

    let newReference = "";
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const candidate = createProductInternalReference(
        expectedProduct.category,
        generateProductReferenceRandomCode(),
      );
      if (usedNewReferences.has(candidate)) continue;
      const reservation = await db.collection("productReferences").doc(candidate).get();
      if (reservation.exists) continue;
      newReference = candidate;
      usedNewReferences.add(candidate);
      break;
    }
    if (!newReference) reasons.push("Generation reference nouvelle impossible.");

    const legacyAfter = [...legacyBefore];
    if (expectedProduct.oldReference && !legacyAfter.includes(expectedProduct.oldReference)) {
      legacyAfter.push(expectedProduct.oldReference);
    }

    entries.push({
      productId: expectedProduct.productId,
      productName: String(data.name || expectedProduct.productName),
      category: expectedProduct.category,
      categoryCode,
      oldReference: expectedProduct.oldReference,
      newReference,
      legacyInternalReferencesBefore: legacyBefore,
      legacyInternalReferencesAfter: legacyAfter,
      reservation: {
        reference: newReference,
        productId: expectedProduct.productId,
        categoryCode,
      },
      status: reasons.length ? "blocked" : "to_update",
      reasons,
    });
  }

  return entries;
}

async function analyzePlanAgainstFirestore({
  db,
  plan,
  documentsById,
}: {
  db: FirebaseFirestore.Firestore;
  plan: ProductReferenceMigrationPlan;
  documentsById: Map<string, ProductReferenceMigrationDocument>;
}) {
  assertPlanFingerprint(plan);
  const entries: ProductReferenceMigrationPlanEntry[] = [];
  let missing = 0;
  const seenNewReferences = new Set<string>();

  for (const entry of plan.entries) {
    const document = documentsById.get(entry.productId);
    const data = document?.data || {};
    const currentReference = normalizeInternalReference(data.internalReference);
    const legacyReferences = normalizeLegacyInternalReferences(data.legacyInternalReferences);
    const reasons = [...entry.reasons];

    if (!document?.exists) {
      missing += 1;
      reasons.push("Document products introuvable.");
    }
    if (String(data.category || "") !== entry.category) {
      reasons.push(`Categorie inattendue: ${String(data.category || "(vide)")}.`);
    }
    if (!isProductInternalReference(entry.newReference)) {
      reasons.push(`Nouvelle reference invalide: ${entry.newReference}.`);
    }
    if (seenNewReferences.has(entry.newReference)) {
      reasons.push(`Nouvelle reference dupliquee dans le plan: ${entry.newReference}.`);
    }
    seenNewReferences.add(entry.newReference);

    const reservation = await db.collection("productReferences").doc(entry.newReference).get();
    if (reservation.exists && reservation.data()?.productId !== entry.productId) {
      reasons.push(`Reservation en conflit: ${entry.newReference}.`);
    }

    const isCompliant =
      currentReference === entry.newReference &&
      arraysEqual(legacyReferences, entry.legacyInternalReferencesAfter);
    const canUpdate =
      (entry.oldReference ? currentReference === entry.oldReference : currentReference === "") ||
      isCompliant;

    if (!canUpdate) {
      reasons.push(`Reference actuelle incompatible: ${currentReference || "(vide)"}.`);
    }

    entries.push({
      ...entry,
      status: reasons.length ? "blocked" : isCompliant ? "already_compliant" : "to_update",
      reasons,
    });
  }

  return {
    ...plan,
    entries,
    missing,
  };
}

async function applyPlan(
  db: FirebaseFirestore.Firestore,
  plan: ProductReferenceMigrationPlan & { missing: number },
) {
  await db.runTransaction(async (transaction) => {
    const liveProducts = await Promise.all(
      plan.entries.map(async (entry) => {
        const productRef = db.collection("products").doc(entry.productId);
        const productSnapshot = await transaction.get(productRef);
        const reservationRef = db.collection("productReferences").doc(entry.newReference);
        const reservationSnapshot = await transaction.get(reservationRef);
        return { entry, productRef, productSnapshot, reservationRef, reservationSnapshot };
      }),
    );

    for (const { entry, productSnapshot, reservationSnapshot } of liveProducts) {
      if (!productSnapshot.exists) throw new Error(`Produit absent: ${entry.productId}.`);
      const data = productSnapshot.data() || {};
      const currentReference = normalizeInternalReference(data.internalReference);
      const legacyReferences = normalizeLegacyInternalReferences(data.legacyInternalReferences);
      const alreadyCompliant =
        currentReference === entry.newReference &&
        arraysEqual(legacyReferences, entry.legacyInternalReferencesAfter);
      const canUpdate =
        (entry.oldReference ? currentReference === entry.oldReference : currentReference === "") ||
        alreadyCompliant;
      if (!canUpdate) {
        throw new Error(`Reference actuelle incompatible pour ${entry.productId}.`);
      }
      if (reservationSnapshot.exists && reservationSnapshot.data()?.productId !== entry.productId) {
        throw new Error(`Reservation en conflit: ${entry.newReference}.`);
      }
    }

    for (const { entry, productRef, reservationRef, reservationSnapshot } of liveProducts) {
      if (entry.status === "blocked") {
        throw new Error(`Produit bloque: ${entry.productId}.`);
      }
      if (!reservationSnapshot.exists) {
        transaction.set(reservationRef, {
          reference: entry.newReference,
          productId: entry.productId,
          categoryCode: entry.categoryCode,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      if (entry.status === "already_compliant") continue;
      transaction.set(
        productRef,
        {
          internalReference: entry.newReference,
          legacyInternalReferences: entry.legacyInternalReferencesAfter,
        },
        { merge: true },
      );
    }
  });
}

function planFingerprint(plan: ProductReferenceMigrationPlan) {
  const canonical = {
    version: plan.version,
    projectId: plan.projectId,
    entries: plan.entries.map((entry) => ({
      productId: entry.productId,
      oldReference: entry.oldReference,
      newReference: entry.newReference,
      legacyInternalReferencesAfter: entry.legacyInternalReferencesAfter,
      reservation: entry.reservation,
    })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function assertPlanFingerprint(plan: ProductReferenceMigrationPlan) {
  const expected = planFingerprint({ ...plan, fingerprint: "" });
  if (plan.fingerprint !== expected) {
    throw new Error("Empreinte du plan de migration invalide.");
  }
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const confirmArg = process.argv.find((arg) => arg.startsWith("--confirm="));
  const confirm = confirmArg?.slice("--confirm=".length);
  const { db, projectId } = getRequiredAdminDb();
  const result = await runProductReferenceMigration({
    db,
    projectId,
    apply,
    confirm,
  });

  console.log(`Projet Firebase: ${result.projectId}`);
  console.log(`Plan: ${result.planPath}`);
  console.log(`Empreinte: ${result.fingerprint}`);
  console.log(`toUpdate: ${result.summary.toUpdate}`);
  console.log(`alreadyCompliant: ${result.summary.alreadyCompliant}`);
  console.log(`missing: ${result.summary.missing}`);
  console.log(`blocked: ${result.summary.blocked}`);
  console.log(`written: ${result.summary.written}`);
  for (const entry of result.entries) {
    console.log(
      `${entry.productId} | ${entry.oldReference || "(aucune)"} -> ${entry.newReference} | ${entry.status}`,
    );
    if (entry.reasons.length) console.log(`  ${entry.reasons.join(" | ")}`);
  }
  if (!apply) {
    console.log(
      `Dry-run uniquement. Apply: npm.cmd run migrate:product-references-v2:apply`,
    );
  }
}

if (process.argv[1]?.endsWith("migrateProductReferencesV2.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
