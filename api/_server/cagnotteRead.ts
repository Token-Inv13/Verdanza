import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { FieldPath, type Firestore, type Query, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import type {
  CagnotteHistoryDetail,
  CagnotteHistoryItem,
  CagnotteHistoryLabel,
  CagnotteReadResponse,
  CagnotteReadScope,
} from "../../src/types/cagnotteRead.js";
import { CAGNOTTE_REGULARIZATION_VERSION, CAGNOTTE_RESERVATION_VERSION } from "./cagnotteLedgerTypes.js";
import { CagnotteLedgerError, readCagnotteWallet } from "./cagnotteLedger.js";

export const CAGNOTTE_READ_SERVER_ENABLED = false as const;
export const CAGNOTTE_READ_DEFAULT_LIMIT = 20;
export const CAGNOTTE_READ_MAX_LIMIT = 50;

function hasOwn(value: object, property: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, property);
}

type ReadInput = {
  db: Firestore;
  beneficiaryId: string;
  scope: CagnotteReadScope;
  cursor?: string;
  limit?: number;
  cursorSecret: string;
  capabilities?: {
    canRequestReservation: boolean;
    canAccrueLoyalty: boolean;
  };
};

type CursorPayload = {
  v: 1;
  audience: string;
  afterEpochMs: number;
  afterId: string;
};

export class CagnotteReadError extends Error {
  constructor(
    readonly code: "invalid_request" | "invalid_cursor" | "inconsistent_data" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "CagnotteReadError";
  }
}

/** Read-only. Firestore is injected and no Firebase client is initialized on import. */
export async function readCagnotte(input: ReadInput): Promise<CagnotteReadResponse> {
  const beneficiaryId = validatedId(input.beneficiaryId, "Bénéficiaire invalide.");
  const limit = validatedLimit(input.limit);
  const cursorKey = cursorEncryptionKey(input.cursorSecret);
  const cursor = input.cursor ? decodeCursor(input.cursor, input.scope, beneficiaryId, cursorKey) : null;
  const walletRef = input.db.collection("cagnotteWallets").doc(beneficiaryId);
  const collection = input.db.collection("cagnotteMovements");
  let query: Query = collection
    .where("beneficiaryId", "==", beneficiaryId)
    .orderBy("recordedAtEpochMs", "desc")
    .orderBy(FieldPath.documentId(), "desc");
  if (cursor) query = query.startAfter(cursor.afterEpochMs, cursor.afterId);
  query = query.limit(limit + 1);

  const result = await input.db.runTransaction(async (transaction) => {
    const walletSnapshot = await transaction.get(walletRef);
    const historySnapshot = await transaction.get(query);
    const firstHistorySnapshot = !walletSnapshot.exists
      ? await transaction.get(collection.where("beneficiaryId", "==", beneficiaryId).limit(1))
      : historySnapshot;
    return { walletSnapshot, historySnapshot, firstHistorySnapshot };
  }, { readOnly: true });

  if (!result.walletSnapshot.exists && !result.firstHistorySnapshot.empty) {
    throw new CagnotteReadError("inconsistent_data", "Historique présent sans portefeuille.");
  }

  let wallet: CagnotteReadResponse["wallet"];
  if (!result.walletSnapshot.exists) {
    wallet = { status: "not_created", availableCents: 0, pendingCents: 0, reservedCents: 0, regularizationCents: 0 };
  } else {
    try {
      const value = readCagnotteWallet(result.walletSnapshot.data(), beneficiaryId);
      wallet = {
        status: "active",
        availableCents: value.availableCents,
        pendingCents: value.pendingCents,
        reservedCents: value.reservedCents,
        regularizationCents: value.regularizationCents,
      };
    } catch (error) {
      if (error instanceof CagnotteLedgerError) {
        throw new CagnotteReadError("inconsistent_data", "Portefeuille incompatible.");
      }
      throw error;
    }
  }

  const scanned = result.historySnapshot.docs.slice(0, limit);
  const items = scanned.flatMap((document) => {
    const item = publicMovement(document, beneficiaryId);
    return item ? [item] : [];
  });
  const last = scanned.length > 0 ? scanned[scanned.length - 1] : undefined;
  const nextCursor = result.historySnapshot.size > limit && last
    ? encodeCursor(input.scope, beneficiaryId, timestamp(last), last.id, cursorKey)
    : null;
  const readTime = result.historySnapshot.readTime.toDate().toISOString();

  return {
    currency: "EUR",
    capabilities: {
      canReadWallet: true,
      canRequestReservation: input.capabilities?.canRequestReservation === true,
      canAccrueLoyalty: input.capabilities?.canAccrueLoyalty === true,
    },
    wallet,
    history: {
      items,
      nextCursor,
      completeness: "timestamped_movements_only",
      limitation: "Les mouvements antérieurs sans horodatage ne peuvent pas être affichés. L’historique visible peut être incomplet.",
    },
    freshness: { readAt: readTime, consistency: "wallet_and_page", refreshStartsAtFirstPage: true },
  };
}

