import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Firestore } from "firebase-admin/firestore";
import { handleAdminContests as adminContestsHandler } from "../api/_server/contestAdminRoute";
import {
  ContestError,
  assertContestAcceptsEntry,
  assertContestPrizeRedeemable,
  contestClaimTokenHash,
  contestCollections,
  contestDrawAlgorithmVersion,
  contestEmailHash,
  cancelContestPrize,
  createContestEntry,
  getContestPrizeByToken,
  invalidateContestWinner,
  performContestDraw,
  rotateContestPrizeClaimToken,
  selectContestWinner,
  validateContestWinner,
} from "../api/_server/contests";
import type { Contest, ContestEntry, ContestPrize } from "../src/types/contests";

process.env.RATE_LIMIT_HMAC_SECRET = "contest-test-secret-with-at-least-thirty-two-characters";

const now = new Date("2026-08-22T12:00:00.000Z");

assert.throws(
  () => assertContestAcceptsEntry(contestFixture({ startAt: "2026-08-23T12:00:00.000Z" }), now),
  (error: unknown) => error instanceof ContestError && error.code === "contest_not_started",
  "participation before the period must be rejected",
);
assert.throws(
  () => assertContestAcceptsEntry(contestFixture({ endAt: "2026-08-22T11:59:59.000Z" }), now),
  (error: unknown) => error instanceof ContestError && error.code === "contest_closed",
  "participation after the period must be rejected",
);
assert.equal(selectContestWinner(["only-entry"], () => 0).winnerEntryId, "only-entry");
assert.throws(
  () => selectContestWinner([]),
  (error: unknown) => error instanceof ContestError && error.code === "draw_empty",
  "draw without participants must be rejected",
);

async function testParticipationAndDuplicate() {
  const db = new FakeFirestore();
  db.seed(contestCollections.contests, "contest-active", contestFixture());
  const result = await createContestEntry(db.asFirestore(), {
    contestId: "contest-active",
    displayName: "Camille",
    email: " Camille@Example.test ",
    rulesAccepted: true,
    marketingConsent: false,
  }, now);
  assert.match(result.publicId, /^VDZ-001-00001$/);
  const entry = db.get(contestCollections.entries, result.entryId) as ContestEntry;
  assert.equal(entry.email, "camille@example.test");
  assert.equal(entry.marketingConsent, false);
  await assert.rejects(
    createContestEntry(db.asFirestore(), {
      contestId: "contest-active",
      displayName: "Autre nom",
      email: "CAMILLE@example.test",
      rulesAccepted: true,
      marketingConsent: true,
    }, now),
    (error: unknown) => error instanceof ContestError && error.code === "duplicate_entry",
  );

  const beforeDb = new FakeFirestore();
  beforeDb.seed(contestCollections.contests, "before", contestFixture({
    id: "before",
    startAt: "2026-08-23T12:00:00.000Z",
  }));
  await assert.rejects(
    createContestEntry(beforeDb.asFirestore(), {
      contestId: "before",
      displayName: "Camille",
      email: "before@example.test",
      rulesAccepted: true,
    }, now),
    (error: unknown) => error instanceof ContestError && error.code === "contest_not_started",
  );
}

