import assert from "node:assert/strict";
import {
  enforcePublicSubmissionRateLimit,
  type PublicRateLimitResult,
} from "../../api/_server/publicRateLimit.js";
import type { VercelRequestLike } from "../../api/_server/http.js";
import {
  assertCagnotteEmulatorAvailable,
  CAGNOTTE_DEMO,
  connectCagnotteEmulator,
  validateCagnotteTestEnvironment,
} from "../cagnotteEmulator.js";
import {
  assertCreateOrderRateLimitEvidence,
  compareRateLimitEvidence,
  CREATE_ORDER_RATE_LIMIT_GROUPS,
  projectRateLimitEvidence,
  type CreateOrderRateLimitSummary,
  type RateLimitEvidence,
} from "./rateLimitEvidence.js";

validateCagnotteTestEnvironment(process.env);
await assertCagnotteEmulatorAvailable(CAGNOTTE_DEMO);
const db = await connectCagnotteEmulator(CAGNOTTE_DEMO);
const collection = db.collection("securityRateLimits");
const secret = "local-rate-limit-window-proof-secret-0123456789abcdef";
const scenarios = [
  {
    name: "mêmes fenêtres",
    instants: [Date.UTC(2026, 8, 15, 6, 1), Date.UTC(2026, 8, 15, 6, 2)],
  },
  {
    name: "frontière 10 minutes",
    instants: [Date.UTC(2026, 8, 15, 6, 9, 59), Date.UTC(2026, 8, 15, 6, 10)],
  },
  {
    name: "frontière 30 minutes",
    instants: [Date.UTC(2026, 8, 15, 6, 29, 59), Date.UTC(2026, 8, 15, 6, 30)],
  },
  {
    name: "frontière minuit UTC",
    instants: [Date.UTC(2026, 8, 15, 23, 59, 59), Date.UTC(2026, 8, 16, 0, 0)],
  },
] as const;

try {
  const observed = new Map<string, RateLimitEvidence[]>();
  for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex += 1) {
    const scenario = scenarios[scenarioIndex];
    const evidence = await executeScenario(scenarioIndex + 1, scenario.instants);
    const summary = assertCreateOrderRateLimitEvidence(evidence, scenario.instants.length);
    assertSummaryFromInstants(summary, scenario.instants);
    observed.set(scenario.name, evidence);
    console.log(`[OK] ${scenario.name} : ${formatSummary(summary)}`);
  }

  const boundaryEvidence = requiredEvidence(observed, "frontière 10 minutes");
  assert.throws(
    () => assertLegacyCardinality(boundaryEvidence, 2),
    /ancienne assertion/,
  );
  assertCreateOrderRateLimitEvidence(boundaryEvidence, 2);
  console.log("[OK] la frontière 10 minutes échoue avec l'ancienne cardinalité et passe avec les invariants temporels");

  await clearCollection();
  const replayInstants = [
    Date.UTC(2026, 8, 15, 6, 9, 59),
    Date.UTC(2026, 8, 15, 6, 10),
  ] as const;
  const first = await submit(5, 1, replayInstants[0]);
  const second = await submit(5, 2, replayInstants[1]);
  assert.deepEqual([first.code, second.code], ["allowed", "allowed"]);
  const beforeReplay = await readEvidence();
  const replay = await submit(5, 1, Date.UTC(2026, 8, 15, 6, 20));
  assert.deepEqual([replay.allowed, replay.code], [true, "attempt_retry"]);
  const afterReplay = await readEvidence();
  assert.deepEqual(afterReplay, beforeReplay, "le rejeu exact ne doit écrire aucun document ni incrément");
  const replaySummary = assertCreateOrderRateLimitEvidence(afterReplay, replayInstants.length);
  assertSummaryFromInstants(replaySummary, replayInstants);
  console.log(`[OK] rejeu exact après frontière : ${formatSummary(replaySummary)}`);

  const sameWindowEvidence = requiredEvidence(observed, "mêmes fenêtres");
  assertCounterexample("compteur manquant", withoutFirstCounter(sameWindowEvidence));
  assertCounterexample("intervalle dupliqué", withDuplicateCounter(sameWindowEvidence));
  assertCounterexample("mauvaise borne", withBadBound(sameWindowEvidence));
  assertCounterexample("total incorrect", withWrongTotal(sameWindowEvidence));
  console.log("Tests déterministes des fenêtres rate-limit : PASS");
} finally {
  await clearCollection();
  await db.terminate();
}

async function executeScenario(scenario: number, instants: readonly number[]) {
  await clearCollection();
  const results: PublicRateLimitResult[] = [];
  for (let index = 0; index < instants.length; index += 1) {
    results.push(await submit(scenario, index + 1, instants[index]));
  }
  assert.deepEqual(
    results.map((result) => [result.allowed, result.code]),
    instants.map(() => [true, "allowed"]),
  );
  return readEvidence();
}

