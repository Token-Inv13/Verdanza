import assert from "node:assert/strict";
import {
  assertNoUnexpectedRuntimeFailures,
  type ConsoleEvidence,
  type FirestoreListenProbeEvidence,
  type FirestoreListenRecoveryExpectation,
  type NetworkEvidence,
} from "./runtimeDiagnostics.js";

// Pure regression: no browser, clock wait, filesystem, service or network access.
// Run: node --import tsx scripts/cagnotte-interactive/testRuntimeDiagnostics.ts
type Fixture = {
  network: NetworkEvidence[];
  console: ConsoleEvidence[];
  probe: FirestoreListenProbeEvidence[];
  expectations: FirestoreListenRecoveryExpectation[];
};

function fixture(role: "client" | "admin" = "client"): Fixture {
  const phase = role === "client" ? "client1-auth" : "admin-auth";
  const identity = {
    contextId: `desktop:${role}`,
    pageId: `desktop:${role}:page-1`,
    probeId: `desktop-${role}-probe`,
    probeInstanceId: `desktop-${role}-instance-1`,
    databaseId: "demo-verdanza-cagnotte",
    documentPath: "products/recette-fleur-fictive-100",
  };
  const generation = "recovery-desktop-route-1789586702412";
  const probeBase = { ...identity, phase, fromCache: false, hasPendingWrites: false };
  return {
    network: [{
      ...identity,
      phase,
      sequence: 262,
      occurredAtEpochMs: 1789586717389,
      requestId: `${identity.contextId}:request-128`,
      direction: "response",
      method: "GET",
      origin: "http://127.0.0.1:18086",
      pathname: "/google.firestore.v1.Firestore/Listen/channel",
      resourceType: "fetch",
      status: 400,
      requestShape: {
        queryParameterNames: ["AID", "CI", "RID", "SID", "TYPE", "VER", "database", "t", "zx"],
        hasSessionId: true,
        requestIdKind: "rpc",
        transportType: "xmlhttp",
        protocolVersion: "8",
      },
      responseSignature: {
        byteLength: 0,
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        contentType: null,
        bodyPrefix: "",
        truncated: false,
        captureSource: "browser-fetch",
        ...identity,
      },
    }],
    console: [{
      ...identity,
      phase,
      sequence: 263,
      occurredAtEpochMs: 1789586717390,
      source: "console",
      type: "error",
      text: "Failed to load resource: the server responded with a status of 400 (Bad Request)",
    }],
    probe: [{
      ...probeBase,
      sequence: 283,
      occurredAtEpochMs: 1789586716918,
      generation: "seed",
    }, {
      ...probeBase,
      phase: `${role}-firestore-listen-recovery`,
      sequence: 1890,
      occurredAtEpochMs: 1789586731486,
      generation: "recovery-desktop-admin-auth-1789586702412",
    }, {
      ...probeBase,
      phase: `${role}-firestore-listen-recovery`,
      sequence: 1891,
      occurredAtEpochMs: 1789586743355,
      generation,
    }],
    expectations: [{ ...identity, incidentPhase: phase, generations: [generation] }],
  };
}

function verify(value: Fixture) {
  return assertNoUnexpectedRuntimeFailures(value.network, value.console, value.probe, value.expectations);
}

const tests: Array<{ name: string; run: () => void }> = [];
function check(name: string, run: () => void) { tests.push({ name, run }); }
function rejects(name: string, mutate: (value: Fixture) => void, reason: RegExp) {
  check(name, () => {
    const value = fixture();
    mutate(value);
    assert.throws(() => verify(value), reason);
  });
}

check("run 35140175201: seed before incident survives a later intermediate generation", () => {
  const value = fixture();
  // Collection sequence is not reception time: seed 283 precedes incident 262 in time.
  assert.ok(value.probe[0]!.sequence > value.network[0]!.sequence);
  const result = verify(value);
  assert.equal(result.firestoreTransportRecoveries.length, 1);
  assert.equal(result.firestoreTransportRecoveries[0]!.incidentSequence, 262);
  assert.equal(result.firestoreTransportRecoveries[0]!.recoverySequence, 1891);
  assert.equal(result.firestoreTransportRecoveries[0]!.generation, value.expectations[0]!.generations[0]);
  assert.equal(result.firestoreTransportRecoveries[0]!.probeInstanceId, value.probe[0]!.probeInstanceId);
});

check("ordinary initial/recovery pair remains accepted", () => {
  const value = fixture();
  value.probe.splice(1, 1);
  assert.equal(verify(value).firestoreTransportRecoveries.length, 1);
});

check("admin incident uses its own preincident observation", () => {
  assert.equal(verify(fixture("admin")).firestoreTransportRecoveries.length, 1);
});

check("valid probe generations without an incident remain accepted", () => {
  const value = fixture();
  value.network = [];
  value.console = [];
  assert.deepEqual(verify(value).firestoreTransportRecoveries, []);
});