async function testDrawLifecycleAndRedraw() {
  const tooEarlyDb = new FakeFirestore();
  tooEarlyDb.seed(contestCollections.contests, "too-early", contestFixture({
    id: "too-early",
    status: "closed",
    endAt: "2026-08-23T12:00:00.000Z",
    drawAt: "2026-08-23T13:00:00.000Z",
  }));
  await assert.rejects(
    performContestDraw(tooEarlyDb.asFirestore(), "too-early", adminActor(), now),
    (error: unknown) => error instanceof ContestError && error.code === "draw_too_early",
  );

  const emptyDb = new FakeFirestore();
  emptyDb.seed(contestCollections.contests, "empty", contestFixture({
    id: "empty",
    status: "closed",
    endAt: "2026-08-22T11:00:00.000Z",
    drawAt: "2026-08-22T11:30:00.000Z",
  }));
  await assert.rejects(
    performContestDraw(emptyDb.asFirestore(), "empty", adminActor(), now),
    (error: unknown) => error instanceof ContestError && error.code === "draw_empty",
  );

  const db = new FakeFirestore();
  db.seed(contestCollections.contests, "draw", contestFixture({
    id: "draw",
    status: "closed",
    endAt: "2026-08-22T11:00:00.000Z",
    drawAt: "2026-08-22T11:30:00.000Z",
  }));
  db.seed(contestCollections.entries, "entry-a", entryFixture("entry-a", "VDZ-001-00001"));
  db.seed(contestCollections.entries, "entry-b", entryFixture("entry-b", "VDZ-001-00002"));
  const first = await performContestDraw(db.asFirestore(), "draw", adminActor(), now);
  const firstDraw = db.get(contestCollections.draws, first.drawId) as Record<string, unknown>;
  assert.equal(firstDraw.algorithmVersion, contestDrawAlgorithmVersion);
  assert.equal(firstDraw.eligibleEntryCount, 2);
  assert.equal(String(firstDraw.snapshotHash).length, 64);
  await assert.rejects(
    performContestDraw(db.asFirestore(), "draw", adminActor(), now),
    /cloture|existe deja|en cours/i,
    "an existing draw cannot be overwritten",
  );
  await assert.rejects(
    invalidateContestWinner(db.asFirestore(), "draw", "", adminActor()),
    /motif/i,
  );
  await invalidateContestWinner(db.asFirestore(), "draw", "Adresse e-mail non verifiable", adminActor());
  const second = await performContestDraw(db.asFirestore(), "draw", adminActor(), now);
  assert.notEqual(second.winnerEntryId, first.winnerEntryId, "redraw must exclude the previous winner");
  assert.equal(
    (db.get(contestCollections.draws, first.drawId) as Record<string, unknown>).winnerEntryId,
    first.winnerEntryId,
    "the first result must remain preserved",
  );
}

async function testPrizeLifecycle() {
  const db = new FakeFirestore();
  const contest = contestFixture({
    id: "prize-contest",
    status: "winner_pending",
    currentDrawId: "draw-1",
    winnerEntryId: "winner-entry",
  });
  db.seed(contestCollections.contests, contest.id, contest);
  db.seed(contestCollections.entries, "winner-entry", entryFixture(
    "winner-entry",
    "VDZ-001-00001",
    contest.id,
    "winner@example.test",
  ));
  db.seed(contestCollections.draws, "draw-1", {
    id: "draw-1",
    drawId: "draw-1",
    contestId: contest.id,
    drawNumber: 1,
    eligibleEntryCount: 1,
    eligibleEntryIds: ["winner-entry"],
    snapshotHash: "a".repeat(64),
    winnerEntryId: "winner-entry",
    winnerPublicId: "VDZ-001-00001",
    winnerStatus: "pending",
    algorithmVersion: contestDrawAlgorithmVersion,
    performedBy: "admin@example.test",
  });

  const issued = await validateContestWinner(db.asFirestore(), contest.id, adminActor(), now);
  assert.equal(issued.existing, false);
  assert.match(issued.prize.code, /^VDZ-[A-F0-9]{20}$/);
  const coupon = db.get("coupons", issued.prize.couponId) as Record<string, unknown>;
  assert.equal(coupon.maxUses, 1, "contest coupons must be single-use");
  assert.equal(coupon.source, "contest");
  const repeated = await validateContestWinner(db.asFirestore(), contest.id, adminActor(), now);
  assert.equal(repeated.existing, true, "prize generation must be idempotent");
  assert.equal(repeated.prize.id, issued.prize.id);

  const rotated = await rotateContestPrizeClaimToken(
    db.asFirestore(),
    contest.id,
    issued.prize.id,
    adminActor(),
  );
  assert.equal(rotated.prize.invitationVersion, 2);
  assert.notEqual(rotated.prize.claimTokenHash, issued.prize.claimTokenHash);
  await assert.rejects(
    getContestPrizeByToken(db.asFirestore(), issued.claimToken, now),
    /invalide/i,
    "rotating an invitation must invalidate the previous token",
  );
  const rotatedView = await getContestPrizeByToken(db.asFirestore(), rotated.claimToken, now);
  assert.equal(rotatedView.prize.status, "claimed");

  await assert.rejects(
    cancelContestPrize(db.asFirestore(), contest.id, issued.prize.id, "", adminActor()),
    /motif/i,
    "prize cancellation must require a reason",
  );

  const redeemable = {
    ...issued.prize,
    winnerEmailHash: contestEmailHash(contest.id, "winner@example.test"),
  };
  assert.doesNotThrow(() => assertContestPrizeRedeemable(redeemable, {
    couponId: issued.prize.couponId,
    email: "WINNER@example.test",
    now,
  }));
  assert.throws(
    () => assertContestPrizeRedeemable({ ...redeemable, status: "redeemed" }, {
      couponId: issued.prize.couponId,
      email: "winner@example.test",
      now,
    }),
    /deja utilise|indisponible/i,
    "a redeemed prize cannot be used twice",
  );
  assert.throws(
    () => assertContestPrizeRedeemable({ ...redeemable, expiresAt: "2026-08-21T12:00:00.000Z" }, {
      couponId: issued.prize.couponId,
      email: "winner@example.test",
      now,
    }),
    /expire/i,
  );

  const token = "winner-token-with-more-than-thirty-two-characters-123";
  const expiredPrize: ContestPrize = {
    ...issued.prize,
    id: "expired-prize",
    status: "issued",
    claimTokenHash: contestClaimTokenHash(token),
    claimTokenLastFour: "-123",
    expiresAt: "2026-08-21T12:00:00.000Z",
  };
  db.seed(contestCollections.prizes, expiredPrize.id, expiredPrize);
  const view = await getContestPrizeByToken(db.asFirestore(), token, now);
  assert.equal(view.prize.status, "expired");
  assert.equal((db.get(contestCollections.prizes, expiredPrize.id) as ContestPrize).status, "expired");

  await cancelContestPrize(
    db.asFirestore(),
    contest.id,
    issued.prize.id,
    "Adresse du gagnant impossible a confirmer",
    adminActor(),
  );
  const cancelled = db.get(contestCollections.prizes, issued.prize.id) as ContestPrize;
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancellationReason, "Adresse du gagnant impossible a confirmer");
  assert.equal((db.get("coupons", issued.prize.couponId) as { isActive: boolean }).isActive, false);
}

