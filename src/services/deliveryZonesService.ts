import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { deliveryZones as localDeliveryZones } from "../data/deliveryZones";
import { logFirestoreFallback } from "../lib/clientLog";
import { collections } from "./collections";
import {
  effectiveLocalDeliveryMinimum,
  effectivePostalDeliveryMinimum,
} from "../config/deliveryRules";
import type { DeliveryZone } from "../types";

export type DeliveryZoneAdminInput = Pick<
  DeliveryZone,
  | "name"
  | "isActive"
  | "isOpen"
  | "status"
  | "fee"
  | "minimumOrder"
  | "minimumOrderAmount"
  | "estimatedDelay"
  | "estimatedDelayMinMinutes"
  | "estimatedDelayMaxMinutes"
  | "customerMessage"
  | "adminNote"
  | "sortOrder"
  | "validationMode"
  | "centerLabel"
  | "centerLatitude"
  | "centerLongitude"
  | "radiusMeters"
  | "addressValidationEnabled"
>;

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
    logFirestoreFallback("Falling back to local delivery zones", error);
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
  data: DeliveryZoneAdminInput,
) {
  if (!db) throw new Error("Firebase is not configured.");
  const normalized = validateDeliveryZoneAdminInput(data);
  await updateDoc(doc(db, collections.deliveryZones, zoneId), {
    ...deliveryZoneWriteFields(normalized),
    updatedAt: serverTimestamp(),
  });
}

export async function createDeliveryZoneAdmin(data: DeliveryZoneAdminInput) {
  if (!db) throw new Error("Firebase is not configured.");
  const normalized = validateDeliveryZoneAdminInput(data);
  const name = normalized.name;
  const slug = slugify(name);
  const zoneId = `local-${slug || "zone"}-${uniqueSuffix()}`;

  await setDoc(doc(db, collections.deliveryZones, zoneId), {
    id: zoneId,
    method: "local_express",
    ...deliveryZoneWriteFields({
      ...normalized,
      isActive: false,
      isOpen: false,
      status: "disabled",
    }),
    slots: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return zoneId;
}

export async function deleteDeliveryZoneAdmin(zoneId: string) {
  if (!db) throw new Error("Firebase is not configured.");
  await deleteDoc(doc(db, collections.deliveryZones, zoneId));
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
    estimatedDelayMinMinutes: optionalPositiveNumberOrUndefined(zone.estimatedDelayMinMinutes),
    estimatedDelayMaxMinutes: optionalPositiveNumberOrUndefined(zone.estimatedDelayMaxMinutes),
    validationMode: zone.validationMode === "radius" ? "radius" : "legacy",
    centerLabel: zone.centerLabel || undefined,
    centerLatitude: optionalCoordinateOrUndefined(zone.centerLatitude, -90, 90),
    centerLongitude: optionalCoordinateOrUndefined(zone.centerLongitude, -180, 180),
    radiusMeters: optionalPositiveNumberOrUndefined(zone.radiusMeters),
    addressValidationEnabled: zone.addressValidationEnabled === true,
    sortOrder: Number(zone.sortOrder || 0),
  };
}

export function validateDeliveryZoneAdminInput(
  data: DeliveryZoneAdminInput,
): DeliveryZoneAdminInput {
  const name = data.name.trim();
  if (!name) throw new Error("Le nom de la zone est obligatoire.");
  const validationMode = data.validationMode === "radius" ? "radius" : "legacy";
  const normalized: DeliveryZoneAdminInput = {
    ...data,
    name,
    validationMode,
    fee: nonNegativeNumber(data.fee, "Les frais doivent être positifs ou nuls."),
    minimumOrder: nonNegativeNumber(
      data.minimumOrderAmount ?? data.minimumOrder,
      "Le minimum de commande doit être positif ou nul.",
    ),
    minimumOrderAmount: nonNegativeNumber(
      data.minimumOrderAmount ?? data.minimumOrder,
      "Le minimum de commande doit être positif ou nul.",
    ),
    sortOrder: finiteNumber(data.sortOrder ?? 0, "L’ordre d’affichage est invalide."),
    centerLabel: data.centerLabel?.trim() || undefined,
    centerLatitude: optionalCoordinateOrUndefined(data.centerLatitude, -90, 90),
    centerLongitude: optionalCoordinateOrUndefined(data.centerLongitude, -180, 180),
    radiusMeters: optionalPositiveNumberOrUndefined(data.radiusMeters),
    addressValidationEnabled: data.addressValidationEnabled === true,
  };
  if (validationMode === "radius") {
    if (!normalized.centerLabel) {
      throw new Error("Le libellé du centre géographique est obligatoire.");
    }
    if (normalized.centerLatitude === undefined) {
      throw new Error("La latitude doit être comprise entre -90 et 90.");
    }
    if (normalized.centerLongitude === undefined) {
      throw new Error("La longitude doit être comprise entre -180 et 180.");
    }
    if (normalized.radiusMeters === undefined) {
      throw new Error("Le rayon maximal doit être strictement supérieur à 0.");
    }
  }
  return normalized;
}

function deliveryZoneWriteFields(data: DeliveryZoneAdminInput) {
  return {
    name: data.name,
    slug: slugify(data.name),
    isActive: data.isActive,
    isOpen: data.isOpen ?? data.status === "open",
    status: data.status || (data.isActive ? "open" : "disabled"),
    fee: Number(data.fee || 0),
    minimumOrder: Number(data.minimumOrderAmount ?? data.minimumOrder ?? 0),
    minimumOrderAmount: Number(data.minimumOrderAmount ?? data.minimumOrder ?? 0),
    estimatedDelay: data.estimatedDelay || "",
    estimatedDelayMinMinutes: optionalPositiveNumberOrNull(data.estimatedDelayMinMinutes),
    estimatedDelayMaxMinutes: optionalPositiveNumberOrNull(data.estimatedDelayMaxMinutes),
    customerMessage: data.customerMessage || "",
    adminNote: data.adminNote || "",
    sortOrder: Number(data.sortOrder || 0),
    validationMode: data.validationMode === "radius" ? "radius" : "legacy",
    centerLabel: data.centerLabel || null,
    centerLatitude: data.centerLatitude ?? null,
    centerLongitude: data.centerLongitude ?? null,
    radiusMeters: data.radiusMeters ?? null,
    addressValidationEnabled: data.addressValidationEnabled === true,
  };
}

function optionalPositiveNumberOrUndefined(value?: number | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function optionalPositiveNumberOrNull(value?: number | null) {
  return optionalPositiveNumberOrUndefined(value) ?? null;
}

function optionalCoordinateOrUndefined(
  value: number | null | undefined,
  minimum: number,
  maximum: number,
) {
  if (value === undefined || value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

function finiteNumber(value: number, message: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(message);
  return parsed;
}

function nonNegativeNumber(value: number, message: string) {
  const parsed = finiteNumber(value, message);
  if (parsed < 0) throw new Error(message);
  return parsed;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function uniqueSuffix() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
