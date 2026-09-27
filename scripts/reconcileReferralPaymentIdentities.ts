import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { requireFirebaseAdminProjectId } from "./_firebaseAdminScript.js";
import { ORDER_EMAIL_MIGRATION_PROJECT } from "./orderEmailNormalizationMigration.js";
import { assertPaymentIdentityReconciliationTarget, reconcileReferralPaymentIdentities, REFERRAL_PAYMENT_IDENTITY_RECONCILIATION_VERSION } from "./referralPaymentIdentityReconciliation.js";
import { parseReferralEmailKeyring } from "../api/_server/referralIdentity.js";

// No implicit Production target or emulator fallback. Emulator tests use the guarded injected engine.
async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(["--apply", `--confirm=${REFERRAL_PAYMENT_IDENTITY_RECONCILIATION_VERSION}`, `--project=${ORDER_EMAIL_MIGRATION_PROJECT}`]);
  if (args.some((arg) => !allowed.has(arg)) || !args.includes(`--project=${ORDER_EMAIL_MIGRATION_PROJECT}`) || process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("payment_identity_reconciliation_arguments_invalid");
  const apply = args.includes("--apply");
  const confirmation = args.includes(`--confirm=${REFERRAL_PAYMENT_IDENTITY_RECONCILIATION_VERSION}`) ? REFERRAL_PAYMENT_IDENTITY_RECONCILIATION_VERSION : undefined;
  const projectId = requireFirebaseAdminProjectId();
  assertPaymentIdentityReconciliationTarget({ projectId, apply, confirmation });
  const keyringJson = process.env.REFERRAL_EMAIL_HMAC_KEYRING_JSON ?? "";
  parseReferralEmailKeyring(keyringJson);
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  const credential = encoded ? cert(JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))) : cert({
    projectId, clientEmail: process.env.FIREBASE_CLIENT_EMAIL!, privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
  });
  const app = initializeApp({ projectId, credential }, "referral-payment-identity-reconciliation");
  const db = getFirestore(app);
  try {
    const report = await reconcileReferralPaymentIdentities({ db, projectId, apply, confirmation, keyringJson });
    console.log(JSON.stringify(report)); // Counts only; never print identities, email aliases or SDK errors.
    if (report.unresolved || report.corrupt || report.raced) process.exitCode = 1;
  } finally { try { await db.terminate(); } finally { await deleteApp(app); } }
}
try { await main(); }
catch { console.error("payment_identity_reconciliation_failed"); process.exitCode = 1; }
