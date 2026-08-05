export type NormalizedAddressCoordinates = {
  latitude: number;
  longitude: number;
};

type CoordinatePair = {
  latitude: unknown;
  longitude: unknown;
};

const METROPOLITAN_FRANCE_BOUNDS = {
  minimumLatitude: 41,
  maximumLatitude: 52,
  minimumLongitude: -6,
  maximumLongitude: 10,
};

export function normalizeAddressCoordinates(
  value: unknown,
): NormalizedAddressCoordinates | null {
  const pair = addressCoordinatePair(value);
  if (!pair) return null;

  const latitude = finiteCoordinate(pair.latitude);
  const longitude = finiteCoordinate(pair.longitude);
  if (
    latitude === null ||
    longitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    (latitude === 0 && longitude === 0) ||
    looksLikeInvertedMetropolitanCoordinates(latitude, longitude)
  ) {
    return null;
  }

  return { latitude, longitude };
}

export function hasAddressCoordinateValues(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    hasPairValues(record.latitude, record.longitude) ||
    hasPairValues(record.lat, record.lon) ||
    hasPairValues(record.y, record.x) ||
    geometryCoordinates(record.geometry) !== null
  );
}

function addressCoordinatePair(value: unknown): CoordinatePair | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  if (hasPairValues(record.latitude, record.longitude)) {
    return { latitude: record.latitude, longitude: record.longitude };
  }
  if (hasPairValues(record.lat, record.lon)) {
    return { latitude: record.lat, longitude: record.lon };
  }
  // Géoplateforme completion documents x as longitude and y as latitude.
  if (hasPairValues(record.y, record.x)) {
    return { latitude: record.y, longitude: record.x };
  }

  const geometry = geometryCoordinates(record.geometry);
  return geometry
    ? { longitude: geometry[0], latitude: geometry[1] }
    : null;
}

function geometryCoordinates(value: unknown): [unknown, unknown] | null {
  if (!value || typeof value !== "object") return null;
  const coordinates = (value as { coordinates?: unknown }).coordinates;
  return Array.isArray(coordinates) && coordinates.length >= 2
    ? [coordinates[0], coordinates[1]]
    : null;
}

function hasPairValues(first: unknown, second: unknown) {
  return first !== undefined && first !== null && second !== undefined && second !== null;
}

function finiteCoordinate(value: unknown) {
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = typeof value === "number" || typeof value === "string"
    ? Number(value)
    : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function looksLikeInvertedMetropolitanCoordinates(
  latitude: number,
  longitude: number,
) {
  return (
    !isWithinMetropolitanFrance(latitude, longitude) &&
    isWithinMetropolitanFrance(longitude, latitude)
  );
}

function isWithinMetropolitanFrance(latitude: number, longitude: number) {
  return (
    latitude >= METROPOLITAN_FRANCE_BOUNDS.minimumLatitude &&
    latitude <= METROPOLITAN_FRANCE_BOUNDS.maximumLatitude &&
    longitude >= METROPOLITAN_FRANCE_BOUNDS.minimumLongitude &&
    longitude <= METROPOLITAN_FRANCE_BOUNDS.maximumLongitude
  );
}
