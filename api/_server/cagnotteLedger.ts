import { createHash } from "node:crypto";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { calculateLoyaltyCents, CAGNOTTE_CALCULATION_VERSION, simulateCagnotteRefund } from "../../src/lib/cagnotteCalculations.js";
import type { CagnotteAccrual, CagnotteLedgerCommand, CagnotteLedgerResult, CagnotteMovement, CagnotteTestProgram, CagnotteWallet } from "./cagnotteLedgerTypes.js";
import { CAGNOTTE_REGULARIZATION_VERSION, CAGNOTTE_RESERVATION_VERSION } from "./cagnotteLedgerTypes.js";

export class CagnotteLedgerError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "CONFLICT" | "CORRUPT_LEDGER" | "PAYMENT_REQUIRED", message: string) {
    super(message);
    this.name = "CagnotteLedgerError";
  }
}

type Operation = {
  db: Firestore;
  command: CagnotteLedgerCommand;
  program: CagnotteTestProgram | null;
  /** Stable operation time. Callers sharing another transaction must supply it. */
  recordedAtEpochMs?: number;
  walletMutation?: CagnotteWalletMutation;
};

export type CagnotteWalletMutation = {
  readonly transaction: Transaction;
  readonly ref: DocumentReference;
  readonly beneficiaryId: string;
  readonly existed: boolean;
  readonly original: CagnotteWallet;
  readonly current: CagnotteWallet;
  written: boolean;
};

export async function prepareCagnotteWalletMutation(input: {
  db: Firestore;
  transaction: Transaction;
  beneficiaryId: string;
  allowMissing: boolean;
  missingCode?: CagnotteLedgerError["code"];
}): Promise<CagnotteWalletMutation> {
  id(input.beneficiaryId);
  const ref = input.db.collection("cagnotteWallets").doc(input.beneficiaryId);
  const snapshot = await input.transaction.get(ref);
  if (!snapshot.exists && !input.allowMissing) problem(input.missingCode ?? "CORRUPT_LEDGER", "Portefeuille manquant.");
  const current = snapshot.exists ? readCagnotteWallet(snapshot.data(), input.beneficiaryId) : newWallet(input.beneficiaryId);
  return {
    transaction: input.transaction,
    ref,
    beneficiaryId: input.beneficiaryId,
    existed: snapshot.exists,
    original: structuredClone(current),
    current,
    written: false,
  };
}

export function applyCagnotteWalletDeltas(mutation: CagnotteWalletMutation, deltas: {
  pendingCents?: number;
  availableCents?: number;
  reservedCents?: number;
  regularizationCents?: number;
}) {
  const next = {
    pendingCents: applyDelta(mutation.current.pendingCents, deltas.pendingCents ?? 0),
    availableCents: applyDelta(mutation.current.availableCents, deltas.availableCents ?? 0),
    reservedCents: applyDelta(mutation.current.reservedCents, deltas.reservedCents ?? 0),
    regularizationCents: applyDelta(mutation.current.regularizationCents, deltas.regularizationCents ?? 0),
  };
  Object.assign(mutation.current, next);
  validateWallet(mutation.current, mutation.beneficiaryId);
}

export function writeCagnotteWalletMutation(mutation: CagnotteWalletMutation) {
  if (mutation.written) problem("INVALID_INPUT", "Évolution de portefeuille déjà écrite.");
  mutation.written = true;
  mutation.transaction.set(mutation.ref, mutation.current);
}

/** Convenience wrapper only. The prepared operation below can share the order transaction. */
export function applyCagnotteLedgerOperation(input: Operation): Promise<CagnotteLedgerResult> {
  const recordedAtEpochMs = input.recordedAtEpochMs ?? Date.now();
  return input.db.runTransaction(async (transaction) => {
    const prepared = await prepareCagnotteLedgerOperation({ ...input, recordedAtEpochMs, transaction });
    prepared.write();
    return prepared.result;
  });
}

/**
 * Reads/validates without writing. A caller may finish ALL its other reads, then call write()
 * and stage its order changes in the SAME transaction. Prepare only one operation per order
 * per transaction; aggregate same-wallet operations before integrating a future batch API.
 * No external side effects, hidden client initialization, clock or nested transaction.
 */