rejects("no initial observation before incident", (value) => { value.probe.shift(); }, /aucune donnée Firestore fraîche reçue après/);
rejects("initial simultaneous with incident is not preincident", (value) => {
  value.probe[0]!.occurredAtEpochMs = value.network[0]!.occurredAtEpochMs;
}, /aucune donnée Firestore fraîche reçue après/);
rejects("initial with recovery generation is not a distinct initial observation", (value) => {
  value.probe[0]!.generation = value.expectations[0]!.generations[0]!;
}, /sonde Firestore non établie sans ambiguïté|aucune donnée Firestore fraîche reçue après/);
rejects("missing fresh recovery", (value) => { value.probe.pop(); }, /génération Firestore fraîche non observée/);
for (const offset of [-1, 0]) {
  rejects(`recovery at incident offset ${offset} is not later`, (value) => {
    value.probe.splice(1, 1);
    value.probe[1]!.occurredAtEpochMs = value.network[0]!.occurredAtEpochMs + offset;
  }, /aucune donnée Firestore fraîche reçue après/);
}
rejects("recovery collection must follow incident sequence", (value) => {
  value.probe[2]!.sequence = value.network[0]!.sequence;
}, /aucune donnée Firestore fraîche reçue après/);
rejects("wrong recovery generation", (value) => {
  value.probe[2]!.generation = "recovery-unexpected-12345678";
}, /génération Firestore fraîche non observée/);
for (const key of ["contextId", "pageId", "probeId", "databaseId", "documentPath"] as const) {
  rejects(`wrong recovery ${key}`, (value) => { value.probe[2]![key] = "different"; }, /génération Firestore fraîche non observée/);
}
rejects("recovery from another instance", (value) => {
  value.probe[2]!.probeInstanceId = "different-instance";
}, /sonde Firestore non établie sans ambiguïté/);
rejects("incident attributed to another instance", (value) => {
  value.network[0]!.responseSignature!.probeInstanceId = "different-instance";
}, /aucune donnée Firestore fraîche reçue après/);
for (const flag of ["fromCache", "hasPendingWrites"] as const) {
  rejects(`initial ${flag} cannot establish preincident proof`, (value) => {
    value.probe[0]![flag] = true;
  }, /aucune donnée Firestore fraîche reçue après/);
  rejects(`recovery ${flag} is not fresh`, (value) => {
    value.probe[2]![flag] = true;
  }, /génération Firestore fraîche non observée/);
}
rejects("terminal probe error remains fatal", (value) => {
  value.probe[2]!.terminalErrorCode = "unavailable";
}, /erreur terminale sur la sonde Firestore attendue/);
rejects("two proven instances remain ambiguous", (value) => {
  value.probe.push(...value.probe.map((entry) => ({ ...entry, probeInstanceId: "second-instance" })));
}, /sonde Firestore non établie sans ambiguïté/);

check("later incident cannot reuse an earlier recovery", () => {
  const value = fixture();
  value.network[0]!.occurredAtEpochMs = value.probe[2]!.occurredAtEpochMs + 1;
  value.console[0]!.occurredAtEpochMs = value.network[0]!.occurredAtEpochMs + 1;
  assert.throws(() => verify(value), /aucune donnée Firestore fraîche reçue après/);
});

check("multiple incidents remain forbidden even with independently valid proofs", () => {
  const client = fixture();
  const admin = fixture("admin");
  assert.equal(verify(client).firestoreTransportRecoveries.length, 1);
  assert.equal(verify(admin).firestoreTransportRecoveries.length, 1);
  // Existing global limit is one incident per verification, not one per context.
  assert.throws(() => verify({
    network: [...client.network, ...admin.network],
    console: [...client.console, ...admin.console],
    probe: [...client.probe, ...admin.probe],
    expectations: [...client.expectations, ...admin.expectations],
  }), /au plus 1 incident Listen local/);
});
rejects("persistent second incident cannot borrow the first recovery", (value) => {
  value.network.push({ ...value.network[0]!, requestId: "later-request", sequence: 1900, occurredAtEpochMs: 1789586744000 });
}, /au plus 1 incident Listen local/);
rejects("unknown signature remains fatal", (value) => {
  value.network[0]!.responseSignature!.byteLength = 1;
}, /signature Listen 400 inconnue/);
rejects("capture failure remains fatal", (value) => {
  value.network[0]!.responseSignature!.captureError = "synthetic-capture-failure";
}, /signature Listen 400 inconnue/);
rejects("missing correlated console remains fatal", (value) => { value.console = []; }, /message console du Listen 400 non corrélé/);
rejects("unqualified incident phase remains fatal", (value) => {
  value.network[0]!.phase = "client-final-reload";
}, /phase Listen 400 non qualifiée/);
rejects("page error remains fatal", (value) => {
  value.console.push({ ...value.console[0]!, source: "pageerror", sequence: 1900, text: "synthetic-page-error" });
}, /console navigateur inattendue/);
rejects("blocked external request remains fatal", (value) => {
  value.network.push({ ...value.network[0]!, blocked: true, origin: "https://example.invalid" });
}, /aucune tentative navigateur externe attendue/);
rejects("business HTTP 400 is not a Listen incident", (value) => {
  value.network[0]!.pathname = "/api/create-order";
}, /réponse HTTP locale inattendue/);

let failed = 0;
for (const test of tests) {
  try {
    test.run();
    console.log(`[PASS] ${test.name}`);
  } catch (error) {
    failed += 1;
    console.error(`[FAIL] ${test.name}`);
    console.error(error);
  }
}
console.log(`Runtime diagnostics: ${tests.length - failed}/${tests.length} PASS; ${failed} FAIL.`);
if (failed > 0) process.exitCode = 1;
