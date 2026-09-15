import assert from "node:assert/strict";
import { localUrl, RECIPE_PORTS } from "./constants.js";

export type EvidenceBase = {
  phase: string;
  contextId: string;
  pageId?: string;
  sequence: number;
  occurredAtEpochMs: number;
};

export type RequestShape = {
  queryParameterNames: string[];
  hasSessionId: boolean;
  requestIdKind: "numeric" | "rpc" | "other" | "absent";
  transportType: "xmlhttp" | "other" | "absent";
  protocolVersion: "8" | "other" | "absent";
};

export type ResponseSignature = {
  byteLength: number;
  sha256: string;
  contentType: string | null;
  bodyPrefix: string;
  truncated: boolean;
  captureSource?: "playwright" | "browser-fetch" | "browser-xhr";
  probeId?: string;
  probeInstanceId?: string;
  databaseId?: string;
  documentPath?: string;
  captureError?: string;
};

export type NetworkEvidence = EvidenceBase & {
  requestId: string;
  direction: "request" | "response" | "websocket";
  method?: string;
  origin: string;
  pathname: string;
  resourceType?: string;
  status?: number;
  blocked?: boolean;
  requestShape?: RequestShape;
  responseSignature?: ResponseSignature;
};

export type ConsoleEvidence = EvidenceBase & {
  source: "console" | "pageerror";
  type: string;
  text: string;
};

export type FirestoreListenProbeEvidence = EvidenceBase & {
  probeId: string;
  probeInstanceId: string;
  databaseId: string;
  documentPath: string;
  generation: string;
  fromCache: boolean;
  hasPendingWrites: boolean;
  terminalErrorCode?: string;
};

export type FirestoreListenRecoveryExpectation = {
  incidentPhase: "client1-auth" | "admin-auth";
  contextId: string;
  pageId: string;
  probeId: string;
  databaseId: string;
  documentPath: string;
  generations: string[];
};

export type FirestoreTransportRecovery = {
  requestId: string;
  phase: string;
  contextId: string;
  pageId: string;
  incidentSequence: number;
  recoverySequence: number;
  probeId: string;
  probeInstanceId: string;
  databaseId: string;
  documentPath: string;
  generation: string;
  responseSignature: ResponseSignature;
  requestShape: RequestShape;
  recovered: true;
};

const firestoreOrigin = localUrl(RECIPE_PORTS.firestore).replace(/\/$/, "");
const firestoreListenPath = "/google.firestore.v1.Firestore/Listen/channel";
const maxRecoveredListenIncidents = 1;
const consoleCorrelationWindowMs = 2_000;

