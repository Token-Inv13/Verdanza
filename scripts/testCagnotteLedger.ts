import { deepStrictEqual, equal, ok, rejects, throws } from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { applyCagnotteLedgerOperation, CagnotteLedgerError, prepareCagnotteLedgerOperation } from "../api/_server/cagnotteLedger.js";
import type { CagnotteAccrual, CagnotteAccrualProgram, CagnotteInternalOrder, CagnotteLedgerCommand, CagnotteMovement, CagnotteTestProgram, CagnotteWallet } from "../api/_server/cagnotteLedgerTypes.js";
import { CagnotteProgramConfigurationError } from "../api/_server/cagnotteProgram.js";
import { calculateCagnotte } from "../src/lib/cagnotteCalculations.js";
import { fixtureSpentGain, assertWalletJournal } from "./cagnotteRegularizationFixtures.js";
import { assertCagnotteEmulatorAvailable, CAGNOTTE_DEMO, connectCagnotteEmulator, createCagnotteTestEnvironment, validateCagnotteEmulatorTarget, validateCagnotteTestEnvironment } from "./cagnotteEmulator.js";

let passed = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run();
  console.log(`OK ${++passed} - ${name}`);
}

const program: CagnotteTestProgram = Object.freeze({
  mode: "local_test", programVersion: "cagnotte-test-v1", calculationVersion: "cagnotte-math-v1",
  startsAtEpochMs: 123_000, newAccrualsEnabled: true,
});

function order(orderId: string, beneficiaryId = orderId, amounts = [10_000]): CagnotteInternalOrder {
  return {
    orderId, beneficiaryId, programVersion: program.programVersion, createdAtEpochMs: 124_000,
    snapshot: calculateCagnotte({
      lines: amounts.map((initialCents, index) => ({ lineId: `line-${index}`, initialCents })),
      discounts: [], requestedCagnotteCents: 0, availableCagnotteCents: 0,
    }),
  };
}

function refund(source: CagnotteInternalOrder, refundId: string, ...amounts: [string, number][]): CagnotteLedgerCommand {
  return { order: source, event: "refund_confirmed", refundId, additionalReturns: amounts.map(([lineId, additionalNetCents]) => ({ lineId, additionalNetCents })) };
}

function businessError(code: CagnotteLedgerError["code"]) {
  return (error: unknown) => error instanceof CagnotteLedgerError && error.code === code;
}