async function testAdminAuthenticationBoundary() {
  const response = new FakeResponse();
  await adminContestsHandler(
    { method: "GET", headers: {} } as never,
    response as never,
  );
  assert.equal(response.statusCode, 401);
  assert.equal((response.body as { error?: string }).error, "Token admin requis.");
}

function testFirestoreRulesBoundary() {
  const rules = readFileSync(resolve("firestore.rules"), "utf8");
  for (const collection of [
    "contests",
    "contestEntries",
    "contestDraws",
    "contestPrizes",
    "contestAuditLogs",
    "contestControls",
  ]) {
    assert.match(
      rules,
      new RegExp(`match /${collection}/\\{[^}]+\\} \\{[\\s\\S]*?allow read, write: if false;`),
      `${collection} must not be directly accessible from Firestore clients`,
    );
  }
  assert.match(rules, /resource\.data\.get\("source", ""\) != "contest"/);
  const createOrderSource = readFileSync(resolve("api/create-order.ts"), "utf8");
  assert.match(createOrderSource, /status: "redeemed"/);
  assert.match(createOrderSource, /action: "prize_redeemed"/);
}

function contestFixture(overrides: Partial<Contest> = {}): Contest {
  return {
    id: "contest-active",
    sequenceNumber: 1,
    title: "Verdanza Weekly",
    slug: "verdanza-weekly",
    description: "Concours hebdomadaire Verdanza.",
    prizeValue: 30,
    prizeType: "store_credit",
    startAt: "2026-08-21T12:00:00.000Z",
    endAt: "2026-08-23T11:00:00.000Z",
    drawAt: "2026-08-23T11:30:00.000Z",
    status: "active",
    rulesText: "Reglement complet du concours.",
    eligibilityConditions: "Personnes majeures en France.",
    prizeExpirationDays: 30,
    entryCount: 0,
    createdBy: "admin@example.test",
    updatedBy: "admin@example.test",
    ...overrides,
  };
}

function entryFixture(
  id: string,
  publicId: string,
  contestId = "draw",
  email = `${id}@example.test`,
): ContestEntry {
  return {
    id,
    publicId,
    contestId,
    displayName: id,
    email,
    emailNormalized: email,
    emailHash: contestEmailHash(contestId, email),
    rulesAccepted: true,
    marketingConsent: false,
    status: "eligible",
    source: "web",
  };
}

function adminActor() {
  return { actorType: "admin" as const, actorId: "admin@example.test" };
}

