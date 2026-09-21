import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { config } from "dotenv";
import { getStripeTestDb } from "../api/_server/stripeTestConfig.js";

const mode = process.argv[2];
const path = process.argv[3];
if (!path || !["capture-readonly", "load-emulator"].includes(mode)) throw new Error("Usage: stripeTestCatalog.ts capture-readonly|load-emulator <private-snapshot.json>");
const collections = ["products", "deliveryZones", "coupons"] as const;
type Snapshot = Record<string, Array<{ id: string; data: Record<string, unknown> }>>;
if (mode === "capture-readonly") {
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Source must be explicit, without emulator override");
  config({ path: ".env.local", quiet: true });
  const { getAdminDb } = await import("../api/_server/firebaseAdmin.js");
  const db = getAdminDb();
  const snapshot: Snapshot = {};
  for (const name of collections) {
    const result = await db.collection(name).get();
    snapshot[name] = result.docs.map((doc) => ({ id: doc.id, data: doc.data() }))
      .filter((doc) => name !== "coupons" || (!doc.data.contestPrizeId && doc.data.autoApply === true));
  }
  const serialized = JSON.stringify(snapshot, null, 2);
  writeFileSync(path, serialized, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ capturedReadOnly: true, counts: Object.fromEntries(collections.map((name) => [name, snapshot[name].length])), sha256: createHash("sha256").update(serialized).digest("hex") }));
} else {
  const db = getStripeTestDb();
  const snapshot = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
  for (const name of collections) {
    for (const entry of snapshot[name] || []) await db.collection(name).doc(entry.id).set(entry.data);
  }
  console.log("Catalogue copied to demo-verdanza-stripe emulator only.");
}
