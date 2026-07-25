import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FixedPriceMode, FixedPriceOption, Product, ProductCategory } from "../src/types/index.js";
import {
  fixedPriceEffectiveUnitPrice,
  fixedPriceOptionsForMode,
  normalizeFixedPriceMode,
  normalizeFixedPriceOptions,
  resolveFixedPriceOptions,
  roundMoney,
  validateManualFixedPriceOptions,
} from "../src/lib/fixedPriceOptions.js";
import { getRequiredAdminDb } from "./_firebaseAdminScript.js";

export const FIXED_PRICE_MIGRATION_PROJECT_ID = "verdanza-1f621";
export const FIXED_PRICE_MIGRATION_CONFIRMATION = "verdanza-fixed-price-v1";

export type FixedPriceMigrationConfig = {
  id: string;
  expectedCategory: ProductCategory;
  expectedPrice: number;
  fixedPriceMode: FixedPriceMode;
  fixedPriceOptions: FixedPriceOption[];
};

export type FixedPriceMigrationStatus =
  | "to_update"
  | "already_compliant"
  | "missing"
  | "blocked";

export type FixedPriceMigrationDocument = {
  id: string;
  exists: boolean;
  data?: Record<string, unknown>;
};

export type FixedPriceMigrationAnalysis = {
  id: string;
  exists: boolean;
  status: FixedPriceMigrationStatus;
  reasons: string[];
  expectedPrice: number;
  actualPrice: number | null;
  expectedCategory: ProductCategory;
  actualCategory: string | null;
  current: {
    fixedPriceMode: unknown;
    fixedPriceOptions: unknown;
  };
  proposed: {
    fixedPriceMode: FixedPriceMode;
    fixedPriceOptions: FixedPriceOption[];
  };
  payload: {
    fixedPriceMode: FixedPriceMode;
    fixedPriceOptions: FixedPriceOption[];
  } | null;
};

type FixedPriceMigrationBackupEntry = {
  documentId: string;
  existence: boolean;
  fixedPriceMode: unknown;
  fixedPriceOptions: unknown;
  proposed: FixedPriceMigrationAnalysis["proposed"];
  status: FixedPriceMigrationStatus;
  timestamp: string;
  projectId: string;
};

type FirestoreDocRefLike = {
  get: () => Promise<{ exists: boolean; id: string; data: () => Record<string, unknown> | undefined }>;
  update?: (payload: FixedPriceMigrationAnalysis["payload"]) => Promise<void>;
};

type FirestoreLike = {
  collection: (path: string) => {
    doc: (id: string) => FirestoreDocRefLike;
  };
};

export const fixedPriceFormatMigrations: FixedPriceMigrationConfig[] = [
  manual("resin-la-mousse", "resins", 2, [
    option("fixed-25-13g", 25, 13, 1),
    option("fixed-30-16g", 30, 16, 2),
    option("fixed-40-22g", 40, 22, 3),
  ]),
  manual("flower-petites-tetes-og-kush", "flowers", 4, [
    option("fixed-35-9g", 35, 9, 1),
    option("fixed-45-12g", 45, 12, 2),
    option("fixed-55-15g", 55, 15, 3),
  ]),
  manual("flower-harlequin-greenhouse", "flowers", 4, [
    option("fixed-35-9g", 35, 9, 1),
    option("fixed-45-12g", 45, 12, 2),
    option("fixed-55-15g", 55, 15, 3),
  ]),
  manual("flower-cookie-kush-indoor", "flowers", 4.5, [
    option("fixed-30-7g", 30, 7, 1),
    option("fixed-50-12g", 50, 12, 2),
  ]),
  manual("resin-golden-static", "resins", 5.5, [
    option("fixed-50-10g", 50, 10, 1),
  ]),
  {
    id: "resin-supreme-purple-cbd",
    expectedCategory: "resins",
    expectedPrice: 5,
    fixedPriceMode: "disabled",
    fixedPriceOptions: [],
  },
  ...[
    ["resin-supreme-50-cbd", "resins"],
    ["resin-le-beldia-cbn-cbd", "resins"],
    ["resin-creamy-piatella-cbd", "resins"],
    ["flower-mango-haze-cbd", "flowers"],
    ["flower-mandarine-cbd", "flowers"],
    ["flower-amnesia-cbd-hydroponique", "flowers"],
    ["flower-blue-dream-cbd", "flowers"],
  ].map(([id, category]) =>
    manual(id, category as ProductCategory, 6, [
      option("fixed-40-7g", 40, 7, 1),
      option("fixed-50-9g", 50, 9, 2),
      option("fixed-60-11g", 60, 11, 3),
    ]),
  ),
];

