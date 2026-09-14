import assert from "node:assert/strict";
import net from "node:net";
import {
  RECIPE_HOST,
  RECIPE_PORTS,
} from "./constants.js";
import {
  startRecipeHarness,
  type RecipeHarness,
} from "./harness.js";
import {
  configureOwnedResource,
  runWithViewportResources,
  type CleanupReport,
  type ViewportResourceDependencies,
} from "./resourceLifecycle.js";
import {
  assertNoUnexpectedRuntimeFailures,
  type ConsoleEvidence,
  type FirestoreListenProbeEvidence,
  type NetworkEvidence,
} from "./runtimeDiagnostics.js";

type FakeHarness = { stopCalls: number };
type FakeMonitor = { role: "client" | "admin"; closeCalls: number };
type FakePage = { role: "client" | "admin"; closeCalls: number };

const failures: Array<{ name: string; error: string }> = [];

await check("échec de création du premier contexte", async () => {
  const fixture = fakeDependencies({ failAt: "client-monitor" });
  await assert.rejects(
    runWithViewportResources(fixture.dependencies, async () => undefined),
    /injected-client-monitor/,
  );
  assert.equal(fixture.harness.stopCalls, 1, "le harness doit être arrêté après l’échec du premier contexte");
});

await check("échec de création du second contexte", async () => {
  const fixture = fakeDependencies({ failAt: "admin-monitor" });
  await assert.rejects(
    runWithViewportResources(fixture.dependencies, async () => undefined),
    /injected-admin-monitor/,
  );
  assert.equal(fixture.clientMonitor.closeCalls, 1, "le premier contexte doit être fermé");
  assert.equal(fixture.harness.stopCalls, 1, "le harness doit être arrêté");
});

await check("échec de création de la première page", async () => {
  const fixture = fakeDependencies({ failAt: "client-page" });
  await assert.rejects(
    runWithViewportResources(fixture.dependencies, async () => undefined),
    /injected-client-page/,
  );
  assert.equal(fixture.clientMonitor.closeCalls, 1);
  assert.equal(fixture.adminMonitor.closeCalls, 1);
  assert.equal(fixture.harness.stopCalls, 1);
});

await check("échec de création de la seconde page", async () => {
  const fixture = fakeDependencies({ failAt: "admin-page" });
  await assert.rejects(
    runWithViewportResources(fixture.dependencies, async () => undefined),
    /injected-admin-page/,
  );
  assert.equal(fixture.clientPage.closeCalls, 1, "la première page doit être fermée");
  assert.equal(fixture.clientMonitor.closeCalls, 1);
  assert.equal(fixture.adminMonitor.closeCalls, 1);
  assert.equal(fixture.harness.stopCalls, 1);
});

await check("échec de configuration d’un contexte déjà créé", async () => {
  const resource = { closeCalls: 0 };
  await assert.rejects(
    configureOwnedResource({
      create: async () => resource,
      configure: async () => { throw new Error("injected-context-configuration"); },
      close: async (owned) => { owned.closeCalls += 1; },
    }),
    /injected-context-configuration/,
  );
  assert.equal(resource.closeCalls, 1, "le contexte créé doit être fermé si sa configuration échoue");
});

await check("erreur initiale préservée malgré les erreurs de preuve et de fermeture", async () => {
  const fixture = fakeDependencies({
    failAt: "cleanup",
    failEvidence: true,
    failClientClose: true,
    failHarnessStop: true,
  });
  await assert.rejects(
    runWithViewportResources(fixture.dependencies, async () => {
      throw new Error("injected-primary-failure");
    }),
    /injected-primary-failure/,
  );
  assert.equal(fixture.clientPage.closeCalls, 1);
  assert.equal(fixture.adminPage.closeCalls, 1);
  assert.equal(fixture.clientMonitor.closeCalls, 1);
  assert.equal(fixture.adminMonitor.closeCalls, 1);
  assert.equal(fixture.harness.stopCalls, 1);
  assert.equal(fixture.reports.length, 1, "un compte rendu de nettoyage doit être conservé");
});

await check("nettoyage borné sans abandonner l’arrêt du harness", async () => {
  const fixture = fakeDependencies({ failAt: "cleanup" });
  fixture.dependencies.cleanupTimeoutMs = 40;
  fixture.dependencies.closePage = async (page) => {
    page.closeCalls += 1;
    if (page.role === "client") await new Promise<void>(() => undefined);
  };
  const startedAt = Date.now();
  await assert.rejects(
    runWithViewportResources(fixture.dependencies, async () => {
      throw new Error("injected-bounded-primary");
    }),
    /injected-bounded-primary/,
  );
  assert.ok(Date.now() - startedAt < 1_000, "la fermeture bloquée doit être bornée");
  assert.equal(fixture.harness.stopCalls, 1, "l’arrêt du harness doit être tenté après le dépassement");
  assert.equal(
    fixture.reports[0]?.steps.some((step) => step.name === "close-client-page" && step.status === "failed"),
    true,
  );
});

