import { createHash } from "node:crypto";
import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { calculateCagnotte, CAGNOTTE_CALCULATION_VERSION, simulateCagnotteRefund } from "../../src/lib/cagnotteCalculations.js";
import type { CagnotteMovement } from "./cagnotteLedgerTypes.js";
import { CAGNOTTE_REGULARIZATION_VERSION, CAGNOTTE_RESERVATION_VERSION } from "./cagnotteLedgerTypes.js";
import {
  applyCagnotteWalletDeltas,
  prepareCagnotteLedgerOperation,
  prepareCagnotteWalletMutation,
  writeCagnotteWalletMutation,
  type CagnotteWalletMutation,
} from "./cagnotteLedger.js";
import type {
  CagnotteConsumedRefundResult,
  CagnotteReservation,
  CagnotteReservationIntent,
  CagnotteReservationIntentInput,
  CagnotteReservationResult,
  CagnotteReservationProgram,
} from "./cagnotteReservationTypes.js";
import { CAGNOTTE_CONSUMED_REFUND_VERSION } from "./cagnotteReservationTypes.js";
import type { CagnotteAccrualProgram } from "./cagnotteLedgerTypes.js";
import { assertCagnotteProgramFirebaseProject } from "./cagnotteProgram.js";

/** Normal application configuration. Only tests inject an enabled local program. */
export const CAGNOTTE_RESERVATION_PROGRAM: CagnotteReservationProgram | null = null;

type ReservationAction = "reserve" | "consume" | "release" | "cancel";

export class CagnotteReservationError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "CONFLICT" | "CORRUPT_RESERVATION" | "RESERVATIONS_DISABLED", message: string) {
    super(message);
    this.name = "CagnotteReservationError";
  }
}

export function createCagnotteReservationIntent(
  input: CagnotteReservationIntentInput,
  program: CagnotteReservationProgram | null = CAGNOTTE_RESERVATION_PROGRAM,
  firebaseProjectId?: string | null,
): CagnotteReservationIntent | null {
  if (!activeReservationProgram(program, input.createdAtEpochMs, firebaseProjectId)) return null;
  id(input.orderId);
  id(input.beneficiaryId);
  const snapshot = calculateCagnotte(input.calculation);
  const base = {
    schemaVersion: 1 as const,
    reservationVersion: CAGNOTTE_RESERVATION_VERSION,
    order: {
      orderId: input.orderId,
      beneficiaryId: input.beneficiaryId,
      programVersion: program.programVersion,
      createdAtEpochMs: input.createdAtEpochMs,
      snapshot,
    },
    amountCents: snapshot.appliedCagnotteCents,
    snapshotFingerprint: fingerprint(snapshot),
  };
  return { ...base, intentFingerprint: fingerprint(base) };
}

export function canCreateCagnotteReservation(
  program: CagnotteReservationProgram | null,
  verifiedUid: string | undefined,
  requestedCents: number,
  createdAtEpochMs: number,
  firebaseProjectId?: string | null,
) {
  if (!verifiedUid || !Number.isSafeInteger(requestedCents) || requestedCents <= 0) {
    return false;
  }
  return activeReservationProgram(program, createdAtEpochMs, firebaseProjectId);
}

export async function applyCagnotteReservationOperation(input: {
  db: Firestore;
  action: ReservationAction;
  intent: CagnotteReservationIntent;
  program?: CagnotteReservationProgram | null;
  firebaseProjectId?: string | null;
  recordedAtEpochMs?: number;
}): Promise<CagnotteReservationResult> {
  const recordedAtEpochMs = input.recordedAtEpochMs ?? Date.now();
  const intent = validatedIntent(input.intent);
  cents(recordedAtEpochMs);
  if (intent.amountCents === 0) return noWrite("not_required", "none", 0, 0).result;
  const program = input.program === undefined ? CAGNOTTE_RESERVATION_PROGRAM : input.program;
  assertCagnotteProgramFirebaseProject(program, input.firebaseProjectId);
  if (input.action === "reserve" && !activeReservationProgram(program, intent.order.createdAtEpochMs, input.firebaseProjectId)) {
    fail("RESERVATIONS_DISABLED", "Nouvelles réservations désactivées.");
  }
  return input.db.runTransaction(async (transaction) => {
    const prepared = await prepareCagnotteReservationOperation({ ...input, intent, recordedAtEpochMs, transaction });
    prepared.write();
    return prepared.result;
  });
}