export async function runFixedPriceMigration({
  db,
  projectId,
  apply,
  confirm,
  backupDir = path.join("reports", "fixed-price-migration"),
  now = new Date(),
}: {
  db: FirestoreLike;
  projectId: string;
  apply: boolean;
  confirm?: string;
  backupDir?: string;
  now?: Date;
}) {
  if (projectId !== FIXED_PRICE_MIGRATION_PROJECT_ID) {
    throw new Error(
      `Projet Firebase refuse: ${projectId || "(inconnu)"} au lieu de ${FIXED_PRICE_MIGRATION_PROJECT_ID}.`,
    );
  }
  if (apply && confirm !== FIXED_PRICE_MIGRATION_CONFIRMATION) {
    throw new Error(`Ecriture refusee sans --confirm=${FIXED_PRICE_MIGRATION_CONFIRMATION}.`);
  }

  const collection = db.collection("products");
  const docs = await Promise.all(
    fixedPriceFormatMigrations.map(async (migration) => {
      const snapshot = await collection.doc(migration.id).get();
      return {
        id: migration.id,
        exists: snapshot.exists,
        data: snapshot.exists ? snapshot.data() : undefined,
      };
    }),
  );

  const analyses = docs.map((doc, index) => analyzeFixedPriceMigrationDocument(
    fixedPriceFormatMigrations[index],
    doc,
  ));
  const timestamp = now.toISOString();
  const backupPath = await writeFixedPriceMigrationBackup({
    analyses,
    projectId,
    timestamp,
    backupDir,
  });

  const blocked = analyses.filter((entry) => entry.status === "blocked" || entry.status === "missing");
  if (apply && blocked.length) {
    throw new Error(
      `Ecriture refusee: ${blocked.length} document(s) absent(s) ou bloque(s): ${blocked
        .map((entry) => entry.id)
        .join(", ")}.`,
    );
  }

  const toUpdate = analyses.filter((entry) => entry.status === "to_update");
  if (apply) {
    for (const entry of toUpdate) {
      const payload = entry.payload;
      if (!payload) throw new Error(`Payload manquant pour ${entry.id}.`);
      await collection.doc(entry.id).update(payload);
    }
  }

  return {
    projectId,
    apply,
    backupPath,
    analyses,
    summary: {
      toUpdate: toUpdate.length,
      alreadyCompliant: analyses.filter((entry) => entry.status === "already_compliant").length,
      missing: analyses.filter((entry) => entry.status === "missing").length,
      blocked: analyses.filter((entry) => entry.status === "blocked").length,
      written: apply ? toUpdate.length : 0,
    },
  };
}

export function analyzeFixedPriceMigrationDocument(
  migration: FixedPriceMigrationConfig,
  document: FixedPriceMigrationDocument,
): FixedPriceMigrationAnalysis {
  const proposed = {
    fixedPriceMode: migration.fixedPriceMode,
    fixedPriceOptions: fixedPriceOptionsForMode(
      migration.fixedPriceMode,
      migration.fixedPriceOptions,
    ),
  };
  const current = {
    fixedPriceMode: document.data?.fixedPriceMode,
    fixedPriceOptions: document.data?.fixedPriceOptions,
  };

  if (!document.exists) {
    return {
      id: migration.id,
      exists: false,
      status: "missing",
      reasons: ["Document products introuvable."],
      expectedPrice: migration.expectedPrice,
      actualPrice: null,
      expectedCategory: migration.expectedCategory,
      actualCategory: null,
      current,
      proposed,
      payload: null,
    };
  }

  const actualPrice = Number(document.data?.price);
  const actualCategory = typeof document.data?.category === "string" ? document.data.category : null;
  const reasons: string[] = [];
  if (!Number.isFinite(actualPrice) || roundMoney(actualPrice) !== migration.expectedPrice) {
    reasons.push(
      `Prix inattendu: ${Number.isFinite(actualPrice) ? actualPrice : "non numerique"} au lieu de ${migration.expectedPrice}.`,
    );
  }
  if (actualCategory !== migration.expectedCategory) {
    reasons.push(`Categorie inattendue: ${actualCategory || "absente"} au lieu de ${migration.expectedCategory}.`);
  }
  reasons.push(...validateProposedConfiguration(migration));

  if (reasons.length) {
    return {
      id: migration.id,
      exists: true,
      status: "blocked",
      reasons,
      expectedPrice: migration.expectedPrice,
      actualPrice: Number.isFinite(actualPrice) ? actualPrice : null,
      expectedCategory: migration.expectedCategory,
      actualCategory,
      current,
      proposed,
      payload: null,
    };
  }

  const currentComparable = {
    fixedPriceMode: normalizeFixedPriceMode(document.data?.fixedPriceMode, actualCategory as ProductCategory),
    fixedPriceOptions: normalizeFixedPriceOptions(document.data?.fixedPriceOptions),
  };
  const proposedComparable = {
    fixedPriceMode: proposed.fixedPriceMode,
    fixedPriceOptions: proposed.fixedPriceOptions,
  };
  const isCompliant = stableJson(currentComparable) === stableJson(proposedComparable);

  return {
    id: migration.id,
    exists: true,
    status: isCompliant ? "already_compliant" : "to_update",
    reasons: isCompliant ? ["Document deja conforme."] : ["Migration limitee aux champs fixedPriceMode et fixedPriceOptions."],
    expectedPrice: migration.expectedPrice,
    actualPrice,
    expectedCategory: migration.expectedCategory,
    actualCategory,
    current,
    proposed,
    payload: isCompliant ? null : proposed,
  };
}