export async function prepareCagnotteLedgerOperation({ db, transaction, command, program, recordedAtEpochMs = Date.now(), walletMutation: suppliedWalletMutation }: Operation & { transaction: Transaction }) {
  // Copy validated JSON now: no caller mutation can alter the plan while reads await.
  const order = JSON.parse(canonical(command.order)) as CagnotteLedgerCommand["order"];
  const testProgram = program ? JSON.parse(canonical(program)) as CagnotteTestProgram : null;
  id(order.orderId);
  if (order.beneficiaryId !== null) id(order.beneficiaryId);
  if (order.programVersion !== null) id(order.programVersion);
  cents(order.createdAtEpochMs);
  cents(recordedAtEpochMs);
  const binding = canonical(order);
  const combined = command.event === "payment_and_delivery_confirmed";
  const event = combined ? "delivery_confirmed" : command.event;
  const payload = normalizeEvent(combined ? { order, event: "delivery_confirmed" } : command);
  const eventKey = movementId(order.orderId, event, command.event === "refund_confirmed" ? command.refundId : "");
  const paymentKey = movementId(order.orderId, "payment_confirmed", "");
  const paymentRef = db.collection("cagnotteMovements").doc(paymentKey);
  const releaseKey = movementId(order.orderId, "made_available", "");
  const accrualRef = db.collection("cagnotteAccruals").doc(order.orderId);
  const eventRef = db.collection("cagnotteMovements").doc(eventKey);
  const releaseRef = db.collection("cagnotteMovements").doc(releaseKey);

  // All document reads precede every possible write, including idempotent retries.
  const [accrualDoc, eventDoc, releaseDoc, paymentDoc] = await transaction.getAll(accrualRef, eventRef, releaseRef, paymentRef);
  let state = accrualDoc.exists ? accrualDoc.data() as CagnotteAccrual : null;
  if (state && state.binding !== binding) problem("CONFLICT", "Commande, bénéficiaire, instantané ou version modifié.");
  if (state) validateAccrual(state, order);
  for (const doc of [eventDoc, releaseDoc, paymentDoc]) {
    if (doc.exists) {
      if (!state) problem("CORRUPT_LEDGER", "Mouvement sans droit.");
      validateMovement(doc.data()!, doc.id, state);
    }
  }
  if (state && ((state.credited !== paymentDoc.exists) ||
    ((state.compartment === "available") !== releaseDoc.exists))) problem("CORRUPT_LEDGER", "Marqueur d'attribution ou de disponibilité incohérent.");
  let walletMutation = state
    ? suppliedWalletMutation ?? await prepareCagnotteWalletMutation({ db, transaction, beneficiaryId: state.beneficiaryId, allowMissing: false })
    : null;
  if (state && walletMutation?.beneficiaryId !== state.beneficiaryId) problem("CONFLICT", "Portefeuille partagé d’un autre bénéficiaire.");
  if (eventDoc.exists) {
    const movement = eventDoc.data() as CagnotteMovement;
    if (!state || movement.payload !== payload || movement.orderId !== order.orderId ||
      movement.beneficiaryId !== order.beneficiaryId || movement.eventKey !== eventKey) {
      problem("CONFLICT", "Identifiant métier réutilisé avec un contenu différent.");
    }
    if (!combined || paymentDoc?.exists) return noWrite("already_applied");
  }
  if (combined && paymentDoc?.exists && (!state || paymentDoc.data()?.payload !== canonical({ event: "payment_confirmed" }))) {
    problem("CONFLICT", "Confirmation de paiement incompatible.");
  }
  if (!state) {
    // A zero-credit cancellation tombstone also survives suspension/absent config.
    // It never grants a right, but prevents a later activation from crediting a cancelled order.
    const cancellationTombstone = event === "cancelled" && order.beneficiaryId !== null &&
      order.programVersion !== null && order.snapshot.calculationVersion === CAGNOTTE_CALCULATION_VERSION;
    if (!eligible(testProgram, order) && !cancellationTombstone) return noWrite("not_eligible");
    // Validates the original arithmetic and version using the delivered lot 1 code.
    simulateCagnotteRefund(order.snapshot, [], []);
    state = {
      schemaVersion: 1, calculationVersion: CAGNOTTE_CALCULATION_VERSION, currency: "EUR",
      orderId: order.orderId, beneficiaryId: order.beneficiaryId!, programVersion: order.programVersion!, binding,
      initialSnapshot: order.snapshot, initialGainCents: calculateLoyaltyCents(order.snapshot.productsPaidCents),
      paymentConfirmed: false, deliveryConfirmed: false, cancelled: false, credited: false,
      compartment: "none", remainingGainCents: 0,
      cumulativeReturns: order.snapshot.lines.map((line) => ({ lineId: line.lineId, returnedNetCents: 0 })),
    };
  }
  if (state.cancelled && (event === "payment_confirmed" || event === "delivery_confirmed")) return noWrite("cancelled");
  if ((event === "payment_confirmed" || combined) && !state.credited && !eligible(testProgram, order)) return noWrite("not_eligible");
  if (event === "refund_confirmed" && !state.paymentConfirmed) problem("PAYMENT_REQUIRED", "Remboursement reçu avant confirmation du paiement : à rejouer ultérieurement.");

  const ownsWalletMutation = suppliedWalletMutation === undefined;
  walletMutation ??= suppliedWalletMutation ?? await prepareCagnotteWalletMutation({ db, transaction, beneficiaryId: state.beneficiaryId, allowMissing: true });
  if (walletMutation.beneficiaryId !== state.beneficiaryId || walletMutation.transaction !== transaction) problem("CONFLICT", "Évolution de portefeuille incompatible.");
  const wallet = structuredClone(walletMutation.current);
  validateWallet(wallet, state.beneficiaryId);
  const next = structuredClone(state);
  const nextWallet = walletMutation.current;
  const movements: CagnotteMovement[] = [];
  const add = (businessEvent: CagnotteMovement["businessEvent"], key: string, content: string, pending: number, available: number, regularization = 0) => {
    applyCagnotteWalletDeltas(walletMutation, { pendingCents: pending, availableCents: available, regularizationCents: regularization });
    movements.push({
      schemaVersion: 3, regularizationVersion: CAGNOTTE_REGULARIZATION_VERSION, reservationVersion: CAGNOTTE_RESERVATION_VERSION,
      calculationVersion: next.calculationVersion, programVersion: next.programVersion,
      currency: "EUR", origin: "internal_server", orderId: next.orderId, beneficiaryId: next.beneficiaryId,
      businessEvent, eventKey: key, payload: content,
      pendingDeltaCents: pending === 0 ? 0 : pending, availableDeltaCents: available === 0 ? 0 : available,
      reservedDeltaCents: 0,
      regularizationDeltaCents: regularization === 0 ? 0 : regularization,
      recordedAtEpochMs,
    });
  };
  let pending = 0;
  let available = 0;
  let regularization = 0;
  const withdrawReleasedGain = (correction: number) => {
    const taken = Math.min(nextWallet.availableCents, correction);
    available = -taken;
    regularization = correction - taken;
  };
  if (combined && !paymentDoc?.exists) {
    if (next.credited) problem("CORRUPT_LEDGER", "Attribution existante sans mouvement de paiement.");
    next.paymentConfirmed = true;
    next.credited = true;
    next.compartment = "pending";
    next.remainingGainCents = next.initialGainCents;
    add("payment_confirmed", paymentKey, canonical({ event: "payment_confirmed" }), next.remainingGainCents, 0);
  }
  if (event === "payment_confirmed") {
    if (next.credited) problem("CORRUPT_LEDGER", "Attribution existante sans mouvement de paiement.");
    next.paymentConfirmed = true;
    next.credited = true;
    next.compartment = "pending";
    next.remainingGainCents = next.initialGainCents;
    pending = next.remainingGainCents;
  } else if (event === "delivery_confirmed") {
    if (next.deliveryConfirmed && !eventDoc.exists) problem("CORRUPT_LEDGER", "Livraison existante sans événement.");
    next.deliveryConfirmed = true;
  } else if (event === "cancelled") {
    if (next.cancelled) problem("CORRUPT_LEDGER", "Annulation existante sans événement.");
    next.cancelled = true;
    if (next.compartment === "pending") pending = -next.remainingGainCents;
    if (next.compartment === "available") withdrawReleasedGain(next.remainingGainCents);
    next.remainingGainCents = 0;
  } else {
    // Reconstruct complete cumulative states. Lines absent from this EVENT retain their cumul.
    const additions = JSON.parse(payload).additionalReturns as { lineId: string; additionalNetCents: number }[];
    for (const addition of additions) {
      if (!next.cumulativeReturns.some((line) => line.lineId === addition.lineId)) problem("INVALID_INPUT", "Ligne de remboursement inconnue.");
    }
    const newReturns = next.cumulativeReturns.map((line) => ({
      lineId: line.lineId,
      returnedNetCents: addCents(line.returnedNetCents, additions.find((entry) => entry.lineId === line.lineId)?.additionalNetCents ?? 0),
    }));
    const simulation = simulateCagnotteRefund(next.initialSnapshot, next.cumulativeReturns, newReturns);
    const correction = next.cancelled ? 0 : simulation.delta.loyaltyCorrectionCents;
    if (correction > next.remainingGainCents) problem("CORRUPT_LEDGER", "Correction supérieure au gain restant.");
    if (next.compartment === "pending") pending = -correction;
    if (next.compartment === "available") withdrawReleasedGain(correction);
    next.remainingGainCents -= correction;
    next.cumulativeReturns = newReturns;
  }
  if (!eventDoc.exists) add(event, eventKey, payload, pending, available, regularization);
  // Règle commerciale V1 validée : paiement et livraison confirmés, sans délai supplémentaire.
  if (!next.cancelled && next.paymentConfirmed && next.deliveryConfirmed && next.compartment === "pending") {
    if (releaseDoc.exists) problem("CORRUPT_LEDGER", "Disponibilité déjà journalisée.");
    const compensation = Math.min(nextWallet.regularizationCents, next.remainingGainCents);
    add("made_available", releaseKey, canonical({ event: "made_available" }), -next.remainingGainCents, next.remainingGainCents - compensation, -compensation);
    // Preserve the FULL released right, including the portion used to compensate.
    next.compartment = "available";
  }
  // Reject undefined, unsafe numbers and non-JSON values before staging ANY write.
  canonical(next); canonical(nextWallet); canonical(movements);
  let written = false;
  return {
    result: { status: "applied", movementIds: movements.map((movement) => movement.eventKey) } as CagnotteLedgerResult,
    refundEffect: event === "refund_confirmed" ? {
      pendingDeltaCents: nextWallet.pendingCents - wallet.pendingCents,
      availableDeltaCents: nextWallet.availableCents - wallet.availableCents,
      regularizationDeltaCents: nextWallet.regularizationCents - wallet.regularizationCents,
      remainingGainCents: next.remainingGainCents,
    } : null,
    write() {
      if (written) problem("INVALID_INPUT", "Plan déjà écrit dans cette transaction.");
      written = true;
      transaction.set(accrualRef, next);
      if (ownsWalletMutation) writeCagnotteWalletMutation(walletMutation);
      for (const movement of movements) transaction.create(db.collection("cagnotteMovements").doc(movement.eventKey), movement);
    },
  };
}

