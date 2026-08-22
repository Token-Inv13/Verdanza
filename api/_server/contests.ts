import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import type {
  Contest,
  ContestAuditLog,
  ContestDraw,
  ContestEntry,
  ContestInput,
  ContestPrize,
  ContestStatus,
  PublicContest,
} from "../../src/types/contests.js";

export const contestCollections = {
  contests: "contests",
  entries: "contestEntries",
  draws: "contestDraws",
  prizes: "contestPrizes",
  audits: "contestAuditLogs",
  controls: "contestControls",
} as const;

export const contestDrawAlgorithmVersion =
  "node:crypto.randomInt/v1+sha256-sorted-entry-ids";

const globalControlId = "global";
const maxDrawEntries = 10_000;
const contestStatuses: ContestStatus[] = [
  "draft",
  "scheduled",
  "active",
  "closed",
  "drawing",
  "winner_pending",
  "completed",
  "cancelled",
];

type Actor = {
  actorType: ContestAuditLog["actorType"];
  actorId: string;
};

export class ContestError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "contest_error",
  ) {
    super(message);
    this.name = "ContestError";
  }
}

export function normalizeContestEmail(value: string) {
  return String(value || "").normalize("NFKC").trim().toLowerCase();
}

export function contestEmailHash(
  contestId: string,
  email: string,
  secret = contestSecuritySecret(),
) {
  return crypto
    .createHmac("sha256", secret)
    .update(`contest-email:${contestId}:${normalizeContestEmail(email)}`)
    .digest("hex");
}

export function contestClaimTokenHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function assertContestAcceptsEntry(contest: Contest, now = new Date()) {
  const nowMs = now.getTime();
  const startsAt = Date.parse(contest.startAt);
  const endsAt = Date.parse(contest.endAt);
  if (contest.status !== "active") {
    throw new ContestError("Ce concours n'est pas ouvert.", 409, "contest_not_active");
  }
  if (!Number.isFinite(startsAt) || nowMs < startsAt) {
    throw new ContestError("Ce concours n'a pas encore commence.", 409, "contest_not_started");
  }
  if (!Number.isFinite(endsAt) || nowMs >= endsAt) {
    throw new ContestError("Ce concours est termine.", 409, "contest_closed");
  }
}

export function selectContestWinner(
  eligibleEntryIds: string[],
  randomIndex: (upperBound: number) => number = (upperBound) => crypto.randomInt(upperBound),
) {
  if (!eligibleEntryIds.length) {
    throw new ContestError("Aucune participation eligible pour le tirage.", 409, "draw_empty");
  }
  const sortedIds = [...eligibleEntryIds].sort();
  const selectedIndex = randomIndex(sortedIds.length);
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= sortedIds.length) {
    throw new ContestError("Index de tirage invalide.", 500, "draw_random_invalid");
  }
  return {
    sortedIds,
    snapshotHash: crypto
      .createHash("sha256")
      .update(sortedIds.join("\n"))
      .digest("hex"),
    winnerEntryId: sortedIds[selectedIndex],
  };
}

export function assertContestPrizeRedeemable(
  prize: Partial<ContestPrize>,
  input: { couponId: string; email: string; now?: Date },
) {
  if (!["issued", "claimed"].includes(String(prize.status || ""))) {
    throw new ContestError(
      "Code promo concours deja utilise ou indisponible.",
      409,
      "contest_prize_unavailable",
    );
  }
  if (Date.parse(String(prize.expiresAt || "")) <= (input.now || new Date()).getTime()) {
    throw new ContestError("Code promo expire.", 409, "contest_prize_expired");
  }
  if (String(prize.couponId || "") !== input.couponId) {
    throw new ContestError("Code promo concours invalide.", 409);
  }
  if (!prize.contestId || !prize.winnerEmailHash) {
    throw new ContestError("Code promo concours invalide.", 409);
  }
  const submittedEmailHash = contestEmailHash(prize.contestId, input.email);
  if (submittedEmailHash !== prize.winnerEmailHash) {
    throw new ContestError("Ce code promo est reserve au gagnant concerne.", 403);
  }
}