export async function prepareCagnotteReservationOperation(input: {
  db: Firestore;
  transaction: Transaction;
  action: ReservationAction;
  intent: CagnotteReservationIntent;
  program?: CagnotteReservationProgram | null;
  firebaseProjectId?: string | null;
  recordedAtEpochMs: number;
  walletMutation?: CagnotteWalletMutation;
}) {
  const intent = validatedIntent(input.intent);
  cents(input.recordedAtEpochMs);
  if (intent.amountCents === 0) return noWrite("not_required", "none", 0, 0);
  const program = input.program === undefined ? CAGNOTTE_RESERVATION_PROGRAM : input.program;
  assertCagnotteProgramFirebaseProject(program, input.firebaseProjectId);
  if (input.action === "reserve" && !activeReservationProgram(program, intent.order.createdAtEpochMs, input.firebaseProjectId)) {
    fail("RESERVATIONS_DISABLED", "Nouvelles réservations désactivées.");
  }
  const reservationRef = input.db.collection("cagnotteReservations").doc(intent.order.orderId);
  const movementRefs = {
    reserve: input.db.collection("cagnotteMovements").doc(eventKey(intent.order.orderId, "credit_reserved")),
    consume: input.db.collection("cagnotteMovements").doc(eventKey(intent.order.orderId, "credit_consumed")),
    release: input.db.collection("cagnotteMovements").doc(eventKey(intent.order.orderId, "credit_released")),
  };
  const [reservationSnapshot, reserveMovement, consumeMovement, releaseMovement] = await input.transaction.getAll(
    reservationRef, movementRefs.reserve, movementRefs.consume, movementRefs.release,
  );
  if (!reservationSnapshot.exists && [reserveMovement, consumeMovement, releaseMovement].some((entry) => entry.exists)) {
    fail("CORRUPT_RESERVATION", "Mouvement présent sans réservation.");
  }
  const existing = reservationSnapshot.exists ? reservationSnapshot.data() as CagnotteReservation : null;
  if (existing) {
    const refundMovements = await readReservationRefundMovements(input.db, input.transaction, existing);
    validateReservation(existing, reservationSnapshot.id, { reserveMovement, consumeMovement, releaseMovement, refundMovements });
    if (existing.intentFingerprint !== intent.intentFingerprint || existing.snapshotFingerprint !== intent.snapshotFingerprint ||
      existing.beneficiaryId !== intent.order.beneficiaryId || existing.amountCents !== intent.amountCents ||
      existing.programVersion !== intent.order.programVersion) fail("CONFLICT", "Réservation existante avec une autre intention.");
    if (input.action === "reserve") return noWrite(`already_${existing.state}` as CagnotteReservationResult["status"], existing.state, existing.amountCents, existing.releaseCompensationCents);
    if (input.action === "consume" && existing.state === "consumed") return noWrite("already_consumed", "consumed", existing.amountCents, 0);
    if (input.action === "release" && existing.state === "released") return noWrite("already_released", "released", existing.amountCents, existing.releaseCompensationCents);
    if (input.action === "cancel" && existing.state === "consumed") return noWrite("already_consumed", "consumed", existing.amountCents, 0);
    if (input.action === "cancel" && existing.state === "released") return noWrite("already_released", "released", existing.amountCents, existing.releaseCompensationCents);
    if (existing.state !== "reserved") fail("CONFLICT", input.action === "consume" ? "Réservation libérée non consommable." : "Réservation consommée non libérable.");
    if (input.recordedAtEpochMs < existing.events.reserved.recordedAtEpochMs) {
      fail("INVALID_INPUT", "Horodatage terminal antérieur à la réservation.");
    }
  } else if (input.action !== "reserve") {
    fail("CONFLICT", "Réservation absente pour cette commande.");
  }
  if (input.action === "reserve" && program?.programVersion !== intent.order.programVersion) {
    fail("CONFLICT", "Version du programme de réservation modifiée : nouveau devis requis.");
  }

  const ownsWalletMutation = input.walletMutation === undefined;
  const walletMutation = input.walletMutation ?? await prepareCagnotteWalletMutation({
    db: input.db,
    transaction: input.transaction,
    beneficiaryId: intent.order.beneficiaryId,
    allowMissing: false,
    missingCode: "CONFLICT",
  });
  if (walletMutation.transaction !== input.transaction || walletMutation.beneficiaryId !== intent.order.beneficiaryId) {
    fail("CONFLICT", "Portefeuille partagé incompatible.");
  }
  const amount = intent.amountCents;
  let compensation = 0;
  let next: CagnotteReservation;
  let movement: CagnotteMovement;
  if (input.action === "reserve") {
    if (walletMutation.current.regularizationCents > 0) fail("CONFLICT", "Une régularisation empêche une nouvelle réservation.");
    if (walletMutation.current.availableCents < amount) fail("CONFLICT", "Solde modifié : nouveau devis requis.");
    applyCagnotteWalletDeltas(walletMutation, { availableCents: -amount, reservedCents: amount });
    const reserved = { eventKey: movementRefs.reserve.id, recordedAtEpochMs: input.recordedAtEpochMs };
    next = {
      schemaVersion: 1, reservationVersion: CAGNOTTE_RESERVATION_VERSION, calculationVersion: CAGNOTTE_CALCULATION_VERSION,
      currency: "EUR", order: intent.order, orderId: intent.order.orderId, beneficiaryId: intent.order.beneficiaryId,
      programVersion: intent.order.programVersion, amountCents: amount, intentFingerprint: intent.intentFingerprint,
      snapshotFingerprint: intent.snapshotFingerprint, state: "reserved", events: { reserved }, releaseCompensationCents: 0,
    };
    movement = reservationMovement(intent, "credit_reserved", movementRefs.reserve.id, input.recordedAtEpochMs, 0, -amount, amount, 0, 0);
  } else if (input.action === "consume") {
    applyCagnotteWalletDeltas(walletMutation, { reservedCents: -amount });
    next = { ...existing!, state: "consumed", events: { ...existing!.events, consumed: { eventKey: movementRefs.consume.id, recordedAtEpochMs: input.recordedAtEpochMs } } };
    movement = reservationMovement(intent, "credit_consumed", movementRefs.consume.id, input.recordedAtEpochMs, 0, 0, -amount, 0, 0);
  } else {
    compensation = Math.min(walletMutation.current.regularizationCents, amount);
    applyCagnotteWalletDeltas(walletMutation, { availableCents: amount - compensation, reservedCents: -amount, regularizationCents: -compensation });
    next = { ...existing!, state: "released", events: { ...existing!.events, released: { eventKey: movementRefs.release.id, recordedAtEpochMs: input.recordedAtEpochMs } }, releaseCompensationCents: compensation };
    movement = reservationMovement(intent, "credit_released", movementRefs.release.id, input.recordedAtEpochMs, 0, amount - compensation, -amount, -compensation, compensation);
  }
  canonical(next); canonical(movement); canonical(walletMutation.current);
  let written = false;
  return {
    result: { status: input.action === "reserve" ? "reserved" : input.action === "consume" ? "consumed" : "released", state: next.state, amountCents: amount, compensationCents: compensation } as CagnotteReservationResult,
    walletMutation,
    write() {
      if (written) fail("INVALID_INPUT", "Plan de réservation déjà écrit.");
      written = true;
      if (existing) input.transaction.set(reservationRef, next);
      else input.transaction.create(reservationRef, next);
      input.transaction.create(movementRefs[input.action === "cancel" ? "release" : input.action], movement);
      if (ownsWalletMutation) writeCagnotteWalletMutation(walletMutation);
    },
  };
}