if (process.argv.includes("--unit")) {
  await test("cible exacte de demonstration", () => validateCagnotteEmulatorTarget(CAGNOTTE_DEMO));
  for (const projectId of ["production", "demo-other", "", "demo-verdanza-cagnotte "]) {
    await test(`projet refuse : ${projectId || "vide"}`, async () => {
      await rejects(connectCagnotteEmulator({ ...CAGNOTTE_DEMO, projectId }), /ISOLATION/);
    });
  }
  for (const host of ["firestore.googleapis.com", "0.0.0.0", "localhost", "127.0.0.1.example.com", "https://127.0.0.1", "::1"]) {
    await test(`hote hors liste refuse : ${host}`, async () => {
      await rejects(connectCagnotteEmulator({ ...CAGNOTTE_DEMO, host }), /ISOLATION/);
    });
  }
  await test("port autre que le port dedie refuse", () => throws(() => validateCagnotteEmulatorTarget({ ...CAGNOTTE_DEMO, port: 8080 }), /ISOLATION/));
  await test("construction de l'environnement sans lecture des credentials herites", () => {
    const inherited: NodeJS.ProcessEnv = { PATH: "fixture-path", SystemRoot: "fixture-system" };
    for (const name of ["GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_TOKEN", "NODE_OPTIONS", "APP_SECRET"]) {
      Object.defineProperty(inherited, name, { enumerable: true, get() { throw new Error("Credential lu."); } });
    }
    const clean = createCagnotteTestEnvironment(inherited, "fixture-home");
    validateCagnotteTestEnvironment(clean);
    equal(clean.PATH, "fixture-path");
    equal(clean.GOOGLE_APPLICATION_CREDENTIALS, undefined);
    equal(clean.FIREBASE_TOKEN, undefined);
    equal(clean.NODE_OPTIONS, undefined);
  });
  await test("environnement pollue ou endpoint herite refuse", () => {
    const clean = createCagnotteTestEnvironment({}, "fixture-home");
    throws(() => validateCagnotteTestEnvironment({ ...clean, GOOGLE_APPLICATION_CREDENTIALS: "synthetic" }), /ISOLATION/);
    throws(() => validateCagnotteTestEnvironment({ ...clean, FIRESTORE_EMULATOR_HOST: "remote:443" }), /ISOLATION/);
    throws(() => validateCagnotteTestEnvironment({ ...clean, METADATA_SERVER_DETECTION: "ping-only" }), /ISOLATION/);
    throws(() => validateCagnotteTestEnvironment({}), /ISOLATION/);
  });
  await test("emulateur absent : echec avant import ou initialisation du SDK", async () => {
    await rejects(assertCagnotteEmulatorAvailable(CAGNOTTE_DEMO), /absent\/inaccessible/);
    await rejects(connectCagnotteEmulator(CAGNOTTE_DEMO), /absent\/inaccessible/);
  });
  console.log(`UNITAIRES : ${passed} cas reussis. Aucun double memoire presente comme test Firestore.`);
} else if (process.argv.includes("--emulator")) {
  const db = await connectCagnotteEmulator(CAGNOTTE_DEMO);
  try { await emulatorTests(db); } finally { await db.terminate(); }
  console.log(`EMULATEUR FIRESTORE : ${passed} cas reussis. Donnees synthetiques uniquement.`);
} else {
  throw new Error("Utiliser le lanceur local et choisir explicitement --unit ou --emulator.");
}