export function validateContestInput(value: unknown): ContestInput {
  if (!value || typeof value !== "object") {
    throw new ContestError("Configuration du concours invalide.");
  }
  const input = value as Partial<ContestInput>;
  const title = cleanText(input.title, 120);
  const slug = slugify(input.slug || input.title || "");
  const description = cleanText(input.description, 4_000);
  const eligibilityConditions = cleanText(input.eligibilityConditions, 2_000);
  const rulesUrl = cleanOptionalUrl(input.rulesUrl);
  const rulesText = cleanText(input.rulesText, 20_000);
  const prizeValue = money(input.prizeValue);
  const prizeExpirationDays = Math.trunc(Number(input.prizeExpirationDays || 30));
  const startAt = validIsoDate(input.startAt, "Date de debut invalide.");
  const endAt = validIsoDate(input.endAt, "Date de fin invalide.");
  const drawAt = validIsoDate(input.drawAt, "Date de tirage invalide.");

  if (title.length < 3) throw new ContestError("Le titre doit contenir au moins 3 caracteres.");
  if (!slug) throw new ContestError("Slug du concours invalide.");
  if (description.length < 10) throw new ContestError("La description est trop courte.");
  if (prizeValue <= 0 || prizeValue > 10_000) {
    throw new ContestError("La valeur du lot doit etre comprise entre 0,01 et 10 000 EUR.");
  }
  if (Date.parse(endAt) <= Date.parse(startAt)) {
    throw new ContestError("La fin doit etre posterieure au debut.");
  }
  if (Date.parse(drawAt) < Date.parse(endAt)) {
    throw new ContestError("Le tirage doit etre programme apres la cloture.");
  }
  if (!rulesUrl && rulesText.length < 10) {
    throw new ContestError("Un reglement ou un lien vers le reglement est requis.");
  }
  if (eligibilityConditions.length < 3) {
    throw new ContestError("Les conditions d'eligibilite sont requises.");
  }
  if (prizeExpirationDays < 1 || prizeExpirationDays > 365) {
    throw new ContestError("L'expiration du gain doit etre comprise entre 1 et 365 jours.");
  }

  return {
    title,
    slug,
    description,
    prizeValue,
    prizeType: "store_credit",
    startAt,
    endAt,
    drawAt,
    rulesUrl,
    rulesText,
    eligibilityConditions,
    prizeExpirationDays,
  };
}

