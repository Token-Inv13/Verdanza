import assert from "node:assert/strict";

export type RateLimitEvidence = {
  id: string;
  kind: string;
  route: string;
  signalType: string;
  windowId: string;
  count: number | null;
  windowStartedAtEpochMs: number | null;
  windowEndsAtEpochMs: number | null;
};

export type RateLimitGroupSummary = {
  signalType: "network" | "email" | "anonymous";
  windowId: "10m" | "30m" | "24h";
  durationMs: number;
  intervals: Array<{
    id: string;
    windowStartedAtEpochMs: number;
    windowEndsAtEpochMs: number;
    count: number;
  }>;
};

export type CreateOrderRateLimitSummary = {
  attempts: number;
  groups: RateLimitGroupSummary[];
};

export const CREATE_ORDER_RATE_LIMIT_GROUPS = [
  { signalType: "network", windowId: "10m", durationMs: 10 * 60_000 },
  { signalType: "network", windowId: "24h", durationMs: 24 * 60 * 60_000 },
  { signalType: "email", windowId: "30m", durationMs: 30 * 60_000 },
  { signalType: "email", windowId: "24h", durationMs: 24 * 60 * 60_000 },
  { signalType: "anonymous", windowId: "30m", durationMs: 30 * 60_000 },
  { signalType: "anonymous", windowId: "24h", durationMs: 24 * 60 * 60_000 },
] as const;

export function projectRateLimitEvidence(
  id: string,
  value: Record<string, unknown>,
): RateLimitEvidence {
  return {
    id,
    kind: stringEvidence(value.kind),
    route: stringEvidence(value.route),
    signalType: stringEvidence(value.signalType),
    windowId: stringEvidence(value.windowId),
    count: numberEvidence(value.count),
    windowStartedAtEpochMs: timestampEvidence(value.windowStartedAt),
    windowEndsAtEpochMs: timestampEvidence(value.windowEndsAt),
  };
}

export function compareRateLimitEvidence(
  left: RateLimitEvidence,
  right: RateLimitEvidence,
) {
  return left.route.localeCompare(right.route)
    || left.kind.localeCompare(right.kind)
    || left.signalType.localeCompare(right.signalType)
    || left.windowId.localeCompare(right.windowId)
    || compareNullableNumber(left.windowStartedAtEpochMs, right.windowStartedAtEpochMs)
    || compareNullableNumber(left.windowEndsAtEpochMs, right.windowEndsAtEpochMs)
    || left.id.localeCompare(right.id);
}

export function assertCreateOrderRateLimitEvidence(
  evidence: readonly RateLimitEvidence[],
  expectedAttempts: number,
): CreateOrderRateLimitSummary {
  assert.ok(
    Number.isSafeInteger(expectedAttempts) && expectedAttempts > 0,
    "le nombre de tentatives nouvelles doit être un entier strictement positif",
  );
  const documents = evidence.filter((entry) => entry.route === "/api/create-order");
  assert.equal(
    new Set(documents.map((entry) => entry.id)).size,
    documents.length,
    "chaque preuve rate-limit doit avoir un identifiant unique",
  );

  const attempts = documents.filter((entry) => entry.kind === "attempt");
  assert.equal(
    attempts.length,
    expectedAttempts,
    "les documents attempt doivent correspondre exactement aux tentatives nouvelles admises",
  );
  const counters = documents.filter((entry) => entry.kind === "counter");
  assert.equal(
    attempts.length + counters.length,
    documents.length,
    "un type de document rate-limit inconnu ne doit pas être accepté",
  );

  const expectedGroupKeys = new Set(
    CREATE_ORDER_RATE_LIMIT_GROUPS.map((group) => groupKey(group.signalType, group.windowId)),
  );
  for (const counter of counters) {
    assert.ok(
      expectedGroupKeys.has(groupKey(counter.signalType, counter.windowId)),
      `groupe rate-limit inattendu : ${counter.signalType}/${counter.windowId}`,
    );
  }

  const groups: RateLimitGroupSummary[] = CREATE_ORDER_RATE_LIMIT_GROUPS.map((expected) => {
    const entries = counters
      .filter((entry) => (
        entry.signalType === expected.signalType
        && entry.windowId === expected.windowId
      ))
      .sort(compareRateLimitEvidence);
    assert.ok(
      entries.length > 0,
      `compteur manquant pour ${expected.signalType}/${expected.windowId}`,
    );

    const intervalStarts = new Set<number>();
    const intervals = entries.map((entry) => {
      const start = entry.windowStartedAtEpochMs;
      const end = entry.windowEndsAtEpochMs;
      const count = entry.count;
      assert.ok(
        Number.isSafeInteger(start) && (start as number) >= 0,
        `borne de début invalide pour ${expected.signalType}/${expected.windowId}`,
      );
      assert.ok(
        Number.isSafeInteger(end) && (end as number) > (start as number),
        `borne de fin invalide pour ${expected.signalType}/${expected.windowId}`,
      );
      assert.equal(
        (start as number) % expected.durationMs,
        0,
        `borne de début non alignée pour ${expected.signalType}/${expected.windowId}`,
      );
      assert.equal(
        (end as number) - (start as number),
        expected.durationMs,
        `durée de fenêtre invalide pour ${expected.signalType}/${expected.windowId}`,
      );
      assert.equal(
        (end as number) % expected.durationMs,
        0,
        `borne de fin non alignée pour ${expected.signalType}/${expected.windowId}`,
      );
      assert.ok(
        Number.isSafeInteger(count) && (count as number) > 0,
        `compteur invalide pour ${expected.signalType}/${expected.windowId}`,
      );
      assert.equal(
        intervalStarts.has(start as number),
        false,
        `intervalle dupliqué pour ${expected.signalType}/${expected.windowId}`,
      );
      intervalStarts.add(start as number);
      return {
        id: entry.id,
        windowStartedAtEpochMs: start as number,
        windowEndsAtEpochMs: end as number,
        count: count as number,
      };
    });
    assert.equal(
      intervals.reduce((sum, interval) => sum + interval.count, 0),
      expectedAttempts,
      `total incorrect pour ${expected.signalType}/${expected.windowId}`,
    );
    return { ...expected, intervals };
  });

  assert.equal(
    groups.reduce((sum, group) => sum + group.intervals.length, 0),
    counters.length,
    "un compteur supplémentaire ne doit pas être accepté",
  );
  return { attempts: attempts.length, groups };
}

function groupKey(signalType: string, windowId: string) {
  return `${signalType}:${windowId}`;
}

function compareNullableNumber(left: number | null, right: number | null) {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function numberEvidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function timestampEvidence(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const toMillis = (value as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== "function") return null;
  try {
    const milliseconds = toMillis.call(value);
    return typeof milliseconds === "number" && Number.isFinite(milliseconds)
      ? milliseconds
      : null;
  } catch {
    return null;
  }
}

function stringEvidence(value: unknown) {
  return typeof value === "string" ? value : "";
}