export function assertNoUnexpectedRuntimeFailures(
  network: NetworkEvidence[],
  consoleEvidence: ConsoleEvidence[],
  probeEvidence: FirestoreListenProbeEvidence[],
  recoveryExpectations: FirestoreListenRecoveryExpectation[],
) {
  const external = network.filter((entry) => entry.blocked === true);
  assert.deepEqual(external, [], `aucune tentative navigateur externe attendue : ${JSON.stringify(external)}`);

  const listen400Responses = network.filter(isFirestoreListen400Response);
  assert.ok(
    listen400Responses.length <= maxRecoveredListenIncidents,
    `au plus ${maxRecoveredListenIncidents} incident Listen local peut être qualifié : ${JSON.stringify(listen400Responses)}`,
  );

  const recoveries: FirestoreTransportRecovery[] = [];
  const associatedConsoleSequences = new Set<number>();
  const acceptedIncidentSequences = new Set<number>();
  const expectationKeys = recoveryExpectations.map((entry) => (
    `${entry.incidentPhase}:${entry.contextId}:${entry.pageId}:${entry.probeId}`
  ));
  assert.equal(
    new Set(expectationKeys).size,
    recoveryExpectations.length,
    "chaque contexte doit posséder une attente de reprise Firestore distincte",
  );
  const validatedProbes = new Map<FirestoreListenRecoveryExpectation, Array<{
    initial: FirestoreListenProbeEvidence;
    recovery: FirestoreListenProbeEvidence;
  }>>();
  for (const expectation of recoveryExpectations) {
    assert.ok(expectation.generations.length >= 1, "au moins une génération de reprise Firestore est attendue");
    assert.equal(
      new Set(expectation.generations).size,
      expectation.generations.length,
      `les générations de reprise Firestore doivent être distinctes : ${JSON.stringify(expectation)}`,
    );
    for (const generation of expectation.generations) {
      assert.match(generation, /^recovery-[a-z0-9-]{8,80}$/);
    }
    const sameProbe = probeEvidence.filter((entry) => (
      entry.contextId === expectation.contextId &&
      entry.pageId === expectation.pageId &&
      entry.probeId === expectation.probeId &&
      entry.databaseId === expectation.databaseId &&
      entry.documentPath === expectation.documentPath
    ));
    assert.equal(
      sameProbe.some((entry) => Boolean(entry.terminalErrorCode)),
      false,
      `erreur terminale sur la sonde Firestore attendue : ${JSON.stringify(expectation)}`,
    );
    const proofs = expectation.generations.map((generation) => {
      const recoveries = sameProbe.filter((entry) => (
        entry.generation === generation &&
        entry.fromCache === false &&
        entry.hasPendingWrites === false &&
        !entry.terminalErrorCode
      ));
      assert.ok(
        recoveries.length >= 1,
        `génération Firestore fraîche non observée sur la sonde attendue : ${JSON.stringify({ ...expectation, generation })}`,
      );
      const provenInstances = [...new Set(recoveries.flatMap((recovery) => (
        sameProbe.some((entry) => (
          entry.probeInstanceId === recovery.probeInstanceId &&
          entry.generation !== generation &&
          entry.occurredAtEpochMs < recovery.occurredAtEpochMs &&
          entry.fromCache === false &&
          entry.hasPendingWrites === false &&
          !entry.terminalErrorCode
        ))
          ? [recovery.probeInstanceId]
          : []
      )))];
      assert.equal(
        provenInstances.length,
        1,
        `sonde Firestore non établie sans ambiguïté avant sa génération de reprise : ${JSON.stringify({ ...expectation, generation })}`,
      );
      const probeInstanceId = provenInstances[0]!;
      const recovery = recoveries
        .filter((entry) => entry.probeInstanceId === probeInstanceId)
        .sort((left, right) => left.occurredAtEpochMs - right.occurredAtEpochMs)[0]!;
      const initial = sameProbe
        .filter((entry) => (
          entry.probeInstanceId === probeInstanceId &&
          entry.generation !== generation &&
          entry.occurredAtEpochMs < recovery.occurredAtEpochMs &&
          entry.fromCache === false &&
          entry.hasPendingWrites === false &&
          !entry.terminalErrorCode
        ))
        .sort((left, right) => right.occurredAtEpochMs - left.occurredAtEpochMs)[0]!;
      return { initial, recovery };
    });
    validatedProbes.set(expectation, proofs);
  }
  for (const incident of listen400Responses) {
    const expectedRole = incident.phase === "client1-auth"
      ? "client"
      : incident.phase === "admin-auth"
        ? "admin"
        : undefined;
    assert.ok(expectedRole, `phase Listen 400 non qualifiée : ${JSON.stringify(incident)}`);
    assert.ok(
      incident.contextId.endsWith(`:${expectedRole}`),
      `contexte Listen 400 incohérent avec sa phase : ${JSON.stringify(incident)}`,
    );
    assert.ok(incident.pageId, `page Listen 400 absente : ${JSON.stringify(incident)}`);
    assert.ok(isRejectedWebChannelSessionSignature(incident), `signature Listen 400 inconnue : ${JSON.stringify(incident)}`);

    const relatedConsole = consoleEvidence.filter((entry) => (
      entry.source === "console" &&
      entry.type === "error" &&
      entry.contextId === incident.contextId &&
      entry.pageId === incident.pageId &&
      entry.phase === incident.phase &&
      Math.abs(entry.occurredAtEpochMs - incident.occurredAtEpochMs) <= consoleCorrelationWindowMs &&
      (
        /Failed to load resource: the server responded with a status of 400 \(Bad Request\)/i.test(entry.text) ||
        isFirestoreUnavailableMessage(entry)
      )
    ));
    assert.ok(relatedConsole.length >= 1, `message console du Listen 400 non corrélé : ${JSON.stringify(incident)}`);
    for (const entry of relatedConsole) associatedConsoleSequences.add(entry.sequence);

    const responseSignature = incident.responseSignature!;
    const matchingExpectations = recoveryExpectations.filter((entry) => (
      entry.incidentPhase === incident.phase &&
      entry.contextId === incident.contextId &&
      entry.pageId === incident.pageId &&
      entry.probeId === responseSignature.probeId &&
      entry.databaseId === responseSignature.databaseId &&
      entry.documentPath === responseSignature.documentPath
    ));
    assert.equal(
      matchingExpectations.length,
      1,
      `sonde Firestore dédiée absente ou ambiguë pour le Listen 400 : ${JSON.stringify(incident)}`,
    );
    const expectation = matchingExpectations[0]!;
    const matchingProofs = validatedProbes.get(expectation)!
      .filter((proof) => (
        proof.initial.probeInstanceId === responseSignature.probeInstanceId &&
        proof.recovery.probeInstanceId === responseSignature.probeInstanceId &&
        proof.initial.occurredAtEpochMs < incident.occurredAtEpochMs &&
        proof.recovery.sequence > incident.sequence &&
        proof.recovery.occurredAtEpochMs > incident.occurredAtEpochMs
      ))
      .sort((left, right) => left.recovery.occurredAtEpochMs - right.recovery.occurredAtEpochMs);
    assert.ok(
      matchingProofs.length >= 1,
      `aucune donnée Firestore fraîche reçue après le Listen 400 : ${JSON.stringify(incident)}`,
    );
    const proof = matchingProofs[0]!;
    assert.equal(
      probeEvidence.some((entry) => (
        entry.contextId === incident.contextId &&
        entry.pageId === incident.pageId &&
        entry.probeId === expectation.probeId &&
        entry.probeInstanceId === responseSignature.probeInstanceId &&
        entry.occurredAtEpochMs > incident.occurredAtEpochMs &&
        Boolean(entry.terminalErrorCode)
      )),
      false,
      `erreur terminale Firestore après le Listen 400 : ${JSON.stringify(incident)}`,
    );
    acceptedIncidentSequences.add(incident.sequence);
    recoveries.push({
      requestId: incident.requestId,
      phase: incident.phase,
      contextId: incident.contextId,
      pageId: incident.pageId,
      incidentSequence: incident.sequence,
      recoverySequence: proof.recovery.sequence,
      probeId: expectation.probeId,
      probeInstanceId: proof.recovery.probeInstanceId,
      databaseId: expectation.databaseId,
      documentPath: expectation.documentPath,
      generation: proof.recovery.generation,
      responseSignature,
      requestShape: incident.requestShape!,
      recovered: true,
    });
  }

  const unexpectedHttp = network.filter((entry) => {
    if (entry.direction !== "response" || (entry.status ?? 0) < 400) return false;
    if (acceptedIncidentSequences.has(entry.sequence)) return false;
    return !isExpectedApplicationResponse(entry);
  });
  assert.deepEqual(unexpectedHttp, [], `réponse HTTP locale inattendue : ${JSON.stringify(unexpectedHttp)}`);

  const unexpectedConsole = consoleEvidence.filter((entry) => {
    if (entry.source === "pageerror") return true;
    if (entry.type !== "error") return false;
    if (associatedConsoleSequences.has(entry.sequence)) return false;
    if (isFirebaseClearDotCspBlock(entry)) return false;
    return !isConsoleCorrelatedToExpectedResponse(entry, network);
  });
  assert.deepEqual(unexpectedConsole, [], `console navigateur inattendue : ${JSON.stringify({
    console: unexpectedConsole,
    http4xx: network.filter((entry) => entry.direction === "response" && (entry.status ?? 0) >= 400),
  })}`);

  return {
    blockedBrowserDestinations: consoleEvidence
      .filter(isFirebaseClearDotCspBlock)
      .map((entry) => ({
        phase: entry.phase,
        contextId: entry.contextId,
        pageId: entry.pageId,
        origin: "https://www.google.com",
        pathname: "/images/cleardot.gif",
        blockedBy: "content-security-policy",
      })),
    firestoreTransportRecoveries: recoveries,
  };
}