/** Cancellation closes the gain and either releases an open reservation or leaves a consumed one untouched. */
export async function prepareCagnotteCancellationComposition(input: {
  db: Firestore;
  transaction: Transaction;
  intent: CagnotteReservationIntent;
  accrualProgram: CagnotteAccrualProgram | null;
  reservationProgram: CagnotteReservationProgram | null;
  firebaseProjectId?: string | null;
  recordedAtEpochMs: number;
}) {
  const intent = validatedIntent(input.intent);
  const walletMutation = await prepareCagnotteWalletMutation({
    db: input.db,
    transaction: input.transaction,
    beneficiaryId: intent.order.beneficiaryId,
    allowMissing: false,
    missingCode: "CONFLICT",
  });
  const reservationPlan = await prepareCagnotteReservationOperation({
    db: input.db,
    transaction: input.transaction,
    action: "cancel",
    intent,
    program: input.reservationProgram,
    firebaseProjectId: input.firebaseProjectId,
    recordedAtEpochMs: input.recordedAtEpochMs,
    walletMutation,
  });
  const ledgerPlan = await prepareCagnotteLedgerOperation({
    db: input.db,
    transaction: input.transaction,
    program: input.accrualProgram,
    firebaseProjectId: input.firebaseProjectId,
    recordedAtEpochMs: input.recordedAtEpochMs,
    walletMutation,
    command: { order: intent.order, event: "cancelled" },
  });
  let written = false;
  return {
    reservation: reservationPlan.result,
    ledger: ledgerPlan.result,
    walletAfter: structuredClone(walletMutation.current),
    write() {
      if (written) fail("INVALID_INPUT", "Composition d’annulation déjà écrite.");
      written = true;
      reservationPlan.write();
      ledgerPlan.write();
      if (
        reservationPlan.result.status === "released" ||
        ledgerPlan.result.status === "applied"
      ) {
        writeCagnotteWalletMutation(walletMutation);
      }
    },
  };
}

/** Future endpoint helper: reservation consumption and gain share one wallet write. */
export async function prepareCagnottePaymentComposition(input: {
  db: Firestore;
  transaction: Transaction;
  intent: CagnotteReservationIntent;
  accrualProgram: CagnotteAccrualProgram | null;
  reservationProgram: CagnotteReservationProgram | null;
  firebaseProjectId?: string | null;
  delivered: boolean;
  recordedAtEpochMs: number;
}) {
  const intent = validatedIntent(input.intent);
  const amount = intent.amountCents;
  const walletMutation = amount > 0 ? await prepareCagnotteWalletMutation({
    db: input.db, transaction: input.transaction, beneficiaryId: intent.order.beneficiaryId, allowMissing: false, missingCode: "CONFLICT",
  }) : undefined;
  const reservationPlan = await prepareCagnotteReservationOperation({
    db: input.db, transaction: input.transaction, action: "consume", intent, program: input.reservationProgram,
    firebaseProjectId: input.firebaseProjectId,
    recordedAtEpochMs: input.recordedAtEpochMs, ...(walletMutation ? { walletMutation } : {}),
  });
  const ledgerPlan = await prepareCagnotteLedgerOperation({
    db: input.db, transaction: input.transaction, program: input.accrualProgram,
    firebaseProjectId: input.firebaseProjectId, recordedAtEpochMs: input.recordedAtEpochMs,
    ...(walletMutation ? { walletMutation } : {}),
    command: { order: intent.order, event: input.delivered ? "payment_and_delivery_confirmed" : "payment_confirmed" },
  });
  const reservationApplied = reservationPlan.result.status === "consumed";
  const reservationReplayed = reservationPlan.result.status === "already_consumed" || reservationPlan.result.status === "not_required";
  const ledgerApplied = ledgerPlan.result.status === "applied";
  const ledgerReplayed = ledgerPlan.result.status === "already_applied" || ledgerPlan.result.status === "not_eligible";
  if ((!reservationApplied && !reservationReplayed) || (!ledgerApplied && !ledgerReplayed) ||
    (reservationApplied && ledgerPlan.result.status === "already_applied") ||
    (reservationPlan.result.status === "already_consumed" && ledgerApplied)) {
    fail("CONFLICT", "État de paiement, réservation et gain incohérent.");
  }
  let written = false;
  return {
    reservation: reservationPlan.result,
    ledger: ledgerPlan.result,
    walletAfter: walletMutation ? structuredClone(walletMutation.current) : null,
    write() {
      if (written) fail("INVALID_INPUT", "Composition de paiement déjà écrite.");
      written = true;
      reservationPlan.write();
      ledgerPlan.write();
      if (walletMutation && (reservationApplied || ledgerApplied)) writeCagnotteWalletMutation(walletMutation);
    },
  };
}

/** Read and validate the consumed reservation and its confirmed-refund projection. */
export async function readCagnotteConsumedRefundBasis(input: {
  db: Firestore;
  transaction: Transaction;
  intent: CagnotteReservationIntent;
}) {
  const intent = validatedIntent(input.intent);
  if (intent.amountCents <= 0) fail("INVALID_INPUT", "Restitution sans cagnotte consommée.");
  const reservationRef = input.db.collection("cagnotteReservations").doc(intent.order.orderId);
  const refs = reservationMovementRefs(input.db, intent.order.orderId);
  const [reservationSnapshot, reserveMovement, consumeMovement, releaseMovement] = await input.transaction.getAll(
    reservationRef, refs.reserve, refs.consume, refs.release,
  );
  if (!reservationSnapshot.exists) fail("CONFLICT", "Réservation absente pour cette commande.");
  const reservation = reservationSnapshot.data() as CagnotteReservation;
  const refundMovements = await readReservationRefundMovements(input.db, input.transaction, reservation);
  validateReservation(reservation, reservationSnapshot.id, { reserveMovement, consumeMovement, releaseMovement, refundMovements });
  assertReservationIntent(reservation, intent);
  if (reservation.state !== "consumed") fail("CONFLICT", "Seule une réservation consommée peut être restituée.");
  return {
    reservation,
    cumulativeRestitutedCents: reservation.refundProjection?.cumulativeRestitutedCents ?? 0,
    movementIds: reservation.refundProjection?.events.map((event) => event.eventKey) ?? [],
  };
}

/**
 * Correct loyalty, restitute consumed credit, compensate regularization, then write
 * the wallet once. The reservation remains terminally consumed.
 */