export async function createContest(
  db: FirebaseFirestore.Firestore,
  rawInput: unknown,
  actor: Actor,
) {
  const input = validateContestInput(rawInput);
  const contestRef = db.collection(contestCollections.contests).doc();
  const counterRef = db.collection("counters").doc("contest-sequence");
  await db.runTransaction(async (transaction) => {
    const counter = await transaction.get(counterRef);
    const sequenceNumber = Number(counter.data()?.value || 0) + 1;
    const payload = {
      ...input,
      sequenceNumber,
      status: "draft" satisfies ContestStatus,
      entryCount: 0,
      createdBy: actor.actorId,
      updatedBy: actor.actorId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    transaction.set(contestRef, payload);
    transaction.set(
      counterRef,
      { value: sequenceNumber, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    writeAudit(transaction, db, {
      action: "contest_created",
      contestId: contestRef.id,
      ...actor,
      after: auditContestConfiguration(payload),
    });
  });
  return getContest(db, contestRef.id);
}

export async function updateContest(
  db: FirebaseFirestore.Firestore,
  contestId: string,
  rawInput: unknown,
  actor: Actor,
) {
  const input = validateContestInput(rawInput);
  const ref = db.collection(contestCollections.contests).doc(contestId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new ContestError("Concours introuvable.", 404);
    const existing = document<Contest>(snapshot);
    if (!(["draft", "scheduled"] as ContestStatus[]).includes(existing.status)) {
      throw new ContestError(
        "La configuration est verrouillee apres l'ouverture du concours.",
        409,
        "contest_configuration_locked",
      );
    }
    transaction.update(ref, {
      ...input,
      updatedBy: actor.actorId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAudit(transaction, db, {
      action: "contest_updated",
      contestId,
      ...actor,
      before: auditContestConfiguration(existing),
      after: auditContestConfiguration({ ...existing, ...input }),
    });
  });
  return getContest(db, contestId);
}

export async function transitionContest(
  db: FirebaseFirestore.Firestore,
  contestId: string,
  nextStatus: ContestStatus,
  actor: Actor,
  now = new Date(),
) {
  if (!contestStatuses.includes(nextStatus)) throw new ContestError("Statut de concours invalide.");
  const ref = db.collection(contestCollections.contests).doc(contestId);
  const controlRef = db.collection(contestCollections.controls).doc(globalControlId);
  await db.runTransaction(async (transaction) => {
    const [snapshot, control] = await Promise.all([
      transaction.get(ref),
      transaction.get(controlRef),
    ]);
    if (!snapshot.exists) throw new ContestError("Concours introuvable.", 404);
    const contest = document<Contest>(snapshot);
    assertTransition(contest, nextStatus, now);
    if (nextStatus === "active") {
      const activeContestId = String(control.data()?.activeContestId || "");
      if (activeContestId && activeContestId !== contestId) {
        throw new ContestError(
          "Un autre concours est deja actif.",
          409,
          "another_contest_active",
        );
      }
      transaction.set(controlRef, {
        activeContestId: contestId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else if (
      (nextStatus === "closed" || nextStatus === "cancelled") &&
      control.data()?.activeContestId === contestId
    ) {
      transaction.delete(controlRef);
    }
    transaction.update(ref, {
      status: nextStatus,
      updatedBy: actor.actorId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAudit(transaction, db, {
      action: nextStatus === "closed" ? "contest_closed" : "status_changed",
      contestId,
      ...actor,
      before: { status: contest.status },
      after: { status: nextStatus },
    });
  });
  return getContest(db, contestId);
}

export async function synchronizeContestLifecycle(
  db: FirebaseFirestore.Firestore,
  now = new Date(),
) {
  const nowMs = now.getTime();
  const activeSnapshot = await db
    .collection(contestCollections.contests)
    .where("status", "==", "active")
    .get();
  for (const snapshot of activeSnapshot.docs) {
    const contest = document<Contest>(snapshot);
    if (Date.parse(contest.endAt) <= nowMs) {
      await transitionContest(db, contest.id, "closed", {
        actorType: "system",
        actorId: "contest-lifecycle",
      }, now);
    }
  }

  const stillActive = await db
    .collection(contestCollections.contests)
    .where("status", "==", "active")
    .limit(1)
    .get();
  if (!stillActive.empty) {
    const contest = document<Contest>(stillActive.docs[0]);
    const controlRef = db.collection(contestCollections.controls).doc(globalControlId);
    const controlSnapshot = await controlRef.get();
    if (controlSnapshot.data()?.activeContestId !== contest.id) {
      await controlRef.set({
        activeContestId: contest.id,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    return contest;
  }

  const scheduled = await db
    .collection(contestCollections.contests)
    .where("status", "==", "scheduled")
    .get();
  const candidate = scheduled.docs
    .map((entry) => document<Contest>(entry))
    .filter((contest) => Date.parse(contest.startAt) <= nowMs && Date.parse(contest.endAt) > nowMs)
    .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt))[0];
  if (!candidate) return null;
  try {
    return await transitionContest(db, candidate.id, "active", {
      actorType: "system",
      actorId: "contest-lifecycle",
    }, now);
  } catch (error) {
    if (error instanceof ContestError && error.code === "another_contest_active") {
      return null;
    }
    throw error;
  }
}

export async function getPublicContest(
  db: FirebaseFirestore.Firestore,
  now = new Date(),
): Promise<PublicContest | null> {
  const active = await synchronizeContestLifecycle(db, now);
  if (active) return publicContest(active, now);
  const scheduled = await db
    .collection(contestCollections.contests)
    .where("status", "==", "scheduled")
    .get();
  const next = scheduled.docs
    .map((entry) => document<Contest>(entry))
    .filter((contest) => Date.parse(contest.endAt) > now.getTime())
    .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt))[0];
  return next ? publicContest(next, now) : null;
}

export async function createContestEntry(
  db: FirebaseFirestore.Firestore,
  rawInput: unknown,
  now = new Date(),
) {
  if (!rawInput || typeof rawInput !== "object") throw new ContestError("Participation invalide.");
  const input = rawInput as {
    contestId?: string;
    displayName?: string;
    email?: string;
    rulesAccepted?: boolean;
    marketingConsent?: boolean;
  };
  const contestId = cleanText(input.contestId, 120);
  const displayName = cleanText(input.displayName, 80);
  const email = normalizeContestEmail(input.email || "");
  if (!contestId) throw new ContestError("Concours requis.");
  if (displayName.length < 2) throw new ContestError("Prenom ou pseudo requis.");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ContestError("Adresse e-mail invalide.");
  }
  if (input.rulesAccepted !== true) {
    throw new ContestError("L'acceptation du reglement est obligatoire.");
  }

  await synchronizeContestLifecycle(db, now);
  const emailHash = contestEmailHash(contestId, email);
  const contestRef = db.collection(contestCollections.contests).doc(contestId);
  const entryRef = db.collection(contestCollections.entries).doc(emailHash);
  const counterRef = db.collection("counters").doc(`contest-entry-${contestId}`);
  let publicId = "";
  await db.runTransaction(async (transaction) => {
    const [contestSnapshot, duplicateSnapshot, counterSnapshot] = await Promise.all([
      transaction.get(contestRef),
      transaction.get(entryRef),
      transaction.get(counterRef),
    ]);
    if (!contestSnapshot.exists) throw new ContestError("Concours introuvable.", 404);
    const contest = document<Contest>(contestSnapshot);
    assertContestAcceptsEntry(contest, now);
    if (duplicateSnapshot.exists) {
      throw new ContestError(
        "Une participation existe deja pour cet e-mail.",
        409,
        "duplicate_entry",
      );
    }
    const entrySequence = Number(counterSnapshot.data()?.value || 0) + 1;
    publicId = `VDZ-${String(contest.sequenceNumber).padStart(3, "0")}-${String(entrySequence).padStart(5, "0")}`;
    transaction.set(entryRef, {
      contestId,
      publicId,
      displayName,
      email,
      emailNormalized: email,
      emailHash,
      rulesAccepted: true,
      marketingConsent: input.marketingConsent === true,
      status: "eligible",
      source: "web",
      enteredAt: FieldValue.serverTimestamp(),
    });
    transaction.set(
      counterRef,
      { value: entrySequence, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    transaction.update(contestRef, {
      entryCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { entryId: entryRef.id, publicId };
}

export async function listAdminContests(db: FirebaseFirestore.Firestore) {
  await synchronizeContestLifecycle(db);
  const snapshot = await db.collection(contestCollections.contests).get();
  return snapshot.docs
    .map((entry) => document<Contest>(entry))
    .sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""));
}

export async function getAdminContestDetail(
  db: FirebaseFirestore.Firestore,
  contestId: string,
  options: { page?: number; pageSize?: number; search?: string } = {},
) {
  const contest = await getContest(db, contestId);
  await synchronizeContestPrizeExpirations(db, contestId);
  const [entrySnapshot, drawSnapshot, prizeSnapshot, auditSnapshot] = await Promise.all([
    db.collection(contestCollections.entries).where("contestId", "==", contestId).get(),
    db.collection(contestCollections.draws).where("contestId", "==", contestId).get(),
    db.collection(contestCollections.prizes).where("contestId", "==", contestId).get(),
    db.collection(contestCollections.audits).where("contestId", "==", contestId).get(),
  ]);
  const search = normalizeContestEmail(options.search || "");
  const allEntries = entrySnapshot.docs
    .map((entry) => document<ContestEntry>(entry))
    .filter((entry) => {
      if (!search) return true;
      return [entry.publicId, entry.displayName, entry.email]
        .join(" ")
        .toLowerCase()
        .includes(search);
    })
    .sort((left, right) => dateValue(right.enteredAt) - dateValue(left.enteredAt));
  const pageSize = Math.min(100, Math.max(10, Number(options.pageSize || 50)));
  const page = Math.max(1, Number(options.page || 1));
  const start = (page - 1) * pageSize;
  return {
    contest,
    entries: allEntries.slice(start, start + pageSize),
    entryTotal: allEntries.length,
    page,
    pageSize,
    draws: drawSnapshot.docs
      .map((entry) => document<ContestDraw>(entry))
      .sort((left, right) => right.drawNumber - left.drawNumber),
    prizes: prizeSnapshot.docs
      .map((entry) => document<ContestPrize>(entry))
      .sort((left, right) => dateValue(right.createdAt) - dateValue(left.createdAt)),
    audits: auditSnapshot.docs
      .map((entry) => document<ContestAuditLog>(entry))
      .sort((left, right) => dateValue(right.createdAt) - dateValue(left.createdAt))
      .slice(0, 200),
  };
}

export async function cancelContestPrize(
  db: FirebaseFirestore.Firestore,
  contestId: string,
  prizeId: string,
  reasonValue: unknown,
  actor: Actor,
) {
  const reason = cleanText(reasonValue, 1_000);
  if (reason.length < 3) throw new ContestError("Un motif d'annulation est obligatoire.");
  const prizeRef = db.collection(contestCollections.prizes).doc(prizeId);
  await db.runTransaction(async (transaction) => {
    const prizeSnapshot = await transaction.get(prizeRef);
    if (!prizeSnapshot.exists) throw new ContestError("Gain introuvable.", 404);
    const prize = document<ContestPrize>(prizeSnapshot);
    if (prize.contestId !== contestId) throw new ContestError("Gain incoherent.", 409);
    if (!["issued", "claimed"].includes(prize.status)) {
      throw new ContestError("Ce gain ne peut plus etre annule.", 409);
    }
    const couponRef = db.collection("coupons").doc(prize.couponId);
    transaction.update(prizeRef, {
      status: "cancelled",
      cancelledAt: FieldValue.serverTimestamp(),
      cancellationReason: reason,
    });
    transaction.set(couponRef, {
      isActive: false,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    writeAudit(transaction, db, {
      action: "prize_cancelled",
      contestId,
      drawId: prize.drawId,
      prizeId,
      ...actor,
      reason,
    });
  });
}

export async function synchronizeContestPrizeExpirations(
  db: FirebaseFirestore.Firestore,
  contestId: string,
  now = new Date(),
) {
  const snapshot = await db
    .collection(contestCollections.prizes)
    .where("contestId", "==", contestId)
    .get();
  for (const prizeSnapshot of snapshot.docs) {
    const prize = document<ContestPrize>(prizeSnapshot);
    if (
      !["issued", "claimed"].includes(prize.status) ||
      Date.parse(prize.expiresAt) > now.getTime()
    ) {
      continue;
    }
    await db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(prizeSnapshot.ref);
      if (!currentSnapshot.exists) return;
      const current = document<ContestPrize>(currentSnapshot);
      if (
        !["issued", "claimed"].includes(current.status) ||
        Date.parse(current.expiresAt) > now.getTime()
      ) {
        return;
      }
      const couponRef = db.collection("coupons").doc(current.couponId);
      transaction.update(prizeSnapshot.ref, {
        status: "expired",
        expiredAt: FieldValue.serverTimestamp(),
      });
      transaction.set(couponRef, {
        isActive: false,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      writeAudit(transaction, db, {
        action: "prize_expired",
        contestId,
        drawId: current.drawId,
        prizeId: current.id,
        actorType: "system",
        actorId: "prize-lifecycle",
      });
    });
  }
}

export async function performContestDraw(
  db: FirebaseFirestore.Firestore,
  contestId: string,
  actor: Actor,
  now = new Date(),
) {
  const contest = await getContest(db, contestId);
  if (contest.status !== "closed") {
    throw new ContestError("Le tirage exige un concours cloture.", 409, "draw_requires_closed");
  }
  if (now.getTime() < Date.parse(contest.endAt)) {
    throw new ContestError("Le tirage est impossible avant la cloture.", 409, "draw_too_early");
  }
  const [entrySnapshot, previousDrawSnapshot] = await Promise.all([
    db.collection(contestCollections.entries).where("contestId", "==", contestId).get(),
    db.collection(contestCollections.draws).where("contestId", "==", contestId).get(),
  ]);
  const previousDraws = previousDrawSnapshot.docs.map((entry) => document<ContestDraw>(entry));
  const excludedWinners = new Set(previousDraws.map((draw) => draw.winnerEntryId));
  const eligibleEntries = entrySnapshot.docs
    .map((entry) => document<ContestEntry>(entry))
    .filter((entry) => entry.status === "eligible" && !excludedWinners.has(entry.id));
  if (eligibleEntries.length > maxDrawEntries) {
    throw new ContestError(
      `Le tirage V1 est limite a ${maxDrawEntries} participations eligibles.`,
      409,
      "draw_population_too_large",
    );
  }
  const selection = selectContestWinner(eligibleEntries.map((entry) => entry.id));
  const winner = eligibleEntries.find((entry) => entry.id === selection.winnerEntryId);
  if (!winner) throw new ContestError("Participation gagnante introuvable.", 500);
  const drawRef = db.collection(contestCollections.draws).doc();
  const contestRef = db.collection(contestCollections.contests).doc(contestId);
  const drawNumber = previousDraws.length + 1;

  await db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(contestRef);
    if (!currentSnapshot.exists) throw new ContestError("Concours introuvable.", 404);
    const current = document<Contest>(currentSnapshot);
    if (current.status !== "closed" || current.currentDrawId) {
      throw new ContestError("Un tirage existe deja ou est en cours.", 409, "draw_already_exists");
    }
    transaction.set(drawRef, {
      drawId: drawRef.id,
      contestId,
      drawNumber,
      eligibleEntryCount: selection.sortedIds.length,
      eligibleEntryIds: selection.sortedIds,
      snapshotHash: selection.snapshotHash,
      winnerEntryId: winner.id,
      winnerPublicId: winner.publicId,
      winnerStatus: "pending",
      drawnAt: FieldValue.serverTimestamp(),
      algorithmVersion: contestDrawAlgorithmVersion,
      performedBy: actor.actorId,
    });
    transaction.update(contestRef, {
      status: "winner_pending",
      currentDrawId: drawRef.id,
      winnerEntryId: winner.id,
      updatedBy: actor.actorId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAudit(transaction, db, {
      action: "snapshot_created",
      contestId,
      drawId: drawRef.id,
      ...actor,
      metadata: {
        eligibleEntryCount: selection.sortedIds.length,
        snapshotHash: selection.snapshotHash,
        algorithmVersion: contestDrawAlgorithmVersion,
      },
    });
    writeAudit(transaction, db, {
      action: "draw_completed",
      contestId,
      drawId: drawRef.id,
      ...actor,
      before: { status: "closed" },
      after: { status: "winner_pending" },
    });
    writeAudit(transaction, db, {
      action: "winner_selected",
      contestId,
      drawId: drawRef.id,
      ...actor,
      metadata: { winnerEntryId: winner.id, winnerPublicId: winner.publicId },
    });
  });
  return { drawId: drawRef.id, winnerEntryId: winner.id, winnerPublicId: winner.publicId };
}

export async function invalidateContestWinner(
  db: FirebaseFirestore.Firestore,
  contestId: string,
  reasonValue: unknown,
  actor: Actor,
) {
  const reason = cleanText(reasonValue, 1_000);
  if (reason.length < 3) {
    throw new ContestError("Un motif d'invalidation explicite est obligatoire.");
  }
  const contestRef = db.collection(contestCollections.contests).doc(contestId);
  await db.runTransaction(async (transaction) => {
    const contestSnapshot = await transaction.get(contestRef);
    if (!contestSnapshot.exists) throw new ContestError("Concours introuvable.", 404);
    const contest = document<Contest>(contestSnapshot);
    if (contest.status !== "winner_pending" || !contest.currentDrawId) {
      throw new ContestError("Aucun gagnant en attente de validation.", 409);
    }
    const drawRef = db.collection(contestCollections.draws).doc(contest.currentDrawId);
    const drawSnapshot = await transaction.get(drawRef);
    if (!drawSnapshot.exists) throw new ContestError("Tirage introuvable.", 404);
    const draw = document<ContestDraw>(drawSnapshot);
    if (draw.winnerStatus !== "pending") {
      throw new ContestError("Ce resultat a deja ete traite.", 409);
    }
    transaction.update(drawRef, {
      winnerStatus: "invalidated",
      invalidationReason: reason,
      invalidatedBy: actor.actorId,
      invalidatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(contestRef, {
      status: "closed",
      currentDrawId: FieldValue.delete(),
      winnerEntryId: FieldValue.delete(),
      updatedBy: actor.actorId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAudit(transaction, db, {
      action: "winner_invalidated",
      contestId,
      drawId: draw.id,
      ...actor,
      reason,
      metadata: { winnerEntryId: draw.winnerEntryId },
    });
    writeAudit(transaction, db, {
      action: "redraw_requested",
      contestId,
      drawId: draw.id,
      ...actor,
      reason,
    });
  });
}

export async function validateContestWinner(
  db: FirebaseFirestore.Firestore,
  contestId: string,
  actor: Actor,
  now = new Date(),
) {
  const contestRef = db.collection(contestCollections.contests).doc(contestId);
  const initialContest = await getContest(db, contestId);
  if (initialContest.status === "completed" && initialContest.prizeId) {
    const existing = await getPrize(db, initialContest.prizeId);
    return { prize: existing, claimToken: "", existing: true };
  }
  if (initialContest.status !== "winner_pending" || !initialContest.currentDrawId) {
    throw new ContestError("Aucun gagnant en attente de validation.", 409);
  }
  const drawRef = db.collection(contestCollections.draws).doc(initialContest.currentDrawId);
  const drawSnapshot = await drawRef.get();
  if (!drawSnapshot.exists) throw new ContestError("Tirage introuvable.", 404);
  const initialDraw = document<ContestDraw>(drawSnapshot);
  const entryRef = db.collection(contestCollections.entries).doc(initialDraw.winnerEntryId);
  const prizeRef = db.collection(contestCollections.prizes).doc();
  const code = generatePrizeCode();
  const couponRef = db.collection("coupons").doc(code.toLowerCase());
  const claimToken = crypto.randomBytes(32).toString("base64url");
  const claimTokenHash = contestClaimTokenHash(claimToken);
  const expiresAt = new Date(
    now.getTime() + initialContest.prizeExpirationDays * 24 * 60 * 60_000,
  ).toISOString();
  let prize: ContestPrize | null = null;

  await db.runTransaction(async (transaction) => {
    const [contestSnapshot, drawCurrent, entrySnapshot, couponSnapshot] = await Promise.all([
      transaction.get(contestRef),
      transaction.get(drawRef),
      transaction.get(entryRef),
      transaction.get(couponRef),
    ]);
    if (!contestSnapshot.exists || !drawCurrent.exists || !entrySnapshot.exists) {
      throw new ContestError("Donnees du gagnant incompletes.", 409);
    }
    if (couponSnapshot.exists) throw new ContestError("Collision de code de gain.", 409);
    const contest = document<Contest>(contestSnapshot);
    const draw = document<ContestDraw>(drawCurrent);
    const entry = document<ContestEntry>(entrySnapshot);
    if (contest.status !== "winner_pending" || contest.currentDrawId !== draw.id) {
      throw new ContestError("Le gagnant a deja ete traite.", 409);
    }
    if (draw.winnerStatus !== "pending" || entry.status !== "eligible") {
      throw new ContestError("Le gagnant n'est plus eligible.", 409);
    }
    const emailHash = contestEmailHash(contestId, entry.email);
    prize = {
      id: prizeRef.id,
      contestId,
      drawId: draw.id,
      winnerEntryId: entry.id,
      winnerPublicId: entry.publicId,
      winnerDisplayName: entry.displayName,
      winnerEmail: entry.email,
      winnerEmailHash: emailHash,
      value: contest.prizeValue,
      type: "store_credit",
      couponId: couponRef.id,
      code,
      status: "issued",
      claimTokenHash,
      claimTokenLastFour: claimToken.slice(-4),
      invitationVersion: 1,
      expiresAt,
    };
    transaction.set(prizeRef, {
      ...prize,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.set(couponRef, {
      code,
      label: `Gain ${contest.title}`,
      discountType: "fixed",
      discountValue: contest.prizeValue,
      minimumOrder: 0,
      autoApply: false,
      promotionType: "fixed_cart_discount",
      stackable: false,
      priority: 1,
      maxUses: 1,
      usedCount: 0,
      startsAt: now.toISOString(),
      endsAt: expiresAt,
      isActive: true,
      isArchived: false,
      productIds: [],
      categories: [],
      source: "contest",
      contestId,
      contestPrizeId: prizeRef.id,
      redeemableByEmailHash: emailHash,
      internalNote: `Gain ${entry.publicId} - ${contest.title}`,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(drawRef, {
      winnerStatus: "validated",
      validatedBy: actor.actorId,
      validatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(contestRef, {
      status: "completed",
      prizeId: prizeRef.id,
      updatedBy: actor.actorId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAudit(transaction, db, {
      action: "winner_validated",
      contestId,
      drawId: draw.id,
      prizeId: prizeRef.id,
      ...actor,
      metadata: { winnerEntryId: entry.id, winnerPublicId: entry.publicId },
    });
    writeAudit(transaction, db, {
      action: "prize_created",
      contestId,
      drawId: draw.id,
      prizeId: prizeRef.id,
      ...actor,
      metadata: { value: contest.prizeValue, couponId: couponRef.id, expiresAt },
    });
  });
  if (!prize) throw new ContestError("Creation du gain impossible.", 500);
  return { prize, claimToken, existing: false };
}

export async function rotateContestPrizeClaimToken(
  db: FirebaseFirestore.Firestore,
  contestId: string,
  prizeId: string,
  actor: Actor,
) {
  const claimToken = crypto.randomBytes(32).toString("base64url");
  const claimTokenHash = contestClaimTokenHash(claimToken);
  const prizeRef = db.collection(contestCollections.prizes).doc(prizeId);
  let rotatedPrize: ContestPrize | null = null;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(prizeRef);
    if (!snapshot.exists) throw new ContestError("Gain introuvable.", 404);
    const prize = document<ContestPrize>(snapshot);
    if (prize.contestId !== contestId) throw new ContestError("Gain incoherent.", 409);
    if (!["issued", "claimed"].includes(prize.status)) {
      throw new ContestError("L'invitation de ce gain ne peut plus etre renvoyee.", 409);
    }
    if (Date.parse(prize.expiresAt) <= Date.now()) {
      throw new ContestError("Le gain est expire.", 409, "contest_prize_expired");
    }
    const invitationVersion = Number(prize.invitationVersion || 1) + 1;
    rotatedPrize = {
      ...prize,
      claimTokenHash,
      claimTokenLastFour: claimToken.slice(-4),
      invitationVersion,
    };
    transaction.update(prizeRef, {
      claimTokenHash,
      claimTokenLastFour: claimToken.slice(-4),
      invitationVersion,
      invitationRotatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAudit(transaction, db, {
      action: "prize_invitation_rotated",
      contestId,
      drawId: prize.drawId,
      prizeId,
      ...actor,
      metadata: {
        previousInvitationVersion: Number(prize.invitationVersion || 1),
        invitationVersion,
      },
    });
  });
  if (!rotatedPrize) throw new ContestError("Rotation de l'invitation impossible.", 500);
  return { prize: rotatedPrize, claimToken };
}

export async function getContestPrizeByToken(
  db: FirebaseFirestore.Firestore,
  rawToken: unknown,
  now = new Date(),
) {
  const token = cleanText(rawToken, 200);
  if (token.length < 32) throw new ContestError("Lien de gain invalide.", 404);
  const tokenHash = contestClaimTokenHash(token);
  const snapshot = await db
    .collection(contestCollections.prizes)
    .where("claimTokenHash", "==", tokenHash)
    .limit(1)
    .get();
  if (snapshot.empty) throw new ContestError("Lien de gain invalide.", 404);
  const prize = document<ContestPrize>(snapshot.docs[0]);
  const prizeRef = snapshot.docs[0].ref;
  const contest = await getContest(db, prize.contestId);
  let nextStatus = prize.status;
  if (!["redeemed", "expired", "cancelled"].includes(prize.status)) {
    if (now.getTime() >= Date.parse(prize.expiresAt)) {
      await db.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(prizeRef);
        if (!currentSnapshot.exists) return;
        const current = document<ContestPrize>(currentSnapshot);
        if (["redeemed", "expired", "cancelled"].includes(current.status)) return;
        transaction.update(prizeRef, {
          status: "expired",
          expiredAt: FieldValue.serverTimestamp(),
        });
        transaction.set(db.collection("coupons").doc(current.couponId), {
          isActive: false,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        writeAudit(transaction, db, {
          action: "prize_expired",
          contestId: prize.contestId,
          drawId: prize.drawId,
          prizeId: prize.id,
          actorType: "system",
          actorId: "prize-access",
        });
      });
      nextStatus = "expired";
    } else if (prize.status === "issued") {
      await db.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(prizeRef);
        if (!currentSnapshot.exists || currentSnapshot.data()?.status !== "issued") return;
        transaction.update(prizeRef, {
          status: "claimed",
          claimedAt: FieldValue.serverTimestamp(),
        });
        writeAudit(transaction, db, {
          action: "prize_claimed",
          contestId: prize.contestId,
          drawId: prize.drawId,
          prizeId: prize.id,
          actorType: "winner",
          actorId: prize.winnerPublicId,
        });
      });
      nextStatus = "claimed";
    }
  }
  return {
    contest: { id: contest.id, title: contest.title },
    prize: {
      id: prize.id,
      value: prize.value,
      type: prize.type,
      code: prize.code,
      status: nextStatus,
      expiresAt: prize.expiresAt,
      winnerDisplayName: prize.winnerDisplayName,
      claimedAt: prize.claimedAt,
      redeemedAt: prize.redeemedAt,
      orderId: prize.orderId,
    },
  };
}

export async function getContest(
  db: FirebaseFirestore.Firestore,
  contestId: string,
) {
  const snapshot = await db.collection(contestCollections.contests).doc(contestId).get();
  if (!snapshot.exists) throw new ContestError("Concours introuvable.", 404);
  return document<Contest>(snapshot);
}

export async function getPrize(db: FirebaseFirestore.Firestore, prizeId: string) {
  const snapshot = await db.collection(contestCollections.prizes).doc(prizeId).get();
  if (!snapshot.exists) throw new ContestError("Gain introuvable.", 404);
  return document<ContestPrize>(snapshot);
}

export function serializeContestResponse<T>(value: T): T {
  return serializeValue(value) as T;
}

function publicContest(contest: Contest, now: Date): PublicContest {
  return {
    id: contest.id,
    title: contest.title,
    slug: contest.slug,
    description: contest.description,
    prizeValue: contest.prizeValue,
    prizeType: contest.prizeType,
    startAt: contest.startAt,
    endAt: contest.endAt,
    drawAt: contest.drawAt,
    status: contest.status,
    rulesUrl: contest.rulesUrl,
    rulesText: contest.rulesText,
    eligibilityConditions: contest.eligibilityConditions,
    acceptingEntries:
      contest.status === "active" &&
      now.getTime() >= Date.parse(contest.startAt) &&
      now.getTime() < Date.parse(contest.endAt),
  };
}

function assertTransition(contest: Contest, nextStatus: ContestStatus, now: Date) {
  const allowed: Partial<Record<ContestStatus, ContestStatus[]>> = {
    draft: ["scheduled", "active", "cancelled"],
    scheduled: ["draft", "active", "cancelled"],
    active: ["closed", "cancelled"],
    closed: ["cancelled"],
  };
  if (!(allowed[contest.status] || []).includes(nextStatus)) {
    throw new ContestError(
      `Transition ${contest.status} vers ${nextStatus} interdite.`,
      409,
      "contest_transition_forbidden",
    );
  }
  const nowMs = now.getTime();
  if (nextStatus === "scheduled" && Date.parse(contest.startAt) <= nowMs) {
    throw new ContestError("Un concours programme doit commencer dans le futur.");
  }
  if (nextStatus === "active") {
    if (nowMs < Date.parse(contest.startAt)) throw new ContestError("Le concours n'a pas encore commence.");
    if (nowMs >= Date.parse(contest.endAt)) throw new ContestError("Le concours est deja termine.");
  }
  if (nextStatus === "closed" && nowMs < Date.parse(contest.endAt)) {
    throw new ContestError("La cloture est impossible avant la date de fin.", 409);
  }
}

function writeAudit(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  input: Omit<ContestAuditLog, "id" | "createdAt">,
) {
  const ref = db.collection(contestCollections.audits).doc();
  transaction.set(ref, {
    ...input,
    createdAt: FieldValue.serverTimestamp(),
  });
}

function document<T extends { id: string }>(snapshot: FirebaseFirestore.DocumentSnapshot) {
  return serializeContestResponse({ id: snapshot.id, ...snapshot.data() }) as T;
}

function auditContestConfiguration(value: Partial<ContestInput> & Record<string, unknown>) {
  return {
    title: value.title,
    slug: value.slug,
    prizeValue: value.prizeValue,
    prizeType: value.prizeType,
    startAt: value.startAt,
    endAt: value.endAt,
    drawAt: value.drawAt,
    prizeExpirationDays: value.prizeExpirationDays,
  };
}

function serializeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(serializeValue);
  if (!value || typeof value !== "object") return value;
  const timestamp = value as { toDate?: () => Date; toMillis?: () => number; seconds?: number };
  if (typeof timestamp.toDate === "function") return timestamp.toDate().toISOString();
  if (typeof timestamp.toMillis === "function") return new Date(timestamp.toMillis()).toISOString();
  if (typeof timestamp.seconds === "number" && Object.keys(value).length <= 2) {
    return new Date(timestamp.seconds * 1000).toISOString();
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, serializeValue(entry)]),
  );
}

function contestSecuritySecret() {
  const secret = process.env.RATE_LIMIT_HMAC_SECRET;
  if (!secret || secret.length < 32) {
    throw new ContestError(
      "Configuration de securite du concours indisponible.",
      503,
      "contest_security_config_missing",
    );
  }
  return secret;
}

function generatePrizeCode() {
  return `VDZ-${crypto.randomBytes(10).toString("hex").toUpperCase()}`;
}

function cleanText(value: unknown, maximum = 500) {
  return String(value || "").normalize("NFKC").trim().slice(0, maximum);
}

function cleanOptionalUrl(value: unknown) {
  const text = cleanText(value, 2_000);
  if (!text) return undefined;
  let url: URL;
  try {
    url = new URL(text, "https://verdanza.fr");
  } catch {
    throw new ContestError("Lien du reglement invalide.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new ContestError("Lien du reglement invalide.");
  }
  return url.toString();
}

function slugify(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function validIsoDate(value: unknown, error: string) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) throw new ContestError(error);
  return new Date(timestamp).toISOString();
}

function money(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function dateValue(value: unknown) {
  if (typeof value === "string") return Date.parse(value) || 0;
  if (value && typeof value === "object") {
    const timestamp = value as { toMillis?: () => number; seconds?: number };
    if (typeof timestamp.toMillis === "function") return timestamp.toMillis();
    if (typeof timestamp.seconds === "number") return timestamp.seconds * 1000;
  }
  return 0;
}
