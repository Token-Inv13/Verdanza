import type { Order } from "../../src/types/index.js";
import type { Firestore, Transaction, DocumentReference } from "firebase-admin/firestore";

/** The key itself protects a document, even if its value is null or corrupt. */
export function hasCagnotteEnrollment(value: object): boolean {
  return Object.prototype.hasOwnProperty.call(value, "cagnotte");
}

export function assertOrderDeletionAllowed(order: object) {
  if (hasCagnotteEnrollment(order)) {
    throw new Error("Suppression refusee: commande inscrite cagnotte conservee pour tracabilite.");
  }
}

/** Firestore reference identity always wins over untrusted stored fields. */
export function orderFromSnapshot(snapshot: { id: string; data(): Record<string, unknown> | undefined }): Order {
  return { ...snapshot.data(), id: snapshot.id } as Order;
}

/** Maintenance deletion: recheck every document in the deleting transaction. */
export async function deleteUnenrolledOrderCandidates(input: {
  db: Firestore; orderIds: string[];
  writeAudit: (transaction: Transaction, orderRef: DocumentReference) => void;
}) {
  if (!input.orderIds.length) return;
  const refs = input.orderIds.map((id) => input.db.collection("orders").doc(id));
  await input.db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(...refs);
    for (const snapshot of snapshots) assertOrderDeletionAllowed(snapshot.data() || {});
    for (const ref of refs) {
      transaction.delete(ref);
      input.writeAudit(transaction, ref);
    }
  });
}
