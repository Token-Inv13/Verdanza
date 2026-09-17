import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RECIPE_PROJECT_ID } from "./constants.js";
import { validateCurrentRecipeProcess } from "./environment.js";
import { closeRecipeFirestore, getRecipeFirestore } from "./firestore.js";
import {
  compareRateLimitEvidence,
  projectRateLimitEvidence,
} from "./rateLimitEvidence.js";

validateCurrentRecipeProcess();

const uid = argument("uid");
const output = resolve(argument("output"));
const db = getRecipeFirestore();

try {
  const ordersSnapshot = await db.collection("orders").where("customerId", "==", uid).get();
  const orderIds = new Set(ordersSnapshot.docs.map((document) => document.id));
  const [walletDocument, accrualsSnapshot, reservationsSnapshot, movementsSnapshot, refundsSnapshot, rateLimitsSnapshot] = await Promise.all([
    db.collection("cagnotteWallets").doc(uid).get(),
    db.collection("cagnotteAccruals").where("beneficiaryId", "==", uid).get(),
    db.collection("cagnotteReservations").where("beneficiaryId", "==", uid).get(),
    db.collection("cagnotteMovements").where("beneficiaryId", "==", uid).get(),
    db.collection("cagnotteRefunds").get(),
    db.collection("securityRateLimits").get(),
  ]);

  const evidence = {
    projectId: RECIPE_PROJECT_ID,
    uid,
    wallet: walletDocument.exists ? walletEvidence(record(walletDocument.data())) : null,
    orders: ordersSnapshot.docs.map((document) => orderEvidence(document.id, record(document.data())))
      .sort((left, right) => left.id.localeCompare(right.id)),
    accruals: accrualsSnapshot.docs.map((document) => accrualEvidence(document.id, record(document.data())))
      .sort((left, right) => left.id.localeCompare(right.id)),
    reservations: reservationsSnapshot.docs.map((document) => reservationEvidence(document.id, record(document.data())))
      .sort((left, right) => left.id.localeCompare(right.id)),
    movements: movementsSnapshot.docs.map((document) => movementEvidence(document.id, record(document.data())))
      .sort((left, right) => left.recordedAtEpochMs - right.recordedAtEpochMs || left.id.localeCompare(right.id)),
    refunds: refundsSnapshot.docs
      .filter((document) => orderIds.has(String(document.data().orderId || "")))
      .map((document) => refundEvidence(document.id, record(document.data())))
      .sort((left, right) => left.id.localeCompare(right.id)),
    rateLimits: rateLimitsSnapshot.docs
      .map((document) => projectRateLimitEvidence(document.id, record(document.data())))
      .sort(compareRateLimitEvidence),
  };
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`État de recette écrit : ${output}`);
} finally {
  await closeRecipeFirestore();
}

function argument(name: string) {
  const prefix = `--${name}=`;
  const values = process.argv.slice(2).filter((value) => value.startsWith(prefix));
  if (values.length !== 1 || !values[0].slice(prefix.length)) {
    throw new Error(`Argument unique ${prefix}<valeur> requis.`);
  }
  return values[0].slice(prefix.length);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function walletEvidence(value: Record<string, unknown>) {
  return {
    pendingCents: number(value.pendingCents),
    availableCents: number(value.availableCents),
    reservedCents: number(value.reservedCents),
    regularizationCents: number(value.regularizationCents),
  };
}

function orderEvidence(id: string, value: Record<string, unknown>) {
  const snapshot = record(record(value.cagnotte).snapshot);
  return {
    id,
    totalCents: Math.round(number(value.total) * 100),
    paymentAmountCents: Math.round(number(value.paymentAmount ?? value.total) * 100),
    paymentStatus: string(value.paymentStatus),
    orderStatus: string(value.orderStatus),
    paidAt: string(value.paidAt),
    paymentConfirmedAt: string(value.paymentConfirmedAt),
    programVersion: string(record(value.cagnotte).programVersion),
    loyaltyCents: number(snapshot.loyaltyCents),
    appliedCagnotteCents: number(snapshot.appliedCagnotteCents),
  };
}

function accrualEvidence(id: string, value: Record<string, unknown>) {
  return {
    id,
    initialGainCents: number(value.initialGainCents),
    remainingGainCents: number(value.remainingGainCents),
    compartment: string(value.compartment),
    paymentConfirmed: value.paymentConfirmed === true,
    deliveryConfirmed: value.deliveryConfirmed === true,
  };
}

function reservationEvidence(id: string, value: Record<string, unknown>) {
  return {
    id,
    amountCents: number(value.amountCents),
    state: string(value.state),
    cumulativeRestitutedCents: number(record(value.refundProjection).cumulativeRestitutedCents),
  };
}

function movementEvidence(id: string, value: Record<string, unknown>) {
  return {
    id,
    orderId: string(value.orderId),
    businessEvent: string(value.businessEvent),
    pendingDeltaCents: number(value.pendingDeltaCents),
    availableDeltaCents: number(value.availableDeltaCents),
    reservedDeltaCents: number(value.reservedDeltaCents),
    regularizationDeltaCents: number(value.regularizationDeltaCents),
    recordedAtEpochMs: number(value.recordedAtEpochMs),
  };
}

function refundEvidence(id: string, value: Record<string, unknown>) {
  const result = record(value.result);
  const correction = record(result.correction);
  const restitution = record(result.restitution);
  return {
    id,
    orderId: string(value.orderId),
    totalFinancialCents: number(result.totalFinancialCents),
    cagnotteRestitutionCents: number(result.cagnotteRestitutionCents ?? restitution.grossCents),
    cancelledGainCents: number(correction.appliedCents),
  };
}

function number(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function string(value: unknown) {
  return typeof value === "string" ? value : "";
}