function eligible(program: CagnotteTestProgram | null, order: CagnotteLedgerCommand["order"]): boolean {
  if (!program) return false;
  canonical(program);
  return program.mode === "local_test" && program.newAccrualsEnabled === true &&
    program.calculationVersion === CAGNOTTE_CALCULATION_VERSION && order.snapshot.calculationVersion === program.calculationVersion &&
    typeof program.programVersion === "string" && order.programVersion === program.programVersion &&
    order.beneficiaryId !== null && Number.isSafeInteger(program.startsAtEpochMs) && program.startsAtEpochMs >= 0 &&
    order.createdAtEpochMs >= program.startsAtEpochMs;
}

function normalizeEvent(command: CagnotteLedgerCommand): string {
  if (!["payment_confirmed", "delivery_confirmed", "cancelled", "refund_confirmed"].includes(command.event)) problem("INVALID_INPUT", "Événement inconnu.");
  if (command.event !== "refund_confirmed") return canonical({ event: command.event });
  id(command.refundId);
  if (!Array.isArray(command.additionalReturns) || command.additionalReturns.length === 0) problem("INVALID_INPUT", "Remboursement vide.");
  const ids = new Set<string>();
  const additionalReturns = command.additionalReturns.map((entry) => {
    if (!entry || typeof entry.lineId !== "string" || !entry.lineId.trim() || ids.has(entry.lineId)) problem("INVALID_INPUT", "Ligne de remboursement invalide ou dupliquée.");
    ids.add(entry.lineId);
    cents(entry.additionalNetCents);
    if (entry.additionalNetCents === 0) problem("INVALID_INPUT", "Le montant supplémentaire doit être positif.");
    return { lineId: entry.lineId, additionalNetCents: entry.additionalNetCents };
  }).sort((a, b) => a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0);
  return canonical({ event: command.event, refundId: command.refundId, additionalReturns });
}