async function emulatorTests(db: Firestore) {
  const apply = (command: CagnotteLedgerCommand, config: CagnotteTestProgram | null = program) => applyCagnotteLedgerOperation({ db, command, program: config });
  const send = (source: CagnotteInternalOrder, event: "payment_confirmed" | "delivery_confirmed" | "cancelled") => apply({ order: source, event });
  const wallet = async (beneficiaryId: string) => (await db.collection("cagnotteWallets").doc(beneficiaryId).get()).data() as CagnotteWallet;
  const accrual = async (orderId: string) => (await db.collection("cagnotteAccruals").doc(orderId).get()).data() as CagnotteAccrual;
  const movements = async (orderId: string) => (await db.collection("cagnotteMovements").where("orderId", "==", orderId).get()).docs.map((doc) => doc.data() as CagnotteMovement);
  async function dump() {
    return Promise.all(["cagnotteAccruals", "cagnotteWallets", "cagnotteMovements"].map(async (name) => {
      const data = await db.collection(name).get();
      return data.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => a.id.localeCompare(b.id));
    }));
  }
  async function unchanged(run: () => Promise<unknown>, error?: (error: unknown) => boolean) {
    const before = await dump();
    if (error) await rejects(run(), error); else await rejects(run());
    deepStrictEqual(await dump(), before);
  }
  async function balances(source: CagnotteInternalOrder, pending: number, available: number) {
    const result = await wallet(source.beneficiaryId!);
    deepStrictEqual([result.pendingCents, result.availableCents, result.currency], [pending, available, "EUR"]);
  }
  async function ready(source: CagnotteInternalOrder) {
    await send(source, "payment_confirmed"); await send(source, "delivery_confirmed");
  }

  await test("programme absent, historique, version incompatible et beneficiaire absent : aucune ecriture", async () => {
    const before = await dump();
    const source = order("excluded");
    for (const [candidate, config] of [
      [source, null],
      [{ ...source, programVersion: null }, program], [{ ...source, beneficiaryId: null }, program],
      [{ ...source, createdAtEpochMs: 122_999 }, program], [{ ...source, programVersion: "different" }, program],
      [source, { ...program, calculationVersion: "unsupported" }],
    ] as [CagnotteInternalOrder, CagnotteTestProgram | null][]) {
      equal((await apply({ order: candidate, event: "payment_confirmed" }, config)).status, "not_eligible");
    }
    deepStrictEqual(await dump(), before);
  });
  await test("drain termine paiement puis livraison d'une commande deja inscrite", async () => {
    const source = order("drain-enrolled");
    const drain = { ...program, newAccrualsEnabled: false };
    equal((await apply({ order: source, event: "payment_confirmed" }, drain)).status, "applied");
    await balances(source, 500, 0);
    equal((await apply({ order: source, event: "delivery_confirmed" }, drain)).status, "applied");
    await balances(source, 0, 500);
  });
  await test("projet Firebase Production divergent : echec avant toute ecriture", async () => {
    const source = order("production-project-mismatch");
    const productionProgram: CagnotteAccrualProgram<"production"> = { ...program, mode: "production" };
    await unchanged(
      () => applyCagnotteLedgerOperation({
        db,
        command: { order: source, event: "payment_confirmed" },
        program: productionProgram,
        firebaseProjectId: "other-project",
      }),
      (error) => error instanceof CagnotteProgramConfigurationError,
    );
  });
  const normal = order("normal");
  await test("paiement 100 EUR : 500 centimes en attente", async () => {
    equal((await send(normal, "payment_confirmed")).status, "applied");
    await balances(normal, 500, 0);
    equal((await movements(normal.orderId)).length, 1);
  });
  await test("livraison : transfert exact, aucun second gain", async () => {
    await send(normal, "delivery_confirmed");
    await balances(normal, 0, 500);
    const entries = await movements(normal.orderId);
    equal(entries.length, 3);
    const release = entries.find((entry) => entry.businessEvent === "made_available")!;
    deepStrictEqual([release.pendingDeltaCents, release.availableDeltaCents], [-500, 500]);
  });
  await test("livraison avant paiement : zero puis meme solde final", async () => {
    const source = order("delivery-first");
    await send(source, "delivery_confirmed");
    await balances(source, 0, 0);
    equal((await accrual(source.orderId)).credited, false);
    await send(source, "payment_confirmed");
    await balances(source, 0, 500);
    equal((await movements(source.orderId)).length, 3);
  });
  await test("repetitions paiement/livraison : deja applique, documents identiques", async () => {
    const before = await dump();
    equal((await send(normal, "payment_confirmed")).status, "already_applied");
    equal((await send(normal, "delivery_confirmed")).status, "already_applied");
    deepStrictEqual(await dump(), before);
  });
  await test("six attributions simultanees de la meme commande : un seul gain", async () => {
    const source = order("same-concurrent");
    const results = await Promise.all(Array.from({ length: 6 }, () => send(source, "payment_confirmed")));
    equal(results.filter((entry) => entry.status === "applied").length, 1);
    equal(results.filter((entry) => entry.status === "already_applied").length, 5);
    await balances(source, 500, 0);
    equal((await movements(source.orderId)).length, 1);
  });
  await test("deux commandes simultanees du meme client : somme exacte", async () => {
    const first = order("shared-a", "shared", [10_000]);
    const second = order("shared-b", "shared", [3_333]);
    await Promise.all([send(first, "payment_confirmed"), send(second, "payment_confirmed")]);
    await balances(first, 667, 0);
    await Promise.all([send(first, "delivery_confirmed"), send(second, "delivery_confirmed")]);
    await balances(first, 0, 667);
  });
  await test("beneficiaire, instantane et version modifies : conflits sans ecriture", async () => {
    for (const candidate of [
      { ...normal, beneficiaryId: "other" }, { ...normal, programVersion: "other-version" },
      { ...normal, snapshot: order("dummy", "dummy", [9_999]).snapshot },
    ]) await unchanged(() => send(candidate, "payment_confirmed"), businessError("CONFLICT"));
  });
  await test("annulation avant paiement : zero, anciennes confirmations inoffensives", async () => {
    const source = order("cancel-before");
    await send(source, "cancelled"); await balances(source, 0, 0);
    const before = await dump();
    equal((await send(source, "payment_confirmed")).status, "cancelled");
    equal((await send(source, "delivery_confirmed")).status, "cancelled");
    equal((await send(source, "cancelled")).status, "already_applied");
    deepStrictEqual(await dump(), before);
  });
  for (const delivered of [false, true]) {
    await test(`annulation ${delivered ? "disponible" : "en attente"} : neutralisation une fois`, async () => {
      const source = order(delivered ? "cancel-available" : "cancel-pending");
      await send(source, "payment_confirmed");
      if (delivered) await send(source, "delivery_confirmed");
      await send(source, "cancelled"); await balances(source, 0, 0);
      const before = await dump();
      await send(source, "cancelled"); await send(source, "payment_confirmed"); await send(source, "delivery_confirmed");
      deepStrictEqual(await dump(), before);
    });
  }
  await test("annulation sans configuration ou pendant suspension : jamais reactivee apres activation", async () => {
    for (const [index, config] of [null, { ...program, newAccrualsEnabled: false }].entries()) {
      const source = order(`cancel-disabled-${index}`);
      await apply({ order: source, event: "cancelled" }, config);
      await balances(source, 0, 0);
      equal((await send(source, "payment_confirmed")).status, "cancelled");
      equal((await accrual(source.orderId)).credited, false);
    }
  });
  for (const delivered of [false, true]) {
    await test(`remboursement partiel puis total ${delivered ? "disponible" : "en attente"}`, async () => {
      const source = order(delivered ? "refund-available" : "refund-pending");
      await send(source, "payment_confirmed"); if (delivered) await send(source, "delivery_confirmed");
      await apply(refund(source, "part", ["line-0", 2_500]));
      await balances(source, delivered ? 0 : 375, delivered ? 375 : 0);
      await apply(refund(source, "rest", ["line-0", 7_500])); await balances(source, 0, 0);
      equal((await accrual(source.orderId)).remainingGainCents, 0);
      if (!delivered) { await send(source, "delivery_confirmed"); await balances(source, 0, 0); }
    });
  }
  await test("deux retours sur lignes distinctes : cumul precedent conserve", async () => {
    const source = order("multi-return", "multi-return", [5_000, 5_000]); await ready(source);
    await apply(refund(source, "first", ["line-0", 1_000]));
    await apply(refund(source, "second", ["line-1", 2_000]));
    deepStrictEqual((await accrual(source.orderId)).cumulativeReturns, [
      { lineId: "line-0", returnedNetCents: 1_000 }, { lineId: "line-1", returnedNetCents: 2_000 },
    ]);
    await balances(source, 0, 350);
  });
  await test("remboursements simultanes distincts sur meme ligne : cumuls additionnes", async () => {
    const source = order("refund-concurrent"); await ready(source);
    await Promise.all([apply(refund(source, "r1", ["line-0", 1_111])), apply(refund(source, "r2", ["line-0", 2_222]))]);
    equal((await accrual(source.orderId)).cumulativeReturns[0].returnedNetCents, 3_333);
    await balances(source, 0, 333);
  });
  await test("remboursement repete, lignes reordonnees et contenu conflictuel", async () => {
    const source = order("refund-repeat", "refund-repeat", [5_000, 5_000]); await ready(source);
    const command = refund(source, "stable", ["line-0", 111], ["line-1", 222]);
    await apply(command);
    const before = await dump();
    const results = await Promise.all(Array.from({ length: 4 }, () => apply(refund(source, "stable", ["line-1", 222], ["line-0", 111]))));
    ok(results.every((result) => result.status === "already_applied"));
    deepStrictEqual(await dump(), before);
    await unchanged(() => apply(refund(source, "stable", ["line-0", 112], ["line-1", 222])), businessError("CONFLICT"));
  });
  await test("centimes indivisibles : corrections successives egales au retour unique", async () => {
    const source = order("pennies", "pennies", [17]); await ready(source);
    await apply(refund(source, "one", ["line-0", 1]));
    await apply(refund(source, "two", ["line-0", 7]));
    await balances(source, 0, 0);
    await apply(refund(source, "three", ["line-0", 9])); await balances(source, 0, 0);
    equal((await movements(source.orderId)).filter((m) => m.businessEvent === "refund_confirmed").reduce((n, m) => n + m.availableDeltaCents, 0), -1);
  });
  await test("instantane avec cagnotte utilisee : correction du gain seule, aucune restitution", async () => {
    const source = { ...order("used-wallet"), snapshot: calculateCagnotte({
      lines: [{ lineId: "line-0", initialCents: 10_000 }], discounts: [], requestedCagnotteCents: 2_000, availableCagnotteCents: 2_000,
    }) };
    await ready(source); await balances(source, 0, 400);
    await apply(refund(source, "quarter", ["line-0", 2_500])); await balances(source, 0, 300);
    const movement = (await movements(source.orderId)).find((m) => m.businessEvent === "refund_confirmed")!;
    equal(movement.availableDeltaCents, -100);
  });
  await test("annulation puis remboursement : aucun double retrait", async () => {
    const source = order("cancel-refund"); await ready(source); await send(source, "cancelled");
    await apply(refund(source, "after-cancel", ["line-0", 10_000])); await balances(source, 0, 0);
    const entry = (await movements(source.orderId)).find((m) => m.businessEvent === "refund_confirmed")!;
    equal(entry.availableDeltaCents, 0);
    equal((await accrual(source.orderId)).cumulativeReturns[0].returnedNetCents, 10_000);
  });
  await test("retour partiel puis annulation : seul le gain restant est retire", async () => {
    const source = order("refund-cancel"); await ready(source);
    await apply(refund(source, "part", ["line-0", 2_500])); await send(source, "cancelled");
    const entry = (await movements(source.orderId)).find((m) => m.businessEvent === "cancelled")!;
    equal(entry.availableDeltaCents, -375); await balances(source, 0, 0);
  });
  await test("suspension ou absence de configuration n'empeche pas les corrections existantes", async () => {
    const source = order("suspended"); await ready(source);
    await apply(refund(source, "partial", ["line-0", 2_500]), { ...program, newAccrualsEnabled: false });
    await balances(source, 0, 375);
    await apply({ order: source, event: "cancelled" }, null); await balances(source, 0, 0);
  });
  await test("nouvelle version courante : ancien droit corrige avec sa version d'origine", async () => {
    const source = order("old-version"); await ready(source);
    await apply(refund(source, "partial", ["line-0", 2_500]), { ...program, programVersion: "test-v2" });
    equal((await accrual(source.orderId)).programVersion, program.programVersion);
    await balances(source, 0, 375);
  });
  await test("trop-rembourse, ligne inconnue, doublon et montant invalide : aucune ecriture", async () => {
    const source = order("invalid-refund"); await ready(source);
    for (const command of [
      refund(source, "too-much", ["line-0", 10_001]), refund(source, "unknown", ["missing", 1]),
      refund(source, "duplicate", ["line-0", 1], ["line-0", 1]),
      ...[-1, 0, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map((amount, index) => refund(source, `bad-${index}`, ["line-0", amount])),
    ]) await unchanged(() => apply(command));
    await apply(refund(source, "valid", ["line-0", 9_000]));
    await unchanged(() => apply(refund(source, "cumulative-over", ["line-0", 1_001])));
  });
  await test("remboursement avant paiement : erreur explicite sans ecriture", async () => {
    const source = order("refund-unpaid"); await send(source, "delivery_confirmed");
    await unchanged(() => apply(refund(source, "early", ["line-0", 1])), businessError("PAYMENT_REQUIRED"));
  });
  await test("gain depense simule : correction puis annulation regularisent sans double retrait", async () => {
    const source = order("insufficient"); await ready(source);
    await fixtureSpentGain(db, source.beneficiaryId!, source.orderId, 500, program.programVersion);
    await apply(refund(source, "partial", ["line-0", 2_500]));
    equal((await wallet(source.beneficiaryId!)).regularizationCents, 125);
    equal((await accrual(source.orderId)).remainingGainCents, 375);
    await send(source, "cancelled"); await balances(source, 0, 0);
    equal((await wallet(source.beneficiaryId!)).regularizationCents, 500);
    equal((await accrual(source.orderId)).remainingGainCents, 0);
    equal((await send(source, "cancelled")).status, "already_applied");
    await assertWalletJournal(db, source.beneficiaryId!);
  });
  await test("debordement du portefeuille : rejet avant toute ecriture", async () => {
    const source = order("overflow");
    const reference = db.collection("cagnotteWallets").doc(source.beneficiaryId!);
    await reference.set({ schemaVersion: 1, currency: "EUR", beneficiaryId: source.beneficiaryId, pendingCents: Number.MAX_SAFE_INTEGER, availableCents: 0 });
    await unchanged(() => send(source, "payment_confirmed"), businessError("INVALID_INPUT"));
    await reference.update({ pendingCents: 0 });
  });
  await test("erreur forcee apres preparation des ecritures mais avant commit : aucun effet", async () => {
    const source = order("rollback");
    await unchanged(() => db.runTransaction(async (transaction) => {
      const plan = await prepareCagnotteLedgerOperation({ db, transaction, program, command: { order: source, event: "payment_confirmed" } });
      // Future order transaction may complete additional reads BEFORE staging the plan.
      await transaction.get(db.collection("cagnotteWallets").doc(normal.beneficiaryId!));
      plan.write();
      throw new Error("Synthetic failure before commit.");
    }));
  });
  await test("rejeu du callback par Firestore : un seul mouvement persiste", async () => {
    const source = order("callback-retry"); let attempts = 0;
    await db.runTransaction(async (transaction) => {
      const plan = await prepareCagnotteLedgerOperation({ db, transaction, program, command: { order: source, event: "payment_confirmed" } });
      plan.write();
      if (++attempts === 1) throw Object.assign(new Error("Synthetic ABORTED."), { code: 10 });
    });
    equal(attempts, 2); await balances(source, 500, 0);
    equal((await movements(source.orderId)).length, 1);
  });
  await test("documents persistables, cles uniques et conservation de tous les soldes", async () => {
    const allWallets = (await db.collection("cagnotteWallets").get()).docs.map((doc) => doc.data() as CagnotteWallet);
    const allMovements = (await db.collection("cagnotteMovements").get()).docs.map((doc) => doc.data() as CagnotteMovement);
    equal(new Set(allMovements.map((entry) => entry.eventKey)).size, allMovements.length);
    for (const entry of allMovements) {
      ok(["internal_server", "synthetic_test_fixture"].includes(entry.origin)); equal(entry.calculationVersion, "cagnotte-math-v1"); equal(entry.schemaVersion, 3);
      ok(Number.isSafeInteger(entry.pendingDeltaCents)); ok(Number.isSafeInteger(entry.availableDeltaCents)); ok(Number.isSafeInteger(entry.reservedDeltaCents));
      equal(Object.is(entry.pendingDeltaCents, -0), false); equal(Object.is(entry.availableDeltaCents, -0), false); equal(Object.is(entry.reservedDeltaCents, -0), false);
    }
    for (const w of allWallets) {
      const entries = allMovements.filter((entry) => entry.beneficiaryId === w.beneficiaryId);
      const reservedCents = w.reservedCents ?? 0;
      equal(w.pendingCents, entries.reduce((n, entry) => n + entry.pendingDeltaCents, 0));
      equal(w.availableCents, entries.reduce((n, entry) => n + entry.availableDeltaCents, 0));
      equal(reservedCents, entries.reduce((n, entry) => n + entry.reservedDeltaCents, 0));
      await assertWalletJournal(db, w.beneficiaryId);
      ok(w.pendingCents >= 0 && w.availableCents >= 0 && reservedCents >= 0);
    }
  });
}