export async function prepareCagnotteRefundComposition(input: {
  db: Firestore;
  transaction: Transaction;
  intent: CagnotteReservationIntent;
  refundId: string;
  additionalReturns: readonly { lineId: string; additionalNetCents: number }[];
  grossRestitutionCents: number;
  correctLoyalty: boolean;
  remainingGainCentsWhenSkipped: number;
  recordedAtEpochMs: number;
}) {
  const intent = validatedIntent(input.intent);
  id(input.refundId);
  cents(input.grossRestitutionCents);
  cents(input.remainingGainCentsWhenSkipped);
  const consumedBasis = await readCagnotteConsumedRefundBasis({
    db: input.db, transaction: input.transaction, intent,
  });
  const walletMutation = await prepareCagnotteWalletMutation({
    db: input.db, transaction: input.transaction, beneficiaryId: intent.order.beneficiaryId,
    allowMissing: false, missingCode: "CONFLICT",
  });
  const ledgerPlan = input.correctLoyalty && input.additionalReturns.length
    ? await prepareCagnotteLedgerOperation({
        db: input.db, transaction: input.transaction, program: null,
        recordedAtEpochMs: input.recordedAtEpochMs, walletMutation,
        command: { order: intent.order, event: "refund_confirmed", refundId: input.refundId,
          additionalReturns: input.additionalReturns },
      })
    : null;
  if (ledgerPlan && (ledgerPlan.result.status !== "applied" || !ledgerPlan.refundEffect)) {
    fail("CONFLICT", "Correction de fidélité non rapprochable.");
  }
  const restitutionPlan = input.grossRestitutionCents > 0
    ? await prepareCagnotteConsumedRefundOperation({
        db: input.db, transaction: input.transaction, intent, refundId: input.refundId,
        grossRestitutionCents: input.grossRestitutionCents,
        recordedAtEpochMs: input.recordedAtEpochMs, walletMutation,
      })
    : null;
  const loyaltyEffect = ledgerPlan?.refundEffect ?? {
    pendingDeltaCents: 0, availableDeltaCents: 0, regularizationDeltaCents: 0,
    remainingGainCents: input.remainingGainCentsWhenSkipped,
  };
  let written = false;
  return {
    loyalty: ledgerPlan?.result ?? null,
    loyaltyEffect,
    restitution: restitutionPlan?.result ?? {
      status: "restituted", state: "consumed", grossRestitutionCents: 0,
      compensationCents: 0, availableIncreaseCents: 0,
      cumulativeRestitutedCents: consumedBasis.cumulativeRestitutedCents,
      movementIds: [],
    } satisfies CagnotteConsumedRefundResult,
    walletAfter: structuredClone(walletMutation.current),
    movementIds: [...(ledgerPlan?.result.movementIds ?? []), ...(restitutionPlan?.result.movementIds ?? [])],
    write() {
      if (written) fail("INVALID_INPUT", "Composition de remboursement déjà écrite.");
      written = true;
      ledgerPlan?.write();
      restitutionPlan?.write();
      if (ledgerPlan || restitutionPlan?.result.status === "restituted") writeCagnotteWalletMutation(walletMutation);
    },
  };
}

async function prepareCagnotteConsumedRefundOperation(input: {
  db: Firestore;
  transaction: Transaction;
  intent: CagnotteReservationIntent;
  refundId: string;
  grossRestitutionCents: number;
  recordedAtEpochMs: number;
  walletMutation: CagnotteWalletMutation;
}) {
  const intent = validatedIntent(input.intent);
  id(input.refundId);
  cents(input.grossRestitutionCents);
  cents(input.recordedAtEpochMs);
  if (input.grossRestitutionCents <= 0) fail("INVALID_INPUT", "Restitution de cagnotte vide.");
  if (input.walletMutation.transaction !== input.transaction || input.walletMutation.beneficiaryId !== intent.order.beneficiaryId) {
    fail("CONFLICT", "Portefeuille partagé incompatible.");
  }
  const reservationRef = input.db.collection("cagnotteReservations").doc(intent.order.orderId);
  const refs = reservationMovementRefs(input.db, intent.order.orderId);
  const refundKey = eventKey(intent.order.orderId, "credit_refunded_after_return", input.refundId);
  const refundRef = input.db.collection("cagnotteMovements").doc(refundKey);
  const [reservationSnapshot, reserveMovement, consumeMovement, releaseMovement, refundMovement] = await input.transaction.getAll(
    reservationRef, refs.reserve, refs.consume, refs.release, refundRef,
  );
  if (!reservationSnapshot.exists) fail("CONFLICT", "Réservation absente pour cette commande.");
  const reservation = reservationSnapshot.data() as CagnotteReservation;
  const projectedMovements = await readReservationRefundMovements(input.db, input.transaction, reservation, refundKey);
  const refundMovements = refundMovement.exists
    ? [refundMovement, ...projectedMovements.filter((doc) => doc.id !== refundMovement.id)]
    : projectedMovements;
  validateReservation(reservation, reservationSnapshot.id, { reserveMovement, consumeMovement, releaseMovement, refundMovements });
  assertReservationIntent(reservation, intent);
  if (reservation.state !== "consumed" || !reservation.events.consumed) {
    fail("CONFLICT", "Seule une réservation consommée peut être restituée.");
  }
  const priorEvent = reservation.refundProjection?.events.find((event) => event.refundId === input.refundId);
  if (refundMovement.exists || priorEvent) {
    if (!refundMovement.exists || !priorEvent || priorEvent.eventKey !== refundKey ||
      priorEvent.grossRestitutionCents !== input.grossRestitutionCents) {
      fail("CONFLICT", "Référence de restitution réutilisée avec un autre contenu.");
    }
    return noWriteConsumedRefund(priorEvent, reservation.refundProjection!.cumulativeRestitutedCents);
  }
  if (input.recordedAtEpochMs < reservation.events.consumed.recordedAtEpochMs) {
    fail("INVALID_INPUT", "Restitution antérieure à la consommation.");
  }
  const previous = reservation.refundProjection?.cumulativeRestitutedCents ?? 0;
  const cumulative = addCents(previous, input.grossRestitutionCents);
  if (cumulative > reservation.amountCents) fail("CONFLICT", "Restitution supérieure au crédit consommé.");
  const compensation = Math.min(input.walletMutation.current.regularizationCents, input.grossRestitutionCents);
  const availableIncrease = input.grossRestitutionCents - compensation;
  applyCagnotteWalletDeltas(input.walletMutation, {
    availableCents: availableIncrease,
    regularizationCents: -compensation,
  });
  const refundEvent = {
    refundId: input.refundId,
    eventKey: refundKey,
    grossRestitutionCents: input.grossRestitutionCents,
    compensationCents: compensation,
    recordedAtEpochMs: input.recordedAtEpochMs,
  };
  const next: CagnotteReservation = {
    ...reservation,
    state: "consumed",
    refundProjection: {
      schemaVersion: 1,
      version: CAGNOTTE_CONSUMED_REFUND_VERSION,
      cumulativeRestitutedCents: cumulative,
      events: [...(reservation.refundProjection?.events ?? []), refundEvent],
    },
  };
  const movement = reservationRefundMovement(intent, refundEvent, availableIncrease, compensation);
  canonical(next); canonical(movement); canonical(input.walletMutation.current);
  let written = false;
  return {
    result: {
      status: "restituted", state: "consumed", grossRestitutionCents: input.grossRestitutionCents,
      compensationCents: compensation, availableIncreaseCents: availableIncrease,
      cumulativeRestitutedCents: cumulative, movementIds: [refundKey],
    } as CagnotteConsumedRefundResult,
    write() {
      if (written) fail("INVALID_INPUT", "Plan de restitution déjà écrit.");
      written = true;
      input.transaction.set(reservationRef, next);
      input.transaction.create(refundRef, movement);
    },
  };
}