function validateWallet(wallet: CagnotteWallet, beneficiary: string) {
  canonical(wallet);
  if (wallet.schemaVersion !== 3 || wallet.regularizationVersion !== CAGNOTTE_REGULARIZATION_VERSION ||
    wallet.reservationVersion !== CAGNOTTE_RESERVATION_VERSION ||
    wallet.currency !== "EUR" || wallet.beneficiaryId !== beneficiary) problem("CORRUPT_LEDGER", "Portefeuille incompatible.");
  cents(wallet.pendingCents); cents(wallet.availableCents); cents(wallet.reservedCents); cents(wallet.regularizationCents);
  if (wallet.availableCents > 0 && wallet.regularizationCents > 0) problem("CORRUPT_LEDGER", "Disponible et régularisation simultanément positifs.");
}

export function readCagnotteWallet(value: Record<string, unknown> | undefined, beneficiary: string): CagnotteWallet {
  if (!value) return problem("CORRUPT_LEDGER", "Portefeuille manquant pour un droit existant.");
  canonical(value);
  const normalized = { ...value };
  if (value.schemaVersion === 1) {
    if ((Object.hasOwn(value, "regularizationCents") && value.regularizationCents !== 0) ||
      Object.hasOwn(value, "regularizationVersion") ||
      (Object.hasOwn(value, "reservedCents") && value.reservedCents !== 0) || Object.hasOwn(value, "reservationVersion")) problem("CORRUPT_LEDGER", "Ancien portefeuille incompatible.");
    normalized.schemaVersion = 3;
    normalized.regularizationVersion = CAGNOTTE_REGULARIZATION_VERSION;
    normalized.regularizationCents = 0;
    normalized.reservationVersion = CAGNOTTE_RESERVATION_VERSION;
    normalized.reservedCents = 0;
  } else if (value.schemaVersion === 2) {
    if (value.regularizationVersion !== CAGNOTTE_REGULARIZATION_VERSION ||
      (Object.hasOwn(value, "reservedCents") && value.reservedCents !== 0) || Object.hasOwn(value, "reservationVersion")) problem("CORRUPT_LEDGER", "Portefeuille V2 incompatible.");
    normalized.schemaVersion = 3;
    normalized.reservationVersion = CAGNOTTE_RESERVATION_VERSION;
    normalized.reservedCents = 0;
  }
  validateWallet(normalized as CagnotteWallet, beneficiary);
  return normalized as CagnotteWallet;
}

