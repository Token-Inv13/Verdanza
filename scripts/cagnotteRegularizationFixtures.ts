/** TESTS ONLY. Synthetic precondition, not a spending service or purchase workflow. */
import { equal, ok } from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { validateCagnotteTestEnvironment } from "./cagnotteEmulator.js";
import { CAGNOTTE_REGULARIZATION_VERSION, CAGNOTTE_RESERVATION_VERSION } from "../api/_server/cagnotteLedgerTypes.js";

export async function fixtureSpentGain(db: Firestore, beneficiaryId: string, orderId: string, amountCents: number, programVersion: string) {
  validateCagnotteTestEnvironment(process.env);
  ok(Number.isSafeInteger(amountCents) && amountCents > 0);
  const eventKey = `fixture-consumption-${orderId}`;
  const recordedAtEpochMs = Date.now();
  await db.runTransaction(async (tx) => {
    const ref = db.collection("cagnotteWallets").doc(beneficiaryId);
    const wallet = (await tx.get(ref)).data()!;
    ok(wallet.availableCents >= amountCents);
    equal(wallet.regularizationCents, 0);
    tx.update(ref, { availableCents: wallet.availableCents - amountCents });
    tx.create(db.collection("cagnotteMovements").doc(eventKey), {
      schemaVersion: 3, regularizationVersion: CAGNOTTE_REGULARIZATION_VERSION, reservationVersion: CAGNOTTE_RESERVATION_VERSION,
      calculationVersion: "cagnotte-math-v1", programVersion, currency: "EUR",
      origin: "synthetic_test_fixture", businessEvent: "synthetic_consumption",
      orderId, beneficiaryId, eventKey, payload: "Synthetic spent-gain precondition only",
      pendingDeltaCents: 0, availableDeltaCents: -amountCents, reservedDeltaCents: 0, regularizationDeltaCents: 0,
      recordedAtEpochMs,
    });
  });
}

export async function assertWalletJournal(db: Firestore, beneficiaryId: string) {
  const wallet = (await db.collection("cagnotteWallets").doc(beneficiaryId).get()).data()!;
  const entries = (await db.collection("cagnotteMovements").where("beneficiaryId", "==", beneficiaryId).get()).docs.map((doc) => doc.data());
  for (const [field, delta] of [["pendingCents", "pendingDeltaCents"], ["availableCents", "availableDeltaCents"], ["reservedCents", "reservedDeltaCents"], ["regularizationCents", "regularizationDeltaCents"]]) {
    const total = entries.reduce((sum, entry) => {
      ok(entry.schemaVersion === 1 || entry.schemaVersion === 2 || entry.schemaVersion === 3);
      const compatibleMissing = (entry.schemaVersion === 1 && delta === "regularizationDeltaCents") ||
        ((entry.schemaVersion === 1 || entry.schemaVersion === 2) && delta === "reservedDeltaCents");
      const value = compatibleMissing && !Object.hasOwn(entry, delta) ? 0 : entry[delta];
      ok(Number.isSafeInteger(value)); return sum + BigInt(value);
    }, 0n);
    const compatibleWalletMissing = (wallet.schemaVersion === 1 && field === "regularizationCents") ||
      ((wallet.schemaVersion === 1 || wallet.schemaVersion === 2) && field === "reservedCents");
    const balance = compatibleWalletMissing && !Object.hasOwn(wallet, field) ? 0 : wallet[field];
    ok(Number.isSafeInteger(balance) && balance >= 0); equal(total, BigInt(balance));
  }
  ok(!(wallet.availableCents > 0 && wallet.regularizationCents > 0));
}
