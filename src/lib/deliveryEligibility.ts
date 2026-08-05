import type { Address, DeliveryMethod, DeliveryZone } from "../types/index.js";

const EARTH_RADIUS_METERS = 6_371_008.8;

export type DeliveryEligibilityReason =
  | "address_not_selected"
  | "eligible_radius"
  | "eligible_legacy"
  | "outside_active_radius_zones"
  | "no_active_local_zone"
  | "legacy_zone_not_selected";

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
  if (!isVerifiedDeliveryAddress(address)) {
    return { eligible: false, reason: "address_not_selected" };
  }

  const activeLocalZones = zones
    .filter((zone) => zone.method === "local_express")
    .filter(isDeliveryZoneAvailable)
    .sort(compareDeliveryZones);
  if (!activeLocalZones.length) {
    return { eligible: false, reason: "no_active_local_zone" };
  }

  const radiusZones = activeLocalZones.filter(isAutomaticRadiusZone);
  if (radiusZones.length) {
    const matches = radiusZones
      .map((zone) => {
        const distanceMeters = haversineDistanceMeters(
          {
            latitude: address.latitude as number,
            longitude: address.longitude as number,
          },
          {
            latitude: zone.centerLatitude as number,
            longitude: zone.centerLongitude as number,
          },
        );
        return { zone, distanceMeters, radiusMeters: Number(zone.radiusMeters) };
      })
      .filter((candidate) => candidate.distanceMeters <= candidate.radiusMeters + 0.01)
      .sort((left, right) => compareDeliveryZones(left.zone, right.zone));
    const match = matches[0];
    return match
      ? {
          eligible: true,
          reason: "eligible_radius",
          zone: match.zone,
          distanceMeters: match.distanceMeters,
          radiusMeters: match.radiusMeters,
        }
      : { eligible: false, reason: "outside_active_radius_zones" };
  }

  const legacyZone = activeLocalZones.find(
    (zone) => (zone.validationMode ?? "legacy") === "legacy" && zone.id === legacyZoneId,
  );
  return legacyZone
    ? { eligible: true, reason: "eligible_legacy", zone: legacyZone }
    : { eligible: false, reason: "legacy_zone_not_selected" };
}

export function isVerifiedDeliveryAddress(
  address?: VerifiedAddressCoordinates | null,
): address is Required<VerifiedAddressCoordinates> {
  return Boolean(
    address &&
      address.verificationProvider === "geoplateforme_ban" &&
      typeof address.verifiedAt === "string" &&
      Number.isFinite(Date.parse(address.verifiedAt)) &&
      Number.isFinite(address.latitude) &&
      Number.isFinite(address.longitude) &&
      Number(address.latitude) >= -90 &&
      Number(address.latitude) <= 90 &&
      Number(address.longitude) >= -180 &&
      Number(address.longitude) <= 180,
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
  return Boolean(
    zone.validationMode === "radius" &&
      zone.addressValidationEnabled === true &&
      Number.isFinite(zone.centerLatitude) &&
      Number.isFinite(zone.centerLongitude) &&
      Number.isFinite(zone.radiusMeters) &&
      Number(zone.radiusMeters) > 0,
  );
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

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}