class FakeFirestore {
  private readonly collections = new Map<string, Map<string, Record<string, unknown>>>();
  private sequence = 0;

  asFirestore() {
    return this as unknown as Firestore;
  }

  seed(collection: string, id: string, value: Record<string, unknown>) {
    this.map(collection).set(id, clone(value));
  }

  get(collection: string, id: string) {
    const value = this.map(collection).get(id);
    return value ? clone(value) : undefined;
  }

  collection(name: string) {
    return new FakeQuery(this, name);
  }

  async runTransaction<T>(callback: (transaction: FakeTransaction) => Promise<T>) {
    return callback(new FakeTransaction(this));
  }

  nextId() {
    this.sequence += 1;
    return `generated-${this.sequence}`;
  }

  map(name: string) {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new Map();
      this.collections.set(name, collection);
    }
    return collection;
  }
}

class FakeQuery {
  constructor(
    readonly database: FakeFirestore,
    readonly name: string,
    readonly filters: Array<[string, unknown]> = [],
    readonly maximum?: number,
  ) {}

  doc(id = this.database.nextId()) {
    return new FakeDocumentReference(this.database, this.name, id);
  }

  where(field: string, operator: string, value: unknown) {
    assert.equal(operator, "==");
    return new FakeQuery(this.database, this.name, [...this.filters, [field, value]], this.maximum);
  }

  limit(maximum: number) {
    return new FakeQuery(this.database, this.name, this.filters, maximum);
  }

  async get() {
    const docs = [...this.database.map(this.name).entries()]
      .filter(([, data]) => this.filters.every(([field, value]) => data[field] === value))
      .slice(0, this.maximum)
      .map(([id]) => this.doc(id).snapshot());
    return { docs, empty: docs.length === 0 };
  }
}

class FakeDocumentReference {
  constructor(
    readonly database: FakeFirestore,
    readonly collectionName: string,
    readonly id: string,
  ) {}

  async get() {
    return this.snapshot();
  }

  async set(value: Record<string, unknown>, options?: { merge?: boolean }) {
    applySet(this.database, this.collectionName, this.id, value, options?.merge === true);
  }

  async update(value: Record<string, unknown>) {
    applySet(this.database, this.collectionName, this.id, value, true);
  }

  snapshot() {
    const value = this.database.get(this.collectionName, this.id);
    return {
      id: this.id,
      ref: this,
      exists: Boolean(value),
      data: () => value,
    };
  }
}

class FakeTransaction {
  constructor(private readonly database: FakeFirestore) {}

  async get(reference: FakeDocumentReference) {
    return reference.get();
  }

  set(reference: FakeDocumentReference, value: Record<string, unknown>, options?: { merge?: boolean }) {
    applySet(this.database, reference.collectionName, reference.id, value, options?.merge === true);
  }

  update(reference: FakeDocumentReference, value: Record<string, unknown>) {
    applySet(this.database, reference.collectionName, reference.id, value, true);
  }

  delete(reference: FakeDocumentReference) {
    this.database.map(reference.collectionName).delete(reference.id);
  }
}

function applySet(
  database: FakeFirestore,
  collection: string,
  id: string,
  value: Record<string, unknown>,
  merge: boolean,
) {
  const current = merge ? database.get(collection, id) || {} : {};
  const next = { ...current };
  for (const [key, entry] of Object.entries(value)) {
    if (isTransform(entry, "DeleteTransform")) {
      delete next[key];
    } else if (isTransform(entry, "NumericIncrementTransform")) {
      next[key] = Number(next[key] || 0) + Number((entry as { operand?: number }).operand || 0);
    } else if (isTransform(entry, "ServerTimestampTransform")) {
      next[key] = now.toISOString();
    } else {
      next[key] = clone(entry);
    }
  }
  database.map(collection).set(id, next);
}

function isTransform(value: unknown, name: string) {
  return Boolean(value && typeof value === "object" && value.constructor.name === name);
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

class FakeResponse {
  statusCode = 200;
  body: unknown;
  setHeader() {}
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  json(body: unknown) {
    this.body = body;
  }
}

await testParticipationAndDuplicate();
await testDrawLifecycleAndRedraw();
await testPrizeLifecycle();
await testAdminAuthenticationBoundary();
testFirestoreRulesBoundary();

console.log("Contest module tests passed");