function publicMovement(document: QueryDocumentSnapshot, beneficiaryId: string): CagnotteHistoryItem | null {
  const value = document.data() as Record<string, unknown>;
  validateMovement(value, document.id, beneficiaryId);
  const pending = value.pendingDeltaCents as number;
  const available = value.availableDeltaCents as number;
  const reserved = (value.reservedDeltaCents ?? 0) as number;
  const regularization = (value.regularizationDeltaCents ?? 0) as number;
  if (pending === 0 && available === 0 && reserved === 0 && regularization === 0) return null;
  const event = value.businessEvent as string;
  const label = historyLabel(event, pending, available, regularization);
  const correction = -pending - available + regularization;
  const amountCents = event === "refund_declaration_corrected" || event === "credit_refund_corrected"
    ? pending + available - regularization
    : event === "credit_refunded_after_return"
    ? Number(BigInt(available) - BigInt(regularization))
    : event.startsWith("credit_")
    ? Math.abs(reserved)
    : event === "payment_confirmed"
    ? pending
    : event === "made_available"
      ? -pending
      : -correction;
  const details: CagnotteHistoryDetail[] = [];
  if (pending !== 0) details.push({ compartment: "pending", deltaCents: pending });
  if (available !== 0) details.push({ compartment: "available", deltaCents: available });
  if (reserved !== 0) details.push({ compartment: "reserved", deltaCents: reserved });
  if (regularization !== 0) details.push({ compartment: "regularization", deltaCents: regularization });
  return {
    occurredAt: new Date(value.recordedAtEpochMs as number).toISOString(),
    label,
    amountCents,
    details,
  };
}

function historyLabel(event: string, pending: number, available: number, regularization: number): CagnotteHistoryLabel {
  if (event === "payment_confirmed") return "Gain en attente";
  if (event === "made_available") {
    return available === 0 && regularization < 0
      ? "Gain affecté à une régularisation"
      : "Gain devenu disponible";
  }
  if (event === "cancelled") return "Gain annulé";
  if (event === "credit_reserved") return "Cagnotte réservée";
  if (event === "credit_consumed") return "Cagnotte utilisée";
  if (event === "credit_released") return "Cagnotte libérée";
  if (event === "credit_refunded_after_return") return "Cagnotte restituée après retour";
  if (event === "refund_declaration_corrected") return "Gain corrigé après rectification administrative";
  if (event === "credit_refund_corrected") return "Restitution corrigée après rectification administrative";
  if (regularization > 0 && pending === 0 && available === 0) return "Régularisation des avantages";
  return "Ajustement de fidélité après retour";
}