const readWallet = readCagnotteWallet;

function newWallet(beneficiaryId: string): CagnotteWallet {
  return {
    schemaVersion: 3,
    regularizationVersion: CAGNOTTE_REGULARIZATION_VERSION,
    reservationVersion: CAGNOTTE_RESERVATION_VERSION,
    currency: "EUR",
    beneficiaryId,
    pendingCents: 0,
    availableCents: 0,
    reservedCents: 0,
    regularizationCents: 0,
  };
}

/** Recognized old journal entries may omit only the new zero variation. Never rewritten. */
function validateMovement(value: Record<string, unknown>, key: string, state: CagnotteAccrual) {
  canonical(value);
  const schema = value.schemaVersion;
  const regularization = schema === 1 && !Object.hasOwn(value, "regularizationDeltaCents") ? 0 : value.regularizationDeltaCents;
  const reserved = (schema === 1 || schema === 2) && !Object.hasOwn(value, "reservedDeltaCents") ? 0 : value.reservedDeltaCents;
  if ((schema === 1 && (regularization !== 0 || Object.hasOwn(value, "regularizationVersion") || reserved !== 0 || Object.hasOwn(value, "reservationVersion"))) ||
    (schema === 2 && (value.regularizationVersion !== CAGNOTTE_REGULARIZATION_VERSION || reserved !== 0 || Object.hasOwn(value, "reservationVersion"))) ||
    (schema !== 1 && schema !== 2 && (schema !== 3 || value.regularizationVersion !== CAGNOTTE_REGULARIZATION_VERSION || value.reservationVersion !== CAGNOTTE_RESERVATION_VERSION)) ||
    value.orderId !== state.orderId || value.beneficiaryId !== state.beneficiaryId || value.eventKey !== key ||
    value.programVersion !== state.programVersion || value.calculationVersion !== state.calculationVersion ||
    value.currency !== "EUR" || value.origin !== "internal_server" ||
    typeof value.payload !== "string") problem("CORRUPT_LEDGER", "Mouvement incompatible.");
  const p = value.pendingDeltaCents, a = value.availableDeltaCents, r = reserved, d = regularization;
  if (![p, a, r, d].every((n) => typeof n === "number" && Number.isSafeInteger(n))) problem("CORRUPT_LEDGER", "Variations de journal invalides.");
  if ((schema === 3 || Object.hasOwn(value, "recordedAtEpochMs")) && (!Number.isSafeInteger(value.recordedAtEpochMs) || (value.recordedAtEpochMs as number) < 0)) problem("CORRUPT_LEDGER", "Horodatage de journal invalide.");
  if (r !== 0) problem("CORRUPT_LEDGER", "Un mouvement de gain ne peut modifier le réservé.");
  const pending = p as number, available = a as number, deficit = d as number;
  const event = value.businessEvent;
  const content = JSON.parse(value.payload as string);
  const normalized = event === "made_available" ? canonical({ event }) : normalizeEvent({ ...content, order: {
    orderId: state.orderId, beneficiaryId: state.beneficiaryId, programVersion: state.programVersion,
    createdAtEpochMs: 0, snapshot: state.initialSnapshot,
  } });
  if (content.event !== event || normalized !== value.payload || key !== movementId(state.orderId, String(event), event === "refund_confirmed" ? content.refundId : "")) problem("CORRUPT_LEDGER", "Clé ou contenu de journal incohérent.");
  if ((event === "payment_confirmed" && (pending !== state.initialGainCents || available !== 0 || deficit !== 0)) ||
    (event === "delivery_confirmed" && (pending !== 0 || available !== 0 || deficit !== 0)) ||
    (event === "made_available" && (pending > 0 || -pending > state.initialGainCents || available < 0 || deficit > 0 || BigInt(pending) + BigInt(available) - BigInt(deficit) !== 0n)) ||
    ((event === "cancelled" || event === "refund_confirmed") && (pending > 0 || available > 0 || deficit < 0 ||
      (pending < 0 && (available !== 0 || deficit !== 0)) || -BigInt(pending) - BigInt(available) + BigInt(deficit) > BigInt(state.initialGainCents)))) {
    problem("CORRUPT_LEDGER", "Variations incompatibles avec l'événement.");
  }
}