export function validateProposedConfiguration(migration: FixedPriceMigrationConfig) {
  const product = productForValidation(migration);
  const issues = validateManualFixedPriceOptions(product)
    .filter((issue) => issue.severity === "error")
    .map((issue) => `${issue.optionId ? `${issue.optionId}: ` : ""}${issue.message}`);

  if (migration.fixedPriceMode === "manual") {
    const resolved = resolveFixedPriceOptions(product);
    for (const option of resolved) {
      if (option.savingAmount <= 0 || option.savingRate <= 0) {
        issues.push(`${option.id}: economie nulle ou negative.`);
      }
      if (option.savingRate > 0.1) {
        issues.push(`${option.id}: economie superieure a 10 %.`);
      }
      if (fixedPriceEffectiveUnitPrice(option) >= migration.expectedPrice) {
        issues.push(`${option.id}: prix effectif au gramme non avantageux.`);
      }
    }
  }

  return issues;
}

export function buildFixedPriceMigrationPayload(migration: FixedPriceMigrationConfig) {
  return {
    fixedPriceMode: migration.fixedPriceMode,
    fixedPriceOptions: fixedPriceOptionsForMode(migration.fixedPriceMode, migration.fixedPriceOptions),
  };
}

function manual(
  id: string,
  expectedCategory: ProductCategory,
  expectedPrice: number,
  fixedPriceOptions: FixedPriceOption[],
): FixedPriceMigrationConfig {
  return {
    id,
    expectedCategory,
    expectedPrice,
    fixedPriceMode: "manual",
    fixedPriceOptions,
  };
}

function option(id: string, totalPrice: number, quantityGrams: number, order: number): FixedPriceOption {
  return {
    id,
    totalPrice,
    quantityGrams,
    isActive: true,
    sortOrder: order,
    source: "manual",
  };
}

function productForValidation(migration: FixedPriceMigrationConfig): Product {
  return {
    id: migration.id,
    slug: migration.id,
    name: migration.id,
    category: migration.expectedCategory,
    price: migration.expectedPrice,
    fixedPriceMode: migration.fixedPriceMode,
    fixedPriceOptions: migration.fixedPriceOptions,
    shortDescription: "",
    longDescription: "",
    image: "",
    cbdRate: "",
    cbgRate: "",
    thcRate: "",
    origin: "",
    cultureType: "Autre",
    aromas: [],
    tags: [],
    stock: 100,
    lowStockThreshold: 0,
    isActive: true,
    isFeatured: false,
    seoTitle: "",
    seoDescription: "",
  };
}

async function writeFixedPriceMigrationBackup({
  analyses,
  projectId,
  timestamp,
  backupDir,
}: {
  analyses: FixedPriceMigrationAnalysis[];
  projectId: string;
  timestamp: string;
  backupDir: string;
}) {
  await mkdir(backupDir, { recursive: true });
  const filename = `fixed-price-formats-${timestamp.replace(/[:.]/g, "-")}.json`;
  const backupPath = path.join(backupDir, filename);
  const entries: FixedPriceMigrationBackupEntry[] = analyses.map((entry) => ({
    documentId: entry.id,
    existence: entry.exists,
    fixedPriceMode: entry.current.fixedPriceMode,
    fixedPriceOptions: entry.current.fixedPriceOptions,
    proposed: entry.proposed,
    status: entry.status,
    timestamp,
    projectId,
  }));
  await writeFile(
    backupPath,
    `${JSON.stringify({ projectId, timestamp, entries }, null, 2)}\n`,
    "utf8",
  );
  return backupPath;
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function cliArgs() {
  const apply = process.argv.includes("--apply");
  const confirmArg = process.argv.find((arg) => arg.startsWith("--confirm="));
  const backupDirArg = process.argv.find((arg) => arg.startsWith("--backup-dir="));
  return {
    apply,
    confirm: confirmArg?.slice("--confirm=".length),
    backupDir: backupDirArg?.slice("--backup-dir=".length),
  };
}

async function main() {
  const args = cliArgs();
  const { db, projectId } = getRequiredAdminDb();
  const result = await runFixedPriceMigration({
    db,
    projectId,
    apply: args.apply,
    confirm: args.confirm,
    backupDir: args.backupDir,
  });

  console.log(
    JSON.stringify(
      {
        projectId: result.projectId,
        mode: result.apply ? "apply" : "dry-run",
        backupPath: result.backupPath,
        summary: result.summary,
        documents: result.analyses.map((entry) => ({
          id: entry.id,
          status: entry.status,
          reasons: entry.reasons,
          expectedPrice: entry.expectedPrice,
          actualPrice: entry.actualPrice,
          expectedCategory: entry.expectedCategory,
          actualCategory: entry.actualCategory,
          current: entry.current,
          proposed: entry.proposed,
          payload: entry.payload,
        })),
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
