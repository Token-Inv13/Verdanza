import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { deliveryZones as localDeliveryZones } from "../data/deliveryZones";
import { collections } from "./collections";
import type { DeliveryZone } from "../types";

export async function getDeliveryZonesWithFallback() {
  if (!db) return { zones: localDeliveryZones, source: "local" as const };
  try {
    const snapshot = await getDocs(collection(db, collections.deliveryZones));
    const zones = snapshot.docs.map(
      (entry) => ({ id: entry.id, ...entry.data() }) as DeliveryZone,
    );
    return {
      zones: zones.length ? zones : localDeliveryZones,
      source: zones.length ? ("firestore" as const) : ("local" as const),
    };
  } catch (error) {
    console.warn("Falling back to local delivery zones", error);
    return { zones: localDeliveryZones, source: "local" as const };
  }
}

export async function seedInitialDeliveryZones() {
  if (!db) throw new Error("Firebase is not configured.");
  const database = db;
  await Promise.all(
    localDeliveryZones.map((zone) =>
      setDoc(
        doc(database, collections.deliveryZones, zone.id),
        { ...zone, updatedAt: serverTimestamp() },
        { merge: true },
      ),
    ),
  );
  return localDeliveryZones.length;
}

export async function updateDeliveryZoneAdmin(
  zoneId: string,
  data: Pick<DeliveryZone, "isActive" | "fee" | "minimumOrder" | "estimatedDelay">,
) {
  if (!db) throw new Error("Firebase is not configured.");
  await updateDoc(doc(db, collections.deliveryZones, zoneId), {
    isActive: data.isActive,
    fee: Number(data.fee || 0),
    minimumOrder: Number(data.minimumOrder || 0),
    estimatedDelay: data.estimatedDelay,
    updatedAt: serverTimestamp(),
  });
}