function validateAccrual(state: CagnotteAccrual, order: CagnotteLedgerCommand["order"]) {
  canonical(state);
  if (state.schemaVersion !== 1 || state.currency !== "EUR" || state.calculationVersion !== CAGNOTTE_CALCULATION_VERSION ||
    state.orderId !== order.orderId || state.beneficiaryId !== order.beneficiaryId || state.programVersion !== order.programVersion ||
    canonical(state.initialSnapshot) !== canonical(order.snapshot)) problem("CORRUPT_LEDGER", "Droit incompatible.");
  cents(state.initialGainCents); cents(state.remainingGainCents);
  const theoretical = simulateCagnotteRefund(state.initialSnapshot, [], state.cumulativeReturns).next.theoreticalLoyaltyCents;
  if (state.initialGainCents !== calculateLoyaltyCents(state.initialSnapshot.productsPaidCents) ||
    [state.paymentConfirmed, state.deliveryConfirmed, state.cancelled, state.credited].some((flag) => typeof flag !== "boolean") ||
    state.paymentConfirmed !== state.credited ||
    (!state.credited && state.compartment !== "none") ||
    (state.credited && state.compartment !== (state.deliveryConfirmed ? "available" : "pending")) ||
    state.remainingGainCents !== (state.cancelled || !state.credited ? 0 : theoretical) ||
    state.cumulativeReturns.length !== state.initialSnapshot.lines.length) problem("CORRUPT_LEDGER", "État du gain incohérent.");
}