export function assertExpectedFailClosedApiUnavailable(
  network: NetworkEvidence[],
  consoleEvidence: ConsoleEvidence[],
  expected: { contextId: string; pageId: string },
) {
  const relevantRequests = network.filter((entry) => (
    entry.direction === "request" &&
    entry.contextId === expected.contextId &&
    entry.pageId === expected.pageId &&
    entry.phase === "fail-closed-api-unavailable" &&
    entry.method === "GET" &&
    entry.origin === localUrl(RECIPE_PORTS.app).replace(/\/$/, "") &&
    entry.pathname === "/api/cagnotte"
  ));
  assert.ok(relevantRequests.length >= 1, "la tentative GET /api/cagnotte doit être observée pendant l’indisponibilité locale");

  const unexpectedNetwork = network.filter((entry) => {
    if (entry.blocked) return true;
    if (entry.direction !== "response" || (entry.status ?? 0) < 400) return false;
    return !(
      entry.contextId === expected.contextId &&
      entry.pageId === expected.pageId &&
      entry.phase === "fail-closed-api-unavailable" &&
      entry.method === "GET" &&
      entry.origin === localUrl(RECIPE_PORTS.app).replace(/\/$/, "") &&
      entry.pathname === "/api/cagnotte"
    );
  });
  assert.deepEqual(unexpectedNetwork, [], `erreur réseau étrangère à l’indisponibilité attendue : ${JSON.stringify(unexpectedNetwork)}`);

  const unexpectedConsole = consoleEvidence.filter((entry) => {
    if (entry.source === "pageerror") return true;
    if (entry.type !== "error") return false;
    return !(
      entry.contextId === expected.contextId &&
      entry.pageId === expected.pageId &&
      entry.phase === "fail-closed-api-unavailable" &&
      /Failed to load resource|ERR_CONNECTION|fetch/i.test(entry.text)
    );
  });
  assert.deepEqual(unexpectedConsole, [], `console étrangère à l’indisponibilité attendue : ${JSON.stringify(unexpectedConsole)}`);
  return {
    requestCount: relevantRequests.length,
    responseStatuses: network
      .filter((entry) => entry.direction === "response" && entry.pathname === "/api/cagnotte")
      .map((entry) => entry.status),
    consoleErrors: consoleEvidence.filter((entry) => entry.type === "error").length,
  };
}