function reservationMovement(
  intent: CagnotteReservationIntent,
  businessEvent: "credit_reserved" | "credit_consumed" | "credit_released",
  key: string,
  recordedAtEpochMs: number,
  pendingDeltaCents: number,
  availableDeltaCents: number,
  reservedDeltaCents: number,
  regularizationDeltaCents: number,
  compensationCents: number,
): CagnotteMovement {
  return {
    schemaVersion: 3, regularizationVersion: CAGNOTTE_REGULARIZATION_VERSION, reservationVersion: CAGNOTTE_RESERVATION_VERSION,
    calculationVersion: intent.order.snapshot.calculationVersion, programVersion: intent.order.programVersion,
    currency: "EUR", origin: "internal_server", orderId: intent.order.orderId, beneficiaryId: intent.order.beneficiaryId,
    businessEvent, eventKey: key,
    payload: canonical({ event: businessEvent, intentFingerprint: intent.intentFingerprint, amountCents: intent.amountCents, compensationCents }),
    pendingDeltaCents, availableDeltaCents, reservedDeltaCents, regularizationDeltaCents, recordedAtEpochMs,
  };
}

function reservationRefundMovement(
  intent: CagnotteReservationIntent,
  event: { refundId: string; eventKey: string; grossRestitutionCents: number; compensationCents: number; recordedAtEpochMs: number },
  availableIncreaseCents: number,
  compensationCents: number,
): CagnotteMovement {
  return {
    schemaVersion: 3,
    regularizationVersion: CAGNOTTE_REGULARIZATION_VERSION,
    reservationVersion: CAGNOTTE_RESERVATION_VERSION,
    calculationVersion: intent.order.snapshot.calculationVersion,
    programVersion: intent.order.programVersion,
    currency: "EUR",
    origin: "internal_server",
    orderId: intent.order.orderId,
    beneficiaryId: intent.order.beneficiaryId,
    businessEvent: "credit_refunded_after_return",
    eventKey: event.eventKey,
    payload: canonical({
      event: "credit_refunded_after_return",
      refundId: event.refundId,
      intentFingerprint: intent.intentFingerprint,
      grossRestitutionCents: event.grossRestitutionCents,
      compensationCents,
    }),
    pendingDeltaCents: 0,
    availableDeltaCents: availableIncreaseCents,
    reservedDeltaCents: 0,
    regularizationDeltaCents: -compensationCents,
    recordedAtEpochMs: event.recordedAtEpochMs,
  };
}

export function validateCagnotteReservationIntent(value: unknown) {
  const candidate = value as CagnotteReservationIntent;
  return validatedIntent(candidate);
}

function validatedIntent(value: CagnotteReservationIntent) {
  canonical(value);
  if (!value || typeof value !== "object" || !value.order || typeof value.order !== "object" || !value.order.snapshot ||
    value.schemaVersion !== 1 || value.reservationVersion !== CAGNOTTE_RESERVATION_VERSION ||
    value.order.snapshot.calculationVersion !== CAGNOTTE_CALCULATION_VERSION || value.amountCents !== value.order.snapshot.appliedCagnotteCents ||
    value.snapshotFingerprint !== fingerprint(value.order.snapshot) || value.intentFingerprint !== fingerprint({
      schemaVersion: value.schemaVersion, reservationVersion: value.reservationVersion, order: value.order,
      amountCents: value.amountCents, snapshotFingerprint: value.snapshotFingerprint,
    })) fail("INVALID_INPUT", "Intention de réservation invalide.");
  id(value.order.orderId); id(value.order.beneficiaryId); id(value.order.programVersion);
  cents(value.order.createdAtEpochMs); cents(value.amountCents);
  simulateCagnotteRefund(value.order.snapshot, [], []);
  if (value.amountCents > 0 && (value.order.snapshot.compatibility.status !== "allowed" ||
    value.order.snapshot.compatibility.blockingAdvantages.length > 0 || value.order.snapshot.compatibility.pendingAdvantages.length > 0)) {
    fail("INVALID_INPUT", "Cumul d’avantages non validé.");
  }
  return JSON.parse(canonical(value)) as CagnotteReservationIntent;
}

