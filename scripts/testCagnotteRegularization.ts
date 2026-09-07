import { deepStrictEqual, equal, rejects } from "node:assert/strict";
import {
  applyCagnotteLedgerOperation,
  prepareCagnotteLedgerOperation,
} from "../api/_server/cagnotteLedger.js";
import type {
  CagnotteAccrual,
  CagnotteInternalOrder,
  CagnotteLedgerCommand,
  CagnotteTestProgram,
  CagnotteWallet,
} from "../api/_server/cagnotteLedgerTypes.js";
import { calculateCagnotte } from "../src/lib/cagnotteCalculations.js";
import { assertWalletJournal, fixtureSpentGain } from "./cagnotteRegularizationFixtures.js";
import {
  assertCagnotteEmulatorAvailable,
  CAGNOTTE_DEMO,
  connectCagnotteEmulator,
  validateCagnotteTestEnvironment,
} from "./cagnotteEmulator.js";

validateCagnotteTestEnvironment(process.env);
await assertCagnotteEmulatorAvailable(CAGNOTTE_DEMO);
const db = await connectCagnotteEmulator(CAGNOTTE_DEMO);
let passed = 0;

const program: CagnotteTestProgram = Object.freeze({
  mode: "local_test",
  programVersion: "regularization-core-test-v1",
  calculationVersion: "cagnotte-math-v1",
  startsAtEpochMs: 1_000,
  newAccrualsEnabled: true,
});

function order(orderId: string, beneficiaryId: string, productsCents: number): CagnotteInternalOrder {
  return {
    orderId,
    beneficiaryId,
    programVersion: program.programVersion,
    createdAtEpochMs: 2_000,
    snapshot: calculateCagnotte({
      lines: [{ lineId: `${orderId}-line`, initialCents: productsCents }],
      discounts: [],
      requestedCagnotteCents: 0,
      availableCagnotteCents: 0,
    }),
  };
}

const apply = (command: CagnotteLedgerCommand) => applyCagnotteLedgerOperation({ db, command, program });
const send = (source: CagnotteInternalOrder, event: "payment_confirmed" | "delivery_confirmed" | "payment_and_delivery_confirmed" | "cancelled") =>
  apply({ order: source, event });
const wallet = async (beneficiaryId: string) =>
  (await db.collection("cagnotteWallets").doc(beneficiaryId).get()).data() as CagnotteWallet;
const accrual = async (orderId: string) =>
  (await db.collection("cagnotteAccruals").doc(orderId).get()).data() as CagnotteAccrual;

async function balances(beneficiaryId: string, expected: [number, number, number, number]) {
  const value = await wallet(beneficiaryId);
  deepStrictEqual(
    [value.pendingCents, value.availableCents, value.reservedCents, value.regularizationCents],
    expected,
  );
}

async function ready(source: CagnotteInternalOrder) {
  await send(source, "payment_confirmed");
  await send(source, "delivery_confirmed");
}

async function debt(prefix: string, beneficiaryId: string) {
  const source = order(`${prefix}-spent`, beneficiaryId, 10_000);
  await ready(source);
  await fixtureSpentGain(db, beneficiaryId, source.orderId, 500, program.programVersion);
  await send(source, "cancelled");
  await balances(beneficiaryId, [0, 0, 0, 500]);
  return source;
}

async function snapshot() {
  return Promise.all(
    ["cagnotteAccruals", "cagnotteMovements", "cagnotteReservations", "cagnotteWallets"].map(async (name) => {
      const value = await db.collection(name).get();
      return value.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => a.id.localeCompare(b.id));
    }),
  );
}

async function test(name: string, run: () => Promise<void>) {
  await run();
  console.log(`OK ${++passed} - ${name}`);
}

try {
  await test("gain dépensé, compensation différée puis nouveau disponible", async () => {
    const beneficiaryId = "regularization-main-user";
    const first = order("regularization-main-a", beneficiaryId, 10_000);
    await ready(first);
    await balances(beneficiaryId, [0, 500, 0, 0]);
    await fixtureSpentGain(db, beneficiaryId, first.orderId, 500, program.programVersion);
    await balances(beneficiaryId, [0, 0, 0, 0]);
    await send(first, "cancelled");
    await balances(beneficiaryId, [0, 0, 0, 500]);

    const second = order("regularization-main-b", beneficiaryId, 6_000);
    await send(second, "payment_confirmed");
    await balances(beneficiaryId, [300, 0, 0, 500]);
    await send(second, "delivery_confirmed");
    await balances(beneficiaryId, [0, 0, 0, 200]);

    const third = order("regularization-main-c", beneficiaryId, 8_000);
    await send(third, "payment_and_delivery_confirmed");
    await balances(beneficiaryId, [0, 200, 0, 0]);
    equal((await accrual(second.orderId)).remainingGainCents, 300);
    equal((await accrual(third.orderId)).remainingGainCents, 400);
    await assertWalletJournal(db, beneficiaryId);
  });

  await test("annulation d'un gain compensé restaure toute la régularisation", async () => {
    const beneficiaryId = "regularization-cancel-user";
    await debt("regularization-cancel", beneficiaryId);
    const compensated = order("regularization-cancel-b", beneficiaryId, 6_000);
    await ready(compensated);
    await balances(beneficiaryId, [0, 0, 0, 200]);
    await send(compensated, "cancelled");
    await balances(beneficiaryId, [0, 0, 0, 500]);
    equal((await accrual(compensated.orderId)).remainingGainCents, 0);
    equal((await send(compensated, "cancelled")).status, "already_applied");
    await assertWalletJournal(db, beneficiaryId);
  });

  await test("un gain en attente ne compense pas la régularisation", async () => {
    const beneficiaryId = "regularization-pending-user";
    await debt("regularization-pending", beneficiaryId);
    const pending = order("regularization-pending-b", beneficiaryId, 6_000);
    await send(pending, "payment_confirmed");
    await balances(beneficiaryId, [300, 0, 0, 500]);
    await assertWalletJournal(db, beneficiaryId);
  });

  await test("erreur avant commit sans écriture partielle", async () => {
    const source = order("regularization-rollback", "regularization-rollback-user", 10_000);
    const before = await snapshot();
    await rejects(
      db.runTransaction(async (transaction) => {
        const plan = await prepareCagnotteLedgerOperation({
          db,
          transaction,
          command: { order: source, event: "payment_confirmed" },
          program,
          recordedAtEpochMs: 10_000,
        });
        plan.write();
        throw new Error("Synthetic failure before commit.");
      }),
      /Synthetic failure/,
    );
    deepStrictEqual(await snapshot(), before);
  });
} finally {
  await db.terminate();
}

console.log(`RÉGULARISATION FIRESTORE : ${passed} scénarios réussis. Données synthétiques uniquement.`);