function submit(scenario: number, attempt: number, nowMs: number) {
  return enforcePublicSubmissionRateLimit({
    route: "/api/create-order",
    request: {
      method: "POST",
      headers: {},
      socket: { remoteAddress: "198.51.100.42" },
    } as unknown as VercelRequestLike,
    email: "rate-window@example.test",
    anonymousId: fixtureUuid(scenario, 999),
    authenticated: true,
    failurePolicy: "fail_closed",
    attemptId: fixtureUuid(scenario, attempt),
    attemptPayloadFingerprint: `scenario-${scenario}-payload-${attempt}`,
    nowMs,
    secret,
    db,
  });
}

async function readEvidence() {
  const snapshot = await collection.get();
  return snapshot.docs
    .map((document) => projectRateLimitEvidence(document.id, document.data()))
    .sort(compareRateLimitEvidence);
}

async function clearCollection() {
  const snapshot = await collection.get();
  if (snapshot.empty) return;
  const batch = db.batch();
  snapshot.docs.forEach((document) => batch.delete(document.ref));
  await batch.commit();
}

function assertSummaryFromInstants(
  summary: CreateOrderRateLimitSummary,
  admittedInstants: readonly number[],
) {
  assert.deepEqual(
    summary.groups.map((group) => ({
      signalType: group.signalType,
      windowId: group.windowId,
      durationMs: group.durationMs,
      intervals: group.intervals.map((interval) => ({
        windowStartedAtEpochMs: interval.windowStartedAtEpochMs,
        windowEndsAtEpochMs: interval.windowEndsAtEpochMs,
        count: interval.count,
      })),
    })),
    CREATE_ORDER_RATE_LIMIT_GROUPS.map((group) => {
      const counts = new Map<number, number>();
      for (const instant of admittedInstants) {
        const start = Math.floor(instant / group.durationMs) * group.durationMs;
        counts.set(start, (counts.get(start) ?? 0) + 1);
      }
      return {
        ...group,
        intervals: [...counts.entries()]
          .sort(([left], [right]) => left - right)
          .map(([start, count]) => ({
            windowStartedAtEpochMs: start,
            windowEndsAtEpochMs: start + group.durationMs,
            count,
          })),
      };
    }),
    "les intervalles observés doivent découler exactement des instants injectés",
  );
}

function assertLegacyCardinality(evidence: readonly RateLimitEvidence[], attempts: number) {
  const counters = evidence.filter((entry) => entry.kind === "counter");
  assert.equal(
    counters.filter((entry) => entry.signalType === "network").length,
    2,
    "ancienne assertion : deux documents network attendus",
  );
  assert.ok(
    counters.every((entry) => entry.count === attempts),
    "ancienne assertion : chaque document devait porter toutes les tentatives",
  );
}

function assertCounterexample(name: string, evidence: RateLimitEvidence[]) {
  assert.throws(
    () => assertCreateOrderRateLimitEvidence(evidence, 2),
    `le contre-exemple « ${name} » doit être refusé`,
  );
  console.log(`[OK] contre-exemple refusé : ${name}`);
}

function withoutFirstCounter(evidence: readonly RateLimitEvidence[]) {
  const index = evidence.findIndex((entry) => entry.kind === "counter");
  assert.notEqual(index, -1);
  return evidence.filter((_, current) => current !== index);
}

function withDuplicateCounter(evidence: readonly RateLimitEvidence[]) {
  const counter = evidence.find((entry) => entry.kind === "counter");
  assert.ok(counter);
  return [...evidence, { ...counter, id: `${counter.id}-duplicate` }];
}

function withBadBound(evidence: readonly RateLimitEvidence[]) {
  return replaceFirstCounter(evidence, (counter) => ({
    ...counter,
    windowEndsAtEpochMs: (counter.windowEndsAtEpochMs as number) + 1,
  }));
}

function withWrongTotal(evidence: readonly RateLimitEvidence[]) {
  return replaceFirstCounter(evidence, (counter) => ({
    ...counter,
    count: (counter.count as number) + 1,
  }));
}

function replaceFirstCounter(
  evidence: readonly RateLimitEvidence[],
  update: (counter: RateLimitEvidence) => RateLimitEvidence,
) {
  let replaced = false;
  return evidence.map((entry) => {
    if (replaced || entry.kind !== "counter") return entry;
    replaced = true;
    return update(entry);
  });
}

function requiredEvidence(observed: Map<string, RateLimitEvidence[]>, name: string) {
  const evidence = observed.get(name);
  assert.ok(evidence, `preuve absente pour ${name}`);
  return evidence;
}

function fixtureUuid(scenario: number, attempt: number) {
  return `00000000-0000-4000-8000-${String(scenario * 1_000 + attempt).padStart(12, "0")}`;
}

function formatSummary(summary: CreateOrderRateLimitSummary) {
  return `${summary.attempts} tentatives ; ${summary.groups.map((group) => (
    `${group.signalType}/${group.windowId}=${group.intervals.map((interval) => interval.count).join("+")}`
  )).join(", ")}`;
}
