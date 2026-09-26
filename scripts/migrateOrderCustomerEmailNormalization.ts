import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { requireFirebaseAdminProjectId } from "./_firebaseAdminScript.js";
import { assertOrderEmailMigrationTarget, migrateOrderEmailNormalization, ORDER_EMAIL_MIGRATION_PROJECT } from "./orderEmailNormalizationMigration.js";
import { ORDER_EMAIL_NORMALIZATION_VERSION } from "../api/_server/referralOrderEmailHistory.js";

// This CLI deliberately has no emulator fallback; emulator tests invoke the guarded engine.
async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(["--apply", `--confirm=${ORDER_EMAIL_NORMALIZATION_VERSION}`, `--project=${ORDER_EMAIL_MIGRATION_PROJECT}`]);
  if (args.some((arg) => !allowed.has(arg)) || !args.includes(`--project=${ORDER_EMAIL_MIGRATION_PROJECT}`) || process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("order_email_migration_arguments_invalid");
  }
  const apply = args.includes("--apply");
  const confirmation = args.includes(`--confirm=${ORDER_EMAIL_NORMALIZATION_VERSION}`) ? ORDER_EMAIL_NORMALIZATION_VERSION : undefined;
  const projectId = requireFirebaseAdminProjectId();
  assertOrderEmailMigrationTarget({ projectId, apply, confirmation });
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  const credential = encoded ? cert(JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))) : cert({
    projectId, clientEmail: process.env.FIREBASE_CLIENT_EMAIL!, privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
  });
  const app = initializeApp({ projectId, credential }, "order-email-normalization-migration");
  const db = getFirestore(app);
  try {
    const report = await migrateOrderEmailNormalization({ db, projectId, apply, confirmation });
    // Counts and outcomes only: no email, UID, code, HMAC, token or credential material.
    console.log(JSON.stringify({ version: ORDER_EMAIL_NORMALIZATION_VERSION, ...report }));
    if (report.initial.anomalies > 0 || (apply && !report.markerComplete)) process.exitCode = 1;
  } finally {
    try { await db.terminate(); } finally { await deleteApp(app); }
  }
}

try { await main(); }
catch {
  // SDK/credential exceptions may contain document paths or credential parse details.
  console.error("order_email_migration_failed");
  process.exitCode = 1;
}