export function isFirestoreListen400Response(entry: NetworkEvidence) {
  return entry.direction === "response" &&
    entry.status === 400 &&
    entry.method === "GET" &&
    entry.origin === firestoreOrigin &&
    entry.pathname === firestoreListenPath;
}

function isRejectedWebChannelSessionSignature(entry: NetworkEvidence) {
  const request = entry.requestShape;
  const response = entry.responseSignature;
  if (!request || !response) return false;
  return !response.captureError &&
    (response.captureSource === "browser-fetch" || response.captureSource === "browser-xhr") &&
    typeof response.probeId === "string" && response.probeId.length > 0 &&
    typeof response.probeInstanceId === "string" && response.probeInstanceId.length > 0 &&
    typeof response.databaseId === "string" && response.databaseId.length > 0 &&
    typeof response.documentPath === "string" && response.documentPath.length > 0 &&
    request.hasSessionId === true &&
    request.requestIdKind === "rpc" &&
    request.transportType === "xmlhttp" &&
    request.protocolVersion === "8" &&
    request.queryParameterNames.includes("SID") &&
    response.byteLength === 0 &&
    response.sha256 === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" &&
    response.contentType === null &&
    response.bodyPrefix === "" &&
    response.truncated === false;
}

function isExpectedApplicationResponse(entry: NetworkEvidence) {
  if (entry.status === 503 && entry.method === "GET" && [
    "/api/public-promo-banners",
    "/api/admin-payment-links",
    "/api/invoices",
  ].includes(entry.pathname)) return true;
  if (entry.status === 403 && entry.phase === "negative-auth-checks") {
    return (entry.method === "GET" && entry.pathname === "/api/cagnotte") ||
      (entry.method === "POST" && entry.pathname === "/api/update-order-status");
  }
  return false;
}

function isConsoleCorrelatedToExpectedResponse(entry: ConsoleEvidence, network: NetworkEvidence[]) {
  if (!/Failed to load resource: the server responded with a status of (403|503)/i.test(entry.text)) return false;
  return network.some((response) => (
    response.direction === "response" &&
    isExpectedApplicationResponse(response) &&
    response.contextId === entry.contextId &&
    response.pageId === entry.pageId &&
    response.phase === entry.phase &&
    Math.abs(response.occurredAtEpochMs - entry.occurredAtEpochMs) <= consoleCorrelationWindowMs
  ));
}

function isFirestoreUnavailableMessage(entry: ConsoleEvidence) {
  return /@firebase\/firestore: Firestore \([^)]*\): Could not reach Cloud Firestore backend\. Connection failed 1 times\./.test(entry.text) &&
    /FirebaseError: \[code=unavailable\]/.test(entry.text);
}

function isFirebaseClearDotCspBlock(entry: ConsoleEvidence) {
  return entry.source === "console" &&
    entry.type === "error" &&
    /Loading the image 'https:\/\/www\.google\.com\/images\/cleardot\.gif\?(?:zx=[^']+|\[redacted\])' violates the following Content Security Policy directive/.test(entry.text) &&
    /The action has been blocked\.$/.test(entry.text);
}
