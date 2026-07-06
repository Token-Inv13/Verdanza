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
import {
  effectiveLocalDeliveryMinimum,
  effectivePostalDeliveryMinimum,
} from "../config/deliveryRules";
import type { DeliveryZone } from "../types";

export async function getDeliveryZonesWithFallback() {
  if (!db) return { zones: localDeliveryZones, source: "local" as const };
  try {
    const snapshot = await getDocs(collection(db, collections.deliveryZones));
    const zones = snapshot.docs.map((entry) =>
      normalizeDeliveryZone({ id: entry.id, ...entry.data() } as DeliveryZone),
    ).sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));
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
        {
          ...zone,
          slug: zone.slug || slugify(zone.name),
          isOpen: zone.isOpen ?? zone.isActive,
          status: zone.status || (zone.isActive ? "open" : "disabled"),
          minimumOrderAmount: zone.minimumOrderAmount ?? zone.minimumOrder,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    ),
  );
  return localDeliveryZones.length;
}

export async function updateDeliveryZoneAdmin(
  zoneId: string,
  data: Pick<
    DeliveryZone,
    | "name"
    | "isActive"
    | "isOpen"
    | "status"
    | "fee"
    | "minimumOrder"
    | "minimumOrderAmount"
    | "estimatedDelay"
    | "customerMessage"
    | "adminNote"
    | "sortOrder"
  >,
) {
  if (!db) throw new Error("Firebase is not configured.");
  await updateDoc(doc(db, collections.deliveryZones, zoneId), {
    name: data.name,
    slug: data.name ? slugify(data.name) : undefined,
    isActive: data.isActive,
    isOpen: data.isOpen ?? data.status === "open",
    status: data.status || (data.isActive ? "open" : "disabled"),
    fee: Number(data.fee || 0),
    minimumOrder: Number(data.minimumOrderAmount ?? data.minimumOrder ?? 0),
    minimumOrderAmount: Number(data.minimumOrderAmount ?? data.minimumOrder ?? 0),
    estimatedDelay: data.estimatedDelay,
    customerMessage: data.customerMessage || "",
    adminNote: data.adminNote || "",
    sortOrder: Number(data.sortOrder || 0),
    updatedAt: serverTimestamp(),
  });
}

function normalizeDeliveryZone(zone: DeliveryZone): DeliveryZone {
  const status = zone.status || (zone.isActive ? "open" : "disabled");
  const rawMinimum = Number(zone.minimumOrderAmount ?? zone.minimumOrder ?? 0);
  const minimumOrder =
    zone.method === "postal"
      ? effectivePostalDeliveryMinimum(rawMinimum)
      : effectiveLocalDeliveryMinimum(rawMinimum);
  return {
    ...zone,
    slug: zone.slug || slugify(zone.name),
    status,
    isOpen: zone.isOpen ?? status === "open",
    minimumOrder,
    minimumOrderAmount: minimumOrder,
    sortOrder: Number(zone.sortOrder || 0),
  };
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