await check("incident Listen qualifié une seule fois avec reprise fraîche du même contexte", async () => {
  const fixture = recoveredListenFixture();
  const result = assertNoUnexpectedRuntimeFailures(fixture.network, fixture.console, fixture.probe);
  assert.equal(result.firestoreTransportRecoveries.length, 1, "console et réponse décrivent un seul incident");
  assert.equal(result.firestoreTransportRecoveries[0]?.requestId, "mobile:client:request-7");
});

await check("400 métier ou signature Listen inconnue restent bloquants", async () => {
  const business = recoveredListenFixture();
  business.network[0] = {
    ...business.network[0]!,
    origin: "http://127.0.0.1:14173",
    pathname: "/api/create-order",
    requestShape: undefined,
    responseSignature: undefined,
  };
  assert.throws(
    () => assertNoUnexpectedRuntimeFailures(business.network, business.console, business.probe),
    /réponse HTTP locale inattendue/,
  );
  const unknown = recoveredListenFixture();
  unknown.network[0] = {
    ...unknown.network[0]!,
    responseSignature: { ...unknown.network[0]!.responseSignature!, byteLength: 7, sha256: "unknown" },
  };
  assert.throws(
    () => assertNoUnexpectedRuntimeFailures(unknown.network, unknown.console, unknown.probe),
    /signature Listen 400 inconnue/,
  );
});

await check("incident Listen sans reprise ou avec reprise d’un autre contexte reste bloquant", async () => {
  const missing = recoveredListenFixture();
  assert.throws(
    () => assertNoUnexpectedRuntimeFailures(missing.network, missing.console, []),
    /aucune donnée Firestore fraîche/,
  );
  const otherContext = recoveredListenFixture();
  otherContext.probe[0] = { ...otherContext.probe[0]!, contextId: "mobile:admin", pageId: "mobile:admin:page-1" };
  assert.throws(
    () => assertNoUnexpectedRuntimeFailures(otherContext.network, otherContext.console, otherContext.probe),
    /aucune donnée Firestore fraîche/,
  );
});

await check("une réponse 200 antérieure ne prouve pas la reprise Listen", async () => {
  const fixture = recoveredListenFixture();
  const priorOk: NetworkEvidence = {
    ...fixture.network[0]!,
    requestId: "mobile:client:request-6",
    sequence: 1,
    occurredAtEpochMs: 900,
    status: 200,
    responseSignature: undefined,
  };
  assert.throws(
    () => assertNoUnexpectedRuntimeFailures([priorOk, ...fixture.network], fixture.console, []),
    /aucune donnée Firestore fraîche/,
  );
});

await check("incidents Listen persistants ou au-delà de la borne restent bloquants", async () => {
  const fixture = recoveredListenFixture();
  const second = {
    ...fixture.network[0]!,
    requestId: "mobile:client:request-8",
    sequence: 5,
    occurredAtEpochMs: 1_400,
  };
  assert.throws(
    () => assertNoUnexpectedRuntimeFailures([...fixture.network, second], fixture.console, fixture.probe),
    /au plus 1 incident Listen local/,
  );
});

await check("pageerror et fuite réseau restent bloquants", async () => {
  const pageError = recoveredListenFixture();
  pageError.console.push({
    phase: "client-final-wallet",
    contextId: "mobile:client",
    pageId: "mobile:client:page-1",
    sequence: 9,
    occurredAtEpochMs: 1_500,
    source: "pageerror",
    type: "error",
    text: "injected-pageerror",
  });
  assert.throws(
    () => assertNoUnexpectedRuntimeFailures(pageError.network, pageError.console, pageError.probe),
    /console navigateur inattendue/,
  );
  const leak = recoveredListenFixture();
  leak.network.push({
    phase: "client-final-wallet",
    contextId: "mobile:client",
    pageId: "mobile:client:page-1",
    sequence: 10,
    occurredAtEpochMs: 1_600,
    requestId: "mobile:client:request-9",
    direction: "request",
    method: "GET",
    origin: "https://example.invalid",
    pathname: "/leak",
    resourceType: "fetch",
    blocked: true,
  });
  assert.throws(
    () => assertNoUnexpectedRuntimeFailures(leak.network, leak.console, leak.probe),
    /aucune tentative navigateur externe attendue/,
  );
});

if (process.argv.includes("--real-harness")) {
  await check("harness réel libéré après un échec avant parcours", async () => {
    let harness: RecipeHarness | undefined;
    try {
      await assert.rejects(
        runWithViewportResources({
          label: "reliability-real-harness",
          startHarness: async () => {
            harness = await startRecipeHarness("reliability-real-harness");
            return harness;
          },
          createMonitor: async () => {
            throw new Error("injected-real-first-context");
          },
          createPage: async () => ({ unused: true }),
          persistEvidence: async () => undefined,
          closePage: async () => undefined,
          closeMonitor: async () => undefined,
          stopHarness: (ownedHarness) => ownedHarness.stop(),
        }, async () => undefined),
        /injected-real-first-context/,
      );
      assert.deepEqual(
        await occupiedRecipePorts(),
        [],
        "aucun port de la recette ne doit rester occupé après l’échec injecté",
      );
    } finally {
      await harness?.stop().catch(() => undefined);
      await harness?.stop().catch(() => undefined);
    }
    assert.deepEqual(await occupiedRecipePorts(), [], "le second arrêt doit rester sans effet indésirable");
  });
}