function validateReservation(
  value: CagnotteReservation,
  documentId: string,
  movements: {
    reserveMovement: DocumentSnapshot;
    consumeMovement: DocumentSnapshot;
    releaseMovement: DocumentSnapshot;
    refundMovements: DocumentSnapshot[];
  },
) {
  try { canonical(value); } catch { fail("CORRUPT_RESERVATION", "Réservation persistée non canonique."); }
  if (!value || typeof value !== "object" || !value.order || typeof value.order !== "object" || !value.order.snapshot ||
    !value.events || typeof value.events !== "object" ||
    value.schemaVersion !== 1 || value.reservationVersion !== CAGNOTTE_RESERVATION_VERSION || value.calculationVersion !== CAGNOTTE_CALCULATION_VERSION ||
    value.currency !== "EUR" || value.orderId !== documentId || !["reserved", "consumed", "released"].includes(value.state) ||
    !Number.isSafeInteger(value.amountCents) || value.amountCents <= 0 || !Number.isSafeInteger(value.releaseCompensationCents) ||
    value.releaseCompensationCents < 0 || value.releaseCompensationCents > value.amountCents ||
    typeof value.intentFingerprint !== "string" || !value.intentFingerprint ||
    typeof value.snapshotFingerprint !== "string" || !value.snapshotFingerprint ||
    !validId(value.orderId) || !validId(value.beneficiaryId) || !validId(value.programVersion) ||
    value.order.orderId !== value.orderId || value.order.beneficiaryId !== value.beneficiaryId ||
    value.order.programVersion !== value.programVersion || !Number.isSafeInteger(value.order.createdAtEpochMs) || value.order.createdAtEpochMs < 0 ||
    value.order.snapshot.calculationVersion !== value.calculationVersion || value.amountCents !== value.order.snapshot.appliedCagnotteCents ||
    value.snapshotFingerprint !== fingerprint(value.order.snapshot) || value.intentFingerprint !== fingerprint({
      schemaVersion: 1, reservationVersion: value.reservationVersion, order: value.order,
      amountCents: value.amountCents, snapshotFingerprint: value.snapshotFingerprint,
    })) fail("CORRUPT_RESERVATION", "Réservation persistée invalide.");
  try { simulateCagnotteRefund(value.order.snapshot, [], []); } catch { fail("CORRUPT_RESERVATION", "Instantané de réservation invalide."); }
  const expectedEventKeys = value.state === "reserved" ? ["reserved"] : value.state === "consumed" ? ["consumed", "reserved"] : ["released", "reserved"];
  if (Object.keys(value.events).sort().join(",") !== expectedEventKeys.join(",")) fail("CORRUPT_RESERVATION", "Marqueurs de réservation inattendus.");
  for (const marker of Object.values(value.events)) {
    if (!marker || typeof marker.eventKey !== "string" || !marker.eventKey ||
      !Number.isSafeInteger(marker.recordedAtEpochMs) || marker.recordedAtEpochMs < 0) {
      fail("CORRUPT_RESERVATION", "Marqueur de réservation invalide.");
    }
  }
  const terminalMarker = value.events.consumed ?? value.events.released;
  if (terminalMarker && terminalMarker.recordedAtEpochMs < value.events.reserved.recordedAtEpochMs) fail("CORRUPT_RESERVATION", "Chronologie de réservation invalide.");
  const expected = value.state === "reserved" ? [true, false, false] : value.state === "consumed" ? [true, true, false] : [true, false, true];
  const actual = [movements.reserveMovement.exists, movements.consumeMovement.exists, movements.releaseMovement.exists];
  if (expected.some((entry, index) => entry !== actual[index]) ||
    Boolean(value.events.consumed) !== (value.state === "consumed") || Boolean(value.events.released) !== (value.state === "released") ||
    (value.state !== "released" && value.releaseCompensationCents !== 0)) fail("CORRUPT_RESERVATION", "État terminal ou journal de réservation incohérent.");
  validateReservationMovement(movements.reserveMovement, value, "credit_reserved", value.events.reserved, 0);
  if (value.events.consumed) validateReservationMovement(movements.consumeMovement, value, "credit_consumed", value.events.consumed, 0);
  if (value.events.released) validateReservationMovement(movements.releaseMovement, value, "credit_released", value.events.released, value.releaseCompensationCents);
  validateRefundProjection(value, movements.refundMovements);
}

function validateReservationMovement(snapshot: DocumentSnapshot, reservation: CagnotteReservation, event: "credit_reserved" | "credit_consumed" | "credit_released", marker: { eventKey: string; recordedAtEpochMs: number }, compensation: number) {
  const movement = snapshot.data() as CagnotteMovement;
  const amount = reservation.amountCents;
  const expected = event === "credit_reserved" ? [0, -amount, amount, 0]
    : event === "credit_consumed" ? [0, 0, -amount, 0]
      : [0, amount - compensation, -amount, -compensation];
  if (!snapshot.exists || snapshot.id !== marker.eventKey || snapshot.id !== eventKey(reservation.orderId, event) || movement.schemaVersion !== 3 || movement.reservationVersion !== CAGNOTTE_RESERVATION_VERSION ||
    movement.regularizationVersion !== CAGNOTTE_REGULARIZATION_VERSION || movement.businessEvent !== event || movement.eventKey !== snapshot.id ||
    movement.orderId !== reservation.orderId || movement.beneficiaryId !== reservation.beneficiaryId || movement.programVersion !== reservation.programVersion ||
    movement.calculationVersion !== reservation.calculationVersion || movement.currency !== "EUR" || movement.origin !== "internal_server" ||
    movement.recordedAtEpochMs !== marker.recordedAtEpochMs ||
    movement.payload !== canonical({ event, intentFingerprint: reservation.intentFingerprint, amountCents: amount, compensationCents: compensation }) ||
    [movement.pendingDeltaCents, movement.availableDeltaCents, movement.reservedDeltaCents, movement.regularizationDeltaCents].some((entry, index) => entry !== expected[index])) {
    fail("CORRUPT_RESERVATION", "Mouvement de réservation invalide.");
  }
}

function noWrite(status: CagnotteReservationResult["status"], state: CagnotteReservationResult["state"], amountCents: number, compensationCents: number) {
  return { result: { status, state, amountCents, compensationCents } as CagnotteReservationResult, walletMutation: null, write() { /* Idempotent or zero operation. */ } };
}

function noWriteConsumedRefund(
  event: { grossRestitutionCents: number; compensationCents: number; eventKey: string },
  cumulativeRestitutedCents: number,
) {
  return {
    result: {
      status: "already_restituted",
      state: "consumed",
      grossRestitutionCents: event.grossRestitutionCents,
      compensationCents: event.compensationCents,
      availableIncreaseCents: event.grossRestitutionCents - event.compensationCents,
      cumulativeRestitutedCents,
      movementIds: [event.eventKey],
    } as CagnotteConsumedRefundResult,
    write() { /* Idempotent restitution. */ },
  };
}

