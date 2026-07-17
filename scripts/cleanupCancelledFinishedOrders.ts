import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import {
  getRequiredAdminDb,
  requireConfirmationFlag,
} from "./_firebaseAdminScript.js";

const KEEP_ORDER_ID = "JRPf1akqVLBZ3wmNGqoO";
const commandName = "cleanup:orders";

type CleanupCandidate = {
  id: string;
  reason: "cancelled" | "finished";
  orderStatus?: string;
  paymentStatus?: string;
  customerEmail?: string;
  total?: number;
  createdAt?: unknown;
  data: FirebaseFirestore.DocumentData;
};

const cancelledStatuses = new Set([
  "cancelled",
  "canceled",
  "annule",
  "annulee",
  "annulé",
  "annulée",
]);

const finishedStatuses = new Set([
  "finished",
  "completed",
  "complete",
  "termine",
  "terminee",
  "terminé",
  "terminée",
]);

async function main() {
  const execute = process.argv.includes("--yes");
  const includeDelivered = process.argv.includes("--include-delivered");
  if (execute) requireConfirmationFlag(commandName);

  const { db, projectId } = getRequiredAdminDb();
  const snapshot = await db.collection("orders").get();
  const candidates: CleanupCandidate[] = [];
  let protectedOrderExistsBefore = false;

  snapshot.docs.forEach((entry) => {
    if (entry.id === KEEP_ORDER_ID) {
      protectedOrderExistsBefore = true;
      return;
    }

    const data = entry.data();
    const orderStatus = normalizeStatus(data.orderStatus);
    const paymentStatus = normalizeStatus(data.paymentStatus);
    const isCancelled =
      cancelledStatuses.has(orderStatus) || cancelledStatuses.has(paymentStatus);
    const isFinished =
      finishedStatuses.has(orderStatus) ||
      (includeDelivered && orderStatus === "delivered");

    if (!isCancelled && !isFinished) return;

    candidates.push({
      id: entry.id,
      reason: isCancelled ? "cancelled" : "finished",
      orderStatus: data.orderStatus,
      paymentStatus: data.paymentStatus,
      customerEmail: data.customerEmail,
      total: Number(data.total || 0),
      createdAt: data.createdAt,
      data,
    });
  });

  const backupPath = await writeBackup(projectId, candidates, {
    execute,
    includeDelivered,
    protectedOrderId: KEEP_ORDER_ID,
    protectedOrderExistsBefore,
  });

  console.log(`Project Firebase cible : ${projectId}`);
  console.log(`Commande protegee : ${KEEP_ORDER_ID}`);
  console.log(
    `Commande protegee trouvee avant nettoyage : ${protectedOrderExistsBefore ? "oui" : "non"}`,
  );
  console.log(`Suppression des commandes livrees incluse : ${includeDelivered ? "oui" : "non"}`);
  console.log(`Candidats a supprimer : ${candidates.length}`);
  candidates.forEach((candidate) => {
    console.log(
      `- ${candidate.id} | ${candidate.reason} | orderStatus=${candidate.orderStatus || ""} | paymentStatus=${candidate.paymentStatus || ""} | total=${candidate.total || 0}`,
    );
  });
  console.log(`Sauvegarde ecrite : ${backupPath}`);

  if (!execute) {
    console.log("Dry-run uniquement. Relancer avec --yes pour supprimer.");
    console.log(
      "Ajouter --include-delivered uniquement si les commandes livrees doivent aussi etre purgees.",
    );
    return;
  }

  const batch = db.batch();
  candidates.forEach((candidate) => {
    batch.delete(db.collection("orders").doc(candidate.id));
    batch.set(
      db.collection("adminAuditLogs").doc(),
      {
        action: "order_permanently_deleted",
        orderId: candidate.id,
        reason: candidate.reason,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: "cleanupCancelledFinishedOrders",
        protectedOrderId: KEEP_ORDER_ID,
      },
      { merge: true },
    );
  });

  if (candidates.length) await batch.commit();

  const protectedOrderAfter = await db.collection("orders").doc(KEEP_ORDER_ID).get();
  const remainingSnapshot = await db.collection("orders").get();
  const remainingCandidates = remainingSnapshot.docs.filter((entry) => {
    if (entry.id === KEEP_ORDER_ID) return false;
    const data = entry.data();
    const orderStatus = normalizeStatus(data.orderStatus);
    const paymentStatus = normalizeStatus(data.paymentStatus);
    return (
      cancelledStatuses.has(orderStatus) ||
      cancelledStatuses.has(paymentStatus) ||
      finishedStatuses.has(orderStatus) ||
      (includeDelivered && orderStatus === "delivered")
    );
  });

  console.log(`Commandes supprimees : ${candidates.length}`);
  console.log(`Commande protegee toujours presente : ${protectedOrderAfter.exists ? "oui" : "non"}`);
  console.log(`Candidats restants apres nettoyage : ${remainingCandidates.length}`);
}

function normalizeStatus(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

async function writeBackup(
  projectId: string,
  candidates: CleanupCandidate[],
  meta: Record<string, unknown>,
) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join("reports", "firestore-cleanup");
  await mkdir(directory, { recursive: true });
  const backupPath = path.join(directory, `orders-cleanup-${timestamp}.json`);
  await writeFile(
    backupPath,
    JSON.stringify(
      {
        projectId,
        createdAt: new Date().toISOString(),
        meta,
        count: candidates.length,
        candidates,
      },
      (_key, value) => {
        if (
          value &&
          typeof value === "object" &&
          "_seconds" in value &&
          "_nanoseconds" in value
        ) {
          return {
            seconds: value._seconds,
            nanoseconds: value._nanoseconds,
          };
        }
        return value;
      },
      2,
    ),
    "utf8",
  );
  return backupPath;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
