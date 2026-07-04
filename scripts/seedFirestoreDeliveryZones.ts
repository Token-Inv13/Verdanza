import { FieldValue } from "firebase-admin/firestore";
import { deliveryZones } from "../src/data/deliveryZones.js";
import type { DeliveryZone } from "../src/types/index.js";
import {
  getRequiredAdminDb,
  requireConfirmationFlag,
} from "./_firebaseAdminScript.js";

type DeliveryZoneDocument = DeliveryZone & {
  createdAt?: unknown;
  updatedAt?: unknown;
};

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  ) as Partial<T>;
}

function buildDeliveryZonePayload(
  zone: DeliveryZone,
  existing?: DeliveryZoneDocument,
) {
  return withoutUndefined({
    ...zone,
    createdAt: existing?.createdAt ?? FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function main() {
  requireConfirmationFlag("seed:delivery-zones");

  const { db, projectId } = getRequiredAdminDb();
  const uniqueIds = new Set(deliveryZones.map((zone) => zone.id));

  if (uniqueIds.size !== deliveryZones.length) {
    throw new Error("Seed refuse: IDs zones dupliques dans src/data/deliveryZones.ts.");
  }

  console.log(`Projet Firebase cible: ${projectId}`);
  console.log(`Zones a seeder: ${deliveryZones.length}`);

  let created = 0;
  let updated = 0;

  for (const zone of deliveryZones) {
    const zoneRef = db.collection("deliveryZones").doc(zone.id);
    const snapshot = await zoneRef.get();
    const existing = snapshot.exists
      ? ({ id: snapshot.id, ...snapshot.data() } as DeliveryZoneDocument)
      : undefined;

    await zoneRef.set(buildDeliveryZonePayload(zone, existing), { merge: true });
    if (snapshot.exists) updated += 1;
    else created += 1;
  }

  const verification = await Promise.all(
    deliveryZones.map(async (zone) => {
      const snapshot = await db.collection("deliveryZones").doc(zone.id).get();
      const data = snapshot.data() as DeliveryZoneDocument | undefined;
      return {
        id: zone.id,
        exists: snapshot.exists,
        method: data?.method,
        isActive: data?.isActive,
        minimumOrder: data?.minimumOrder,
        fee: data?.fee,
      };
    }),
  );

  const invalid = verification.filter(
    (entry) =>
      !entry.exists ||
      (entry.method !== "local_express" && entry.method !== "postal") ||
      typeof entry.isActive !== "boolean" ||
      !Number.isFinite(Number(entry.minimumOrder)) ||
      !Number.isFinite(Number(entry.fee)),
  );

  if (invalid.length) {
    console.error("Verification zones echouee:", invalid);
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        created,
        updated,
        verifiedZones: verification.length,
        activeLocalZones: verification.filter(
          (entry) => entry.method === "local_express" && entry.isActive,
        ).length,
        inactiveOutOfZone: verification.filter(
          (entry) => entry.method === "postal" && !entry.isActive,
        ).length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