function validateMovement(value: Record<string, unknown>, documentId: string, beneficiaryId: string) {
  const schemaVersion = value.schemaVersion;
  const legacy = schemaVersion === 1;
  const regularization = value.regularizationDeltaCents ?? 0;
  const reserved = value.reservedDeltaCents ?? 0;
  const knownEvent = ["payment_confirmed", "delivery_confirmed", "cancelled", "refund_confirmed", "made_available", "credit_reserved", "credit_consumed", "credit_released", "credit_refunded_after_return", "refund_declaration_corrected", "credit_refund_corrected"].includes(String(value.businessEvent));
  if ((legacy && (regularization !== 0 || hasOwn(value, "regularizationVersion") || reserved !== 0 || hasOwn(value, "reservationVersion"))) ||
    (schemaVersion === 2 && (value.regularizationVersion !== CAGNOTTE_REGULARIZATION_VERSION || reserved !== 0 || hasOwn(value, "reservationVersion"))) ||
    (schemaVersion !== 1 && schemaVersion !== 2 && (schemaVersion !== 3 || value.regularizationVersion !== CAGNOTTE_REGULARIZATION_VERSION || value.reservationVersion !== CAGNOTTE_RESERVATION_VERSION)) ||
    value.currency !== "EUR" || value.origin !== "internal_server" || value.beneficiaryId !== beneficiaryId ||
    value.eventKey !== documentId || !knownEvent || typeof value.calculationVersion !== "string" ||
    typeof value.programVersion !== "string" || !value.calculationVersion || !value.programVersion ||
    !validCents(value.pendingDeltaCents) || !validCents(value.availableDeltaCents) || !validCents(reserved) || !validCents(regularization) ||
    !Number.isSafeInteger(value.recordedAtEpochMs) || (value.recordedAtEpochMs as number) < 0) {
    throw new CagnotteReadError("inconsistent_data", "Mouvement incompatible.");
  }
  const pending = value.pendingDeltaCents as number;
  const available = value.availableDeltaCents as number;
  const deficit = regularization as number;
  const held = reserved as number;
  const event = String(value.businessEvent);
  const reservationEvent = event.startsWith("credit_");
  const invalidPayment = event === "payment_confirmed" && (pending <= 0 || available !== 0 || held !== 0 || deficit !== 0);
  const invalidDelivery = event === "delivery_confirmed" && (pending !== 0 || available !== 0 || held !== 0 || deficit !== 0);
  const invalidRelease = event === "made_available" && (held !== 0 || pending >= 0 || available < 0 || deficit > 0 || BigInt(pending) + BigInt(available) - BigInt(deficit) !== 0n);
  const correction = -BigInt(pending) - BigInt(available) + BigInt(deficit);
  const invalidCorrection = (event === "cancelled" || event === "refund_confirmed") &&
    (held !== 0 || pending > 0 || available > 0 || deficit < 0 || (pending < 0 && (available !== 0 || deficit !== 0)) || correction < 0n);
  const invalidReserve = event === "credit_reserved" && (pending !== 0 || available >= 0 || held <= 0 || deficit !== 0 || BigInt(available) + BigInt(held) !== 0n);
  const invalidConsume = event === "credit_consumed" && (pending !== 0 || available !== 0 || held >= 0 || deficit !== 0);
  const invalidReservationRelease = event === "credit_released" && (pending !== 0 || available < 0 || held >= 0 || deficit > 0 || -BigInt(held) !== BigInt(available) - BigInt(deficit));
  const refundGross = BigInt(available) - BigInt(deficit);
  const invalidRefundRestitution = event === "credit_refunded_after_return" &&
    (pending !== 0 || available < 0 || held !== 0 || deficit > 0 || refundGross <= 0n || refundGross > BigInt(Number.MAX_SAFE_INTEGER));
  const invalidAdministrativeCorrection = event === "refund_declaration_corrected" &&
    (held !== 0 || deficit !== 0 || (pending !== 0 && available !== 0));
  const invalidCreditCorrection = event === "credit_refund_corrected" &&
    (pending !== 0 || held !== 0 || deficit > 0 || (available < 0 && deficit !== 0) || (available === 0 && deficit === 0));
  const correctedEvent = event === "refund_declaration_corrected" || event === "credit_refund_corrected";
  if ((!reservationEvent && !correctedEvent && held !== 0) || invalidPayment || invalidDelivery || invalidRelease || invalidCorrection || invalidReserve || invalidConsume || invalidReservationRelease || invalidRefundRestitution || invalidAdministrativeCorrection || invalidCreditCorrection) {
    throw new CagnotteReadError("inconsistent_data", "Variations de mouvement incompatibles.");
  }
}

function timestamp(document: QueryDocumentSnapshot) {
  const value = document.get("recordedAtEpochMs");
  if (!Number.isSafeInteger(value) || value < 0) throw new CagnotteReadError("inconsistent_data", "Horodatage incompatible.");
  return value as number;
}

function validCents(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function validatedLimit(value: number | undefined) {
  const limit = value ?? CAGNOTTE_READ_DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > CAGNOTTE_READ_MAX_LIMIT) {
    throw new CagnotteReadError("invalid_request", "Limite invalide.");
  }
  return limit;
}

export function validatedId(value: string, message = "Identifiant invalide.") {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || !/^[A-Za-z0-9._:@+-]+$/.test(value)) {
    throw new CagnotteReadError("invalid_request", message);
  }
  return value;
}

function audience(scope: CagnotteReadScope, beneficiaryId: string) {
  return createHash("sha256").update(`${scope}\0${beneficiaryId}`).digest("base64url");
}

function cursorEncryptionKey(secret: string) {
  if (typeof secret !== "string" || secret.length < 32) throw new CagnotteReadError("unavailable", "Configuration de curseur indisponible.");
  return createHash("sha256").update(secret).digest();
}

function encodeCursor(scope: CagnotteReadScope, beneficiaryId: string, afterEpochMs: number, afterId: string, key: Buffer) {
  const payload: CursorPayload = { v: 1, audience: audience(scope, beneficiaryId), afterEpochMs, afterId };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url")}`;
}

function decodeCursor(raw: string, scope: CagnotteReadScope, beneficiaryId: string, key: Buffer): CursorPayload {
  try {
    if (raw.length > 512 || !/^v1\.[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const encoded = raw.slice(3);
    const packed = Buffer.from(encoded, "base64url");
    if (packed.toString("base64url") !== encoded || packed.length < 29) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));
    const decoded = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
    const payload = JSON.parse(decoded) as Record<string, unknown>;
    if (Object.keys(payload).sort().join(",") !== "afterEpochMs,afterId,audience,v" || payload.v !== 1 ||
      payload.audience !== audience(scope, beneficiaryId) || !Number.isSafeInteger(payload.afterEpochMs) ||
      (payload.afterEpochMs as number) < 0 || validatedId(String(payload.afterId)) !== payload.afterId) throw new Error();
    return payload as unknown as CursorPayload;
  } catch {
    throw new CagnotteReadError("invalid_cursor", "Curseur invalide.");
  }
}