function reservationMovementRefs(db: Firestore, orderId: string) {
  return {
    reserve: db.collection("cagnotteMovements").doc(eventKey(orderId, "credit_reserved")),
    consume: db.collection("cagnotteMovements").doc(eventKey(orderId, "credit_consumed")),
    release: db.collection("cagnotteMovements").doc(eventKey(orderId, "credit_released")),
  };
}

async function readReservationRefundMovements(
  db: Firestore,
  transaction: Transaction,
  reservation: CagnotteReservation,
  excludeEventKey?: string,
) {
  const projection = reservation?.refundProjection;
  if (projection === undefined) return [];
  if (!projection || typeof projection !== "object" || projection.schemaVersion !== 1 ||
    projection.version !== CAGNOTTE_CONSUMED_REFUND_VERSION || !Array.isArray(projection.events)) {
    fail("CORRUPT_RESERVATION", "Projection de restitution invalide.");
  }
  const keys = projection.events.map((event) => {
    if (!event || typeof event !== "object" || typeof event.eventKey !== "string" ||
      !/^[a-f0-9]{64}$/.test(event.eventKey)) {
      fail("CORRUPT_RESERVATION", "Référence de restitution invalide.");
    }
    return event.eventKey;
  });
  for (const correction of projection.corrections ?? []) {
    if (correction.eventKey !== undefined) {
      if (typeof correction.eventKey !== "string" || !/^[a-f0-9]{64}$/.test(correction.eventKey)) {
        fail("CORRUPT_RESERVATION", "Référence de correction de restitution invalide.");
      }
      keys.push(correction.eventKey);
    }
  }
  if (new Set(keys).size !== keys.length) fail("CORRUPT_RESERVATION", "Restitution dupliquée dans la projection.");
  const refs = keys.filter((key) => key !== excludeEventKey).map((key) => db.collection("cagnotteMovements").doc(key));
  return refs.length ? transaction.getAll(...refs) : [];
}

function assertReservationIntent(reservation: CagnotteReservation, intent: CagnotteReservationIntent) {
  if (reservation.intentFingerprint !== intent.intentFingerprint ||
    reservation.snapshotFingerprint !== intent.snapshotFingerprint ||
    reservation.beneficiaryId !== intent.order.beneficiaryId ||
    reservation.amountCents !== intent.amountCents ||
    reservation.programVersion !== intent.order.programVersion) {
    fail("CONFLICT", "Réservation existante avec une autre intention.");
  }
}

function validateRefundProjection(reservation: CagnotteReservation, snapshots: DocumentSnapshot[]) {
  const projection = reservation.refundProjection;
  if (projection === undefined) {
    if (snapshots.length) fail("CORRUPT_RESERVATION", "Mouvement de restitution sans projection.");
    return;
  }
  if (reservation.state !== "consumed" || !reservation.events.consumed || projection.schemaVersion !== 1 ||
    projection.version !== CAGNOTTE_CONSUMED_REFUND_VERSION || !Array.isArray(projection.events) ||
    (projection.corrections !== undefined && !Array.isArray(projection.corrections)) ||
    !Number.isSafeInteger(projection.cumulativeRestitutedCents) || projection.cumulativeRestitutedCents < 0 ||
    projection.cumulativeRestitutedCents > reservation.amountCents || snapshots.length !== projection.events.length +
      (projection.corrections ?? []).filter((correction) => correction?.eventKey !== undefined).length) {
    fail("CORRUPT_RESERVATION", "Projection de restitution incohérente.");
  }
  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const refundIds = new Set<string>();
  const eventKeys = new Set<string>();
  let cumulative = 0;
  for (const event of projection.events) {
    if (!event || typeof event !== "object" || !validId(event.refundId) ||
      typeof event.eventKey !== "string" || !/^[a-f0-9]{64}$/.test(event.eventKey) ||
      event.eventKey !== eventKey(reservation.orderId, "credit_refunded_after_return", event.refundId) ||
      !Number.isSafeInteger(event.grossRestitutionCents) || event.grossRestitutionCents <= 0 ||
      !Number.isSafeInteger(event.compensationCents) || event.compensationCents < 0 ||
      event.compensationCents > event.grossRestitutionCents ||
      !Number.isSafeInteger(event.recordedAtEpochMs) || event.recordedAtEpochMs < reservation.events.consumed.recordedAtEpochMs ||
      refundIds.has(event.refundId) || eventKeys.has(event.eventKey)) {
      fail("CORRUPT_RESERVATION", "Événement de restitution invalide.");
    }
    refundIds.add(event.refundId);
    eventKeys.add(event.eventKey);
    cumulative = addCents(cumulative, event.grossRestitutionCents);
    validateReservationRefundMovement(snapshotById.get(event.eventKey), reservation, event);
  }
  const correctionIds = new Set<string>();
  const revisionsByRefund = new Map<string, number>();
  for (const correction of projection.corrections ?? []) {
    if (!correction || typeof correction !== "object" || !validId(correction.correctionId) ||
      !/^[a-f0-9]{64}$/.test(correction.targetRefundId) || !Number.isSafeInteger(correction.revision) || correction.revision < 1 ||
      !Number.isSafeInteger(correction.restitutionDeltaCents) ||
      !Number.isSafeInteger(correction.compensationCents) || correction.compensationCents < 0 ||
      correction.compensationCents > Math.max(0, correction.restitutionDeltaCents) ||
      !Number.isSafeInteger(correction.recordedAtEpochMs) || correction.recordedAtEpochMs < reservation.events.consumed.recordedAtEpochMs ||
      correctionIds.has(correction.correctionId) ||
      (correction.restitutionDeltaCents === 0) !== (correction.eventKey === undefined)) {
      fail("CORRUPT_RESERVATION", "Correction de restitution invalide.");
    }
    const expectedRevision = (revisionsByRefund.get(correction.targetRefundId) ?? 0) + 1;
    if (!refundIds.has(correction.targetRefundId) || correction.revision !== expectedRevision ||
      (correction.eventKey !== undefined && eventKeys.has(correction.eventKey))) {
      fail("CORRUPT_RESERVATION", "Chaîne de correction de restitution invalide.");
    }
    correctionIds.add(correction.correctionId);
    revisionsByRefund.set(correction.targetRefundId, correction.revision);
    if (correction.eventKey) eventKeys.add(correction.eventKey);
    cumulative += correction.restitutionDeltaCents;
    if (!Number.isSafeInteger(cumulative) || cumulative < 0 || cumulative > reservation.amountCents) {
      fail("CORRUPT_RESERVATION", "Cumul corrigé de restitution incohérent.");
    }
    if (correction.eventKey) validateReservationRefundCorrectionMovement(snapshotById.get(correction.eventKey), reservation, correction);
  }
  if (cumulative !== projection.cumulativeRestitutedCents || snapshotById.size !== eventKeys.size) {
    fail("CORRUPT_RESERVATION", "Cumul de restitution incohérent.");
  }
}