if (failures.length > 0) {
  console.error(`Fiabilité interactive en échec : ${failures.length} cas.`);
  for (const failure of failures) console.error(`- ${failure.name}: ${failure.error}`);
  process.exitCode = 1;
} else {
  const realHarnessSuffix = process.argv.includes("--real-harness")
    ? " et nettoyage du harness réel"
    : "";
  console.log(`Fiabilité interactive vérifiée : acquisitions partielles, erreurs primaires${realHarnessSuffix}.`);
}

async function check(name: string, test: () => Promise<void>) {
  try {
    await test();
    console.log(`[OK] ${name}`);
  } catch (error) {
    failures.push({ name, error: safeError(error) });
    console.error(`[ECHEC] ${name}: ${safeError(error)}`);
  }
}

function fakeDependencies(options: {
  failAt: "client-monitor" | "admin-monitor" | "client-page" | "admin-page" | "cleanup";
  failEvidence?: boolean;
  failClientClose?: boolean;
  failHarnessStop?: boolean;
}) {
  const harness: FakeHarness = { stopCalls: 0 };
  const clientMonitor: FakeMonitor = { role: "client", closeCalls: 0 };
  const adminMonitor: FakeMonitor = { role: "admin", closeCalls: 0 };
  const clientPage: FakePage = { role: "client", closeCalls: 0 };
  const adminPage: FakePage = { role: "admin", closeCalls: 0 };
  const reports: CleanupReport[] = [];
  const dependencies: ViewportResourceDependencies<FakeHarness, FakeMonitor, FakePage> = {
    label: `fake-${options.failAt}`,
    startHarness: async () => harness,
    createMonitor: async (role) => {
      if (options.failAt === `${role}-monitor`) throw new Error(`injected-${role}-monitor`);
      return role === "client" ? clientMonitor : adminMonitor;
    },
    createPage: async (_monitor, role) => {
      if (options.failAt === `${role}-page`) throw new Error(`injected-${role}-page`);
      return role === "client" ? clientPage : adminPage;
    },
    persistEvidence: async () => {
      if (options.failEvidence) throw new Error("injected-evidence-failure");
    },
    closePage: async (page) => { page.closeCalls += 1; },
    closeMonitor: async (monitor) => {
      monitor.closeCalls += 1;
      if (options.failClientClose && monitor.role === "client") {
        throw new Error("injected-client-close-failure");
      }
    },
    stopHarness: async (ownedHarness) => {
      ownedHarness.stopCalls += 1;
      if (options.failHarnessStop) throw new Error("injected-harness-stop-failure");
    },
    writeCleanupReport: async (report) => { reports.push(report); },
    cleanupTimeoutMs: 500,
  };
  return {
    dependencies,
    harness,
    clientMonitor,
    adminMonitor,
    clientPage,
    adminPage,
    reports,
  };
}

function recoveredListenFixture(): {
  network: NetworkEvidence[];
  console: ConsoleEvidence[];
  probe: FirestoreListenProbeEvidence[];
} {
  return {
    network: [{
      phase: "client1-auth",
      contextId: "mobile:client",
      pageId: "mobile:client:page-1",
      sequence: 2,
      occurredAtEpochMs: 1_000,
      requestId: "mobile:client:request-7",
      direction: "response",
      method: "GET",
      origin: "http://127.0.0.1:18086",
      pathname: "/google.firestore.v1.Firestore/Listen/channel",
      resourceType: "fetch",
      status: 400,
      requestShape: {
        queryParameterNames: ["AID", "CI", "RID", "SID", "TYPE", "VER", "database"],
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
      },
    }],
    console: [{
      phase: "client1-auth",
      contextId: "mobile:client",
      pageId: "mobile:client:page-1",
      sequence: 3,
      occurredAtEpochMs: 1_010,
      source: "console",
      type: "error",
      text: "Failed to load resource: the server responded with a status of 400 (Bad Request)",
    }],
    probe: [{
      phase: "firestore-listen-recovery",
      contextId: "mobile:client",
      pageId: "mobile:client:page-1",
      sequence: 4,
      occurredAtEpochMs: 1_300,
      probeId: "mobile-probe",
      generation: "recovery-mobile-12345678",
      fromCache: false,
      hasPendingWrites: false,
    }],
  };
}

async function occupiedRecipePorts() {
  const occupied: number[] = [];
  for (const port of Object.values(RECIPE_PORTS)) {
    if (!(await canBind(port))) occupied.push(port);
  }
  return occupied;
}

async function canBind(port: number) {
  return new Promise<boolean>((resolvePromise) => {
    const server = net.createServer();
    const timeout = setTimeout(() => {
      server.close();
      resolvePromise(false);
    }, 2_000);
    server.once("error", () => {
      clearTimeout(timeout);
      resolvePromise(false);
    });
    server.listen(port, RECIPE_HOST, () => {
      server.close(() => {
        clearTimeout(timeout);
        resolvePromise(true);
      });
    });
  });
}

function safeError(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
