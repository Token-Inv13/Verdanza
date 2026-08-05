import type { Address, DeliveryMethod, DeliveryZone } from "../types/index.js";
import {
  hasAddressCoordinateValues,
  normalizeAddressCoordinates,
} from "./addressCoordinates.js";

const EARTH_RADIUS_METERS = 6_371_008.8;

export type DeliveryEligibilityReason =
  | "address_not_selected"
  | "eligible"
  | "outside_radius"
  | "missing_address_coordinates"
  | "invalid_address_coordinates"
  | "invalid_zone_coordinates"
  | "no_active_local_zone";

export type DeliveryEligibilityResult = {
  eligible: boolean;
  reason: DeliveryEligibilityReason;
  zone?: DeliveryZone;
  distanceMeters?: number;
  radiusMeters?: number;
};

export type VerifiedAddressCoordinates = Pick<
  Address,
  "latitude" | "longitude" | "verifiedAt" | "verificationProvider"
>;

export function haversineDistanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const latitudeDelta = degreesToRadians(to.latitude - from.latitude);
  const longitudeDelta = degreesToRadians(to.longitude - from.longitude);
  const fromLatitude = degreesToRadians(from.latitude);
  const toLatitude = degreesToRadians(to.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  const centralAngle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return EARTH_RADIUS_METERS * centralAngle;
}

export function evaluateDeliveryEligibility(
  zones: DeliveryZone[],
  address?: VerifiedAddressCoordinates | null,
  legacyZoneId?: string,
): DeliveryEligibilityResult {
  if (!address || !hasValidSelectionProof(address)) {
    return { eligible: false, reason: "address_not_selected" };
  }
  if (!hasAddressCoordinateValues(address)) {
    return { eligible: false, reason: "missing_address_coordinates" };
  }
  const addressCoordinates = normalizeAddressCoordinates(address);
  if (!addressCoordinates) {
    return { eligible: false, reason: "invalid_address_coordinates" };
  }

  const activeLocalZones = zones
    .filter((zone) => zone.method === "local_express")
    .filter(isDeliveryZoneAvailable)
    .sort(compareDeliveryZones);
  if (!activeLocalZones.length) {
    return { eligible: false, reason: "no_active_local_zone" };
  }

  const automaticRadiusZones = activeLocalZones.filter(
    (zone) => zone.validationMode === "radius" && zone.addressValidationEnabled === true,
  );
  if (automaticRadiusZones.length) {
    const radiusZones = automaticRadiusZones.filter(isAutomaticRadiusZone);
    if (!radiusZones.length) {
      return { eligible: false, reason: "invalid_zone_coordinates" };
    }
    const matches = radiusZones
      .map((zone) => {
        const zoneCoordinates = normalizeAddressCoordinates({
          latitude: zone.centerLatitude,
          longitude: zone.centerLongitude,
        });
        if (!zoneCoordinates) return null;
        const distanceMeters = haversineDistanceMeters(
          addressCoordinates,
          zoneCoordinates,
        );
        return { zone, distanceMeters, radiusMeters: Number(zone.radiusMeters) };
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .filter((candidate) => candidate.distanceMeters <= candidate.radiusMeters + 0.01)
      .sort((left, right) => compareDeliveryZones(left.zone, right.zone));
    const match = matches[0];
    return match
      ? {
          eligible: true,
          reason: "eligible",
          zone: match.zone,
          distanceMeters: match.distanceMeters,
          radiusMeters: match.radiusMeters,
        }
      : { eligible: false, reason: "outside_radius" };
  }

  const legacyZone = activeLocalZones.find(
    (zone) => (zone.validationMode ?? "legacy") === "legacy" && zone.id === legacyZoneId,
  );
  return legacyZone
    ? { eligible: true, reason: "eligible", zone: legacyZone }
    : { eligible: false, reason: "no_active_local_zone" };
}

export function isVerifiedDeliveryAddress(
  address?: VerifiedAddressCoordinates | null,
): address is Required<VerifiedAddressCoordinates> {
  return Boolean(
    address &&
      hasValidSelectionProof(address) &&
      normalizeAddressCoordinates(address),
  );
}

export function isDeliveryZoneAvailable(zone?: DeliveryZone | null) {
  return Boolean(
    zone &&
      zone.isActive !== false &&
      zone.isOpen !== false &&
      (zone.status || "open") === "open" &&
      zone.isArchived !== true,
  );
}

export function isAutomaticRadiusZone(zone: DeliveryZone) {
  const coordinates = normalizeAddressCoordinates({
    latitude: zone.centerLatitude,
    longitude: zone.centerLongitude,
  });
  return Boolean(
    zone.validationMode === "radius" &&
      zone.addressValidationEnabled === true &&
      coordinates &&
      Number.isFinite(Number(zone.radiusMeters)) &&
      Number(zone.radiusMeters) > 0,
  );
}

export function kilometersToMeters(radiusKm: number | string) {
  const parsed = Number(radiusKm);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1_000 : undefined;
}

export function enforceEligibleDeliveryMethod(
  requestedMethod: DeliveryMethod,
  eligibility: DeliveryEligibilityResult,
): DeliveryMethod {
  return requestedMethod === "local_express" && !eligibility.eligible
    ? "postal"
    : requestedMethod;
}

function compareDeliveryZones(left: DeliveryZone, right: DeliveryZone) {
  return Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || left.id.localeCompare(right.id);
}

function hasValidSelectionProof(address: VerifiedAddressCoordinates) {
  return (
    address.verificationProvider === "geoplateforme_ban" &&
    typeof address.verifiedAt === "string" &&
    Number.isFinite(Date.parse(address.verifiedAt))
  );
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}