function validateReservationRefundCorrectionMovement(
  snapshot: DocumentSnapshot | undefined,
  reservation: CagnotteReservation,
  correction: NonNullable<NonNullable<CagnotteReservation["refundProjection"]>["corrections"]>[number],
) {
  const movement = snapshot?.data() as CagnotteMovement | undefined;
  const availableDelta = correction.restitutionDeltaCents > 0
    ? correction.restitutionDeltaCents - correction.compensationCents
    : correction.restitutionDeltaCents;
  if (!snapshot?.exists || !movement || snapshot.id !== correction.eventKey || movement.schemaVersion !== 3 ||
    movement.reservationVersion !== CAGNOTTE_RESERVATION_VERSION || movement.regularizationVersion !== CAGNOTTE_REGULARIZATION_VERSION ||
    movement.businessEvent !== "credit_refund_corrected" || movement.eventKey !== correction.eventKey ||
    movement.orderId !== reservation.orderId || movement.beneficiaryId !== reservation.beneficiaryId ||
    movement.programVersion !== reservation.programVersion || movement.calculationVersion !== reservation.calculationVersion ||
    movement.currency !== "EUR" || movement.origin !== "internal_server" || movement.recordedAtEpochMs !== correction.recordedAtEpochMs ||
    movement.pendingDeltaCents !== 0 || movement.availableDeltaCents !== availableDelta || movement.reservedDeltaCents !== 0 ||
    movement.regularizationDeltaCents !== -correction.compensationCents) {
    fail("CORRUPT_RESERVATION", "Mouvement de correction de restitution invalide.");
  }
  const payload = JSON.parse(movement.payload) as Record<string, unknown>;
  if (payload.event !== "credit_refund_corrected" || payload.correctionId !== correction.correctionId ||
    payload.targetEventId !== correction.targetRefundId || payload.revision !== correction.revision ||
    payload.restitutionDeltaCents !== correction.restitutionDeltaCents || payload.compensationCents !== correction.compensationCents) {
    fail("CORRUPT_RESERVATION", "Contenu de correction de restitution invalide.");
  }
}

function validateReservationRefundMovement(
  snapshot: DocumentSnapshot | undefined,
  reservation: CagnotteReservation,
  event: { refundId: string; eventKey: string; grossRestitutionCents: number; compensationCents: number; recordedAtEpochMs: number },
) {
  const movement = snapshot?.data() as CagnotteMovement | undefined;
  const availableIncrease = event.grossRestitutionCents - event.compensationCents;
  if (!snapshot?.exists || !movement || snapshot.id !== event.eventKey || movement.schemaVersion !== 3 ||
    movement.reservationVersion !== CAGNOTTE_RESERVATION_VERSION || movement.regularizationVersion !== CAGNOTTE_REGULARIZATION_VERSION ||
    movement.businessEvent !== "credit_refunded_after_return" || movement.eventKey !== event.eventKey ||
    movement.orderId !== reservation.orderId || movement.beneficiaryId !== reservation.beneficiaryId ||
    movement.programVersion !== reservation.programVersion || movement.calculationVersion !== reservation.calculationVersion ||
    movement.currency !== "EUR" || movement.origin !== "internal_server" || movement.recordedAtEpochMs !== event.recordedAtEpochMs ||
    movement.payload !== canonical({ event: "credit_refunded_after_return", refundId: event.refundId,
      intentFingerprint: reservation.intentFingerprint, grossRestitutionCents: event.grossRestitutionCents,
      compensationCents: event.compensationCents }) ||
    movement.pendingDeltaCents !== 0 || movement.availableDeltaCents !== availableIncrease ||
    movement.reservedDeltaCents !== 0 || movement.regularizationDeltaCents !== -event.compensationCents) {
    fail("CORRUPT_RESERVATION", "Mouvement de restitution invalide.");
  }
}

function activeReservationProgram(program: CagnotteReservationProgram | null, createdAtEpochMs: number, firebaseProjectId?: string | null): program is CagnotteReservationProgram {
  assertCagnotteProgramFirebaseProject(program, firebaseProjectId);
  return Boolean(program && (program.mode === "local_test" || program.mode === "production") && program.reservationsEnabled === true &&
    program.reservationVersion === CAGNOTTE_RESERVATION_VERSION && program.calculationVersion === CAGNOTTE_CALCULATION_VERSION &&
    Number.isSafeInteger(program.startsAtEpochMs) && program.startsAtEpochMs >= 0 &&
    Number.isSafeInteger(createdAtEpochMs) && createdAtEpochMs >= 0 && createdAtEpochMs >= program.startsAtEpochMs);
}

function eventKey(orderId: string, event: string, reference?: string) {
  return createHash("sha256").update(JSON.stringify(reference
    ? ["reservation", orderId, event, reference]
    : ["reservation", orderId, event])).digest("hex");
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("base64url");
}

function id(value: unknown): asserts value is string {
  if (!validId(value)) fail("INVALID_INPUT", "Identifiant interne invalide.");
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

function cents(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail("INVALID_INPUT", "Centimes ou instant invalides.");
}

function addCents(a: number, b: number) {
  cents(a); cents(b);
  const total = BigInt(a) + BigInt(b);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) fail("INVALID_INPUT", "Dépassement des centimes sûrs.");
  return Number(total);
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value && Object.getPrototypeOf(value) === Object.prototype && Object.getOwnPropertySymbols(value).length === 0) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return fail("INVALID_INPUT", "Valeur non canonique.");
}

function fail(code: CagnotteReservationError["code"], message: string): never {
  throw new CagnotteReservationError(code, message);
}