function noWrite(status: CagnotteLedgerResult["status"]) {
  return { result: { status, movementIds: [] } as CagnotteLedgerResult, refundEffect: null, write() { /* No new ledger event. */ } };
}

/** Read-only basis for administrative refund reconciliation, using this journal's
 * validators. Missing rights are not reconstructed from a financial declaration. */
export async function readCagnotteRefundBasis({ db, transaction, order, allowMissingAccrual = false }: {
  db: Firestore;
  transaction: Transaction;
  order: CagnotteLedgerCommand["order"];
  allowMissingAccrual?: boolean;
}) {
  const binding = canonical(order);
  if (order.beneficiaryId === null) problem("CONFLICT", "Bénéficiaire absent du remboursement.");
  const [accrual, payment, release, cancellation, walletSnapshot] = await transaction.getAll(
    db.collection("cagnotteAccruals").doc(order.orderId),
    ...["payment_confirmed", "made_available", "cancelled"].map((event) =>
      db.collection("cagnotteMovements").doc(movementId(order.orderId, event, ""))),
    db.collection("cagnotteWallets").doc(order.beneficiaryId),
  );
  if (!accrual.exists) {
    if ([payment, release, cancellation].some((doc) => doc.exists)) {
      problem("CORRUPT_LEDGER", "Mouvement présent sans droit de fidélité.");
    }
    if (!allowMissingAccrual) problem("CORRUPT_LEDGER", "Droit absent : rapprochement nécessaire, aucun rattrapage automatique.");
    return { state: null, wallet: readWallet(walletSnapshot.data(), order.beneficiaryId) };
  }
  const state = accrual.data() as CagnotteAccrual;
  if (state.binding !== binding) problem("CONFLICT", "Commande et droit incompatibles.");
  validateAccrual(state, order);
  for (const doc of [payment, release, cancellation]) if (doc.exists) validateMovement(doc.data()!, doc.id, state);
  if (state.credited !== payment.exists || (state.compartment === "available") !== release.exists || state.cancelled !== cancellation.exists) {
    problem("CORRUPT_LEDGER", "Marqueurs du droit incompatibles.");
  }
  const wallet = readWallet(walletSnapshot.data(), state.beneficiaryId);
  return { state, wallet };
}

function movementId(order: string, event: string, refund: string) {
  return createHash("sha256").update(JSON.stringify([order, event, refund])).digest("hex");
}

function cents(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) problem("INVALID_INPUT", "Centimes ou instant numérique invalides.");
}

function addCents(a: number, b: number) {
  cents(a); cents(b);
  const total = BigInt(a) + BigInt(b);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) problem("INVALID_INPUT", "Dépassement des centimes sûrs.");
  return Number(total);
}

function applyDelta(balance: number, delta: number) {
  if (delta < 0 && balance < -delta) problem("CORRUPT_LEDGER", "Compartiment insuffisant : journal ou attente incohérent.");
  return delta < 0 ? balance + delta : addCents(balance, delta);
}

function id(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) problem("INVALID_INPUT", "Identifiant interne invalide.");
}

/** Canonical plain JSON, also used for strict persistence validation. */
function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonical).join(",")}]`;
  if (typeof value === "object" && value && Object.getPrototypeOf(value) === Object.prototype && Object.getOwnPropertySymbols(value).length === 0) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return problem("INVALID_INPUT", "Valeur non sérialisable ou nombre non sûr.");
}

function problem(code: CagnotteLedgerError["code"], message: string): never {
  throw new CagnotteLedgerError(code, message);
}
