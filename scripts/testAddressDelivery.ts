import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { aixRadiusDeliveryZone } from "../src/data/deliveryZones.js";
import {
  enforceEligibleDeliveryMethod,
  evaluateDeliveryEligibility,
  haversineDistanceMeters,
  kilometersToMeters,
} from "../src/lib/deliveryEligibility.js";
import { normalizeAddressCoordinates } from "../src/lib/addressCoordinates.js";
import { invalidateAddressVerification } from "../src/lib/checkoutAddress.js";
import {
  AddressAutocompleteCoordinator,
  fetchAddressSuggestions,
} from "../src/services/addressAutocompleteService.js";
import type { Address, DeliveryZone } from "../src/types/index.js";
import { validateDeliveryZoneAdminInput } from "../src/services/deliveryZonesService.js";

const center = { latitude: 43.529649, longitude: 5.447913 };
const nearbyAddressCoordinates = { latitude: 43.522725, longitude: 5.428038 };
const earthRadiusMeters = 6_371_008.8;
const verifiedAddress: Address = {
  firstName: "Client",
  lastName: "Test",
  line1: "1 Rue des Tests",
  postalCode: "13000",
  city: "Ville-Test",
  country: "France",
  normalizedLabel: "1 Rue des Tests, 13000 Ville-Test",
  houseNumber: "1",
  street: "Rue des Tests",
  latitude: center.latitude,
  longitude: center.longitude,
  verifiedAt: "2026-08-05T10:00:00.000Z",
  verificationProvider: "geoplateforme_ban",
};

function radiusZone(overrides: Partial<DeliveryZone> = {}): DeliveryZone {
  return {
    ...aixRadiusDeliveryZone,
    isActive: true,
    isOpen: true,
    status: "open",
    ...overrides,
  };
}

function addressAtDistance(distanceMeters: number): Address {
  return {
    ...verifiedAddress,
    latitude:
      center.latitude + (distanceMeters / earthRadiusMeters) * (180 / Math.PI),
  };
}

const inside = evaluateDeliveryEligibility([radiusZone()], addressAtDistance(14_999));
assert.equal(inside.eligible, true, "an address inside the radius must be eligible");

const boundaryAddress = addressAtDistance(15_000);
assert.ok(
  Math.abs(
    haversineDistanceMeters(center, {
      latitude: boundaryAddress.latitude as number,
      longitude: boundaryAddress.longitude as number,
    }) - 15_000,
  ) < 0.001,
  "boundary fixture must be exactly on the configured radius",
);
assert.equal(
  evaluateDeliveryEligibility([radiusZone()], boundaryAddress).eligible,
  true,
  "the radius boundary must be inclusive",
);

assert.equal(
  evaluateDeliveryEligibility([radiusZone()], addressAtDistance(15_001)).eligible,
  false,
  "an address outside the radius must be rejected",
);
assert.equal(kilometersToMeters(15), 15_000, "15 km must normalize to 15,000 meters");
assert.equal(kilometersToMeters("15"), 15_000, "numeric radius strings are supported");
assert.equal(
  evaluateDeliveryEligibility([radiusZone({ isActive: false })], verifiedAddress).reason,
  "no_active_local_zone",
  "inactive zones must be ignored",
);
assert.equal(
  evaluateDeliveryEligibility([radiusZone({ isOpen: false })], verifiedAddress).reason,
  "no_active_local_zone",
  "closed zones must be ignored",
);
assert.equal(
  evaluateDeliveryEligibility([radiusZone()], verifiedAddress).reason,
  "eligible",
  "an active and open zone must be used",
);

const selectedByPriority = evaluateDeliveryEligibility(
  [
    radiusZone({ id: "second", sortOrder: 2 }),
    radiusZone({ id: "first", sortOrder: 1 }),
  ],
  verifiedAddress,
);
assert.equal(selectedByPriority.zone?.id, "first", "the first eligible zone by priority wins");

const legacyZone: DeliveryZone = {
  id: "legacy-test",
  name: "Zone historique",
  method: "local_express",
  isActive: true,
  isOpen: true,
  status: "open",
  fee: 0,
  minimumOrder: 20,
  estimatedDelay: "Après confirmation",
  slots: [],
};
assert.equal(
  evaluateDeliveryEligibility([legacyZone], verifiedAddress, legacyZone.id).reason,
  "eligible",
  "legacy zones without new fields remain compatible",
);

const noAddress = evaluateDeliveryEligibility([legacyZone], null, legacyZone.id);
assert.equal(noAddress.eligible, false, "local delivery requires a selected address");
assert.equal(
  enforceEligibleDeliveryMethod("local_express", noAddress),
  "postal",
  "postal delivery remains selected when local delivery cannot be verified",
);
const missingCoordinates = evaluateDeliveryEligibility(
  [radiusZone()],
  {
    verificationProvider: "geoplateforme_ban",
    verifiedAt: "2026-08-05T10:00:00.000Z",
  },
);
assert.equal(missingCoordinates.reason, "missing_address_coordinates");
assert.notEqual(missingCoordinates.reason, "outside_radius");

const invalidCoordinates = evaluateDeliveryEligibility(
  [radiusZone()],
  {
    latitude: 95,
    longitude: 5.4,
    verificationProvider: "geoplateforme_ban",
    verifiedAt: "2026-08-05T10:00:00.000Z",
  },
);
assert.equal(invalidCoordinates.reason, "invalid_address_coordinates");
assert.equal(
  evaluateDeliveryEligibility(
    [radiusZone({ centerLatitude: undefined })],
    verifiedAddress,
  ).reason,
  "invalid_zone_coordinates",
  "invalid zone coordinates must not be reported as outside the radius",
);

assert.deepEqual(
  normalizeAddressCoordinates({ latitude: "43.522725", longitude: "5.428038" }),
  nearbyAddressCoordinates,
  "numeric coordinate strings must be normalized",
);
assert.equal(
  evaluateDeliveryEligibility(
    [radiusZone()],
    {
      latitude: "43.522725",
      longitude: "5.428038",
      verificationProvider: "geoplateforme_ban",
      verifiedAt: "2026-08-05T10:00:00.000Z",
    } as unknown as Address,
  ).reason,
  "eligible",
  "numeric coordinate strings must remain eligible after normalization",
);
assert.deepEqual(
  normalizeAddressCoordinates({ lat: 43.522725, lon: 5.428038 }),
  nearbyAddressCoordinates,
);
assert.deepEqual(
  normalizeAddressCoordinates({ geometry: { coordinates: [5.428038, 43.522725] } }),
  nearbyAddressCoordinates,
);
assert.equal(
  normalizeAddressCoordinates({ x: 43.522725, y: 5.428038 }),
  null,
  "inverted metropolitan x/y coordinates must be rejected, not silently swapped",
);
assert.equal(
  evaluateDeliveryEligibility(
    [radiusZone()],
    {
      latitude: 5.428038,
      longitude: 43.522725,
      verificationProvider: "geoplateforme_ban",
      verifiedAt: "2026-08-05T10:00:00.000Z",
    },
  ).reason,
  "invalid_address_coordinates",
  "inverted selected-address coordinates must be rejected before Haversine",
);
assert.equal(normalizeAddressCoordinates({ x: 0, y: 0 }), null);
assert.equal(normalizeAddressCoordinates({ x: "not-a-number", y: 43.5 }), null);

const invalidated = invalidateAddressVerification(verifiedAddress, {
  line1: "2 Rue des Tests",
});
assert.equal(invalidated.line1, "2 Rue des Tests");
assert.equal(invalidated.latitude, undefined);
assert.equal(invalidated.longitude, undefined);
assert.equal(invalidated.verificationProvider, undefined);
assert.equal(invalidated.verifiedAt, undefined);

const validApiPayload = {
  status: "OK",
  results: [
    {
      x: 5.428038,
      y: 43.522725,
      country: "StreetAddress",
      city: "Aix-en-Provence",
      oldcity: "",
      kind: "housenumber",
      zipcode: "13090",
      street: "Rue  Edouard Herriot",
      metropole: true,
      fulltext: "20 Rue  Edouard Herriot, 13090 Aix-en-Provence",
      classification: 7,
    },
  ],
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let requestedUrl = "";
const suggestions = await fetchAddressSuggestions("20 rue Édouard-Herriot", {
  signal: new AbortController().signal,
  fetchImpl: (async (input) => {
    requestedUrl = String(input);
    return jsonResponse(validApiPayload);
  }) as typeof fetch,
});
assert.equal(suggestions.length, 1);
assert.equal(suggestions[0].latitude, nearbyAddressCoordinates.latitude);
assert.equal(suggestions[0].longitude, nearbyAddressCoordinates.longitude);
assert.equal(suggestions[0].verificationProvider, "geoplateforme_ban");
assert.match(requestedUrl, /type=StreetAddress/);
assert.match(requestedUrl, /terr=METROPOLE/);
assert.match(requestedUrl, /maximumResponses=5/);
assert.match(requestedUrl, /lonlat=5\.447913%2C43\.529649/);

const nearbyEligibility = evaluateDeliveryEligibility(
  [radiusZone()],
  { ...suggestions[0], verifiedAt: "2026-08-05T10:00:00.000Z" },
);
assert.equal(nearbyEligibility.reason, "eligible");
assert.ok(
  Number(nearbyEligibility.distanceMeters) >= 1_700 &&
    Number(nearbyEligibility.distanceMeters) <= 1_900,
  `Edouard-Herriot distance must be between 1,700 and 1,900 meters, got ${nearbyEligibility.distanceMeters}`,
);
assert.equal(nearbyEligibility.radiusMeters, 15_000);

const noSuggestions = await new AddressAutocompleteCoordinator(
  (async () => jsonResponse({ status: "OK", results: [] })) as typeof fetch,
).search("rue sans résultat");
assert.equal(noSuggestions.status, "no_results", "empty API responses are handled");

for (const [name, fetchImpl] of [
  ["invalid response", async () => jsonResponse({ status: "OK" })],
  ["network error", async () => { throw new Error("network"); }],
  ["rate limit", async () => jsonResponse({}, 429)],
] as const) {
  const result = await new AddressAutocompleteCoordinator(fetchImpl as typeof fetch).search(
    "adresse test",
  );
  assert.equal(result.status, "unavailable", `${name} must expose a safe unavailable state`);
  assert.equal(
    enforceEligibleDeliveryMethod("local_express", noAddress),
    "postal",
    `${name} must leave postal delivery available`,
  );
}

let autocompleteCall = 0;
const staleCoordinator = new AddressAutocompleteCoordinator(((input, init) => {
  autocompleteCall += 1;
  if (autocompleteCall === 1) {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
  }
  return Promise.resolve(jsonResponse(validApiPayload));
}) as typeof fetch);
const staleRequest = staleCoordinator.search("première adresse");
const currentRequest = staleCoordinator.search("seconde adresse");
assert.equal((await currentRequest).status, "ready");
assert.equal((await staleRequest).status, "stale", "obsolete requests are cancelled and ignored");

assert.equal(aixRadiusDeliveryZone.id, "local-aix-radius-15km");
assert.equal(aixRadiusDeliveryZone.isActive, false);
assert.equal(aixRadiusDeliveryZone.isOpen, false);
assert.equal(aixRadiusDeliveryZone.status, "disabled");
assert.equal(aixRadiusDeliveryZone.radiusMeters, 15_000);
assert.equal(aixRadiusDeliveryZone.minimumOrder, 20);
assert.equal(aixRadiusDeliveryZone.fee, 0);
assert.equal(aixRadiusDeliveryZone.estimatedDelayMinMinutes, 60);
assert.equal(aixRadiusDeliveryZone.estimatedDelayMaxMinutes, 120);
const validAdminZone = validateDeliveryZoneAdminInput({
  ...aixRadiusDeliveryZone,
  estimatedDelay: aixRadiusDeliveryZone.estimatedDelay,
});
assert.equal(validAdminZone.centerLatitude, 43.529649);
assert.throws(
  () =>
    validateDeliveryZoneAdminInput({
      ...validAdminZone,
      centerLatitude: 91,
    }),
  /latitude/i,
);
assert.throws(
  () =>
    validateDeliveryZoneAdminInput({
      ...validAdminZone,
      radiusMeters: 0,
    }),
  /rayon/i,
);
const initializedZoneIds = new Set<string>();
initializedZoneIds.add(aixRadiusDeliveryZone.id);
initializedZoneIds.add(aixRadiusDeliveryZone.id);
assert.equal(initializedZoneIds.size, 1, "the stable document id prevents duplicate initialization");

const componentSource = await readFile("src/components/AddressAutocomplete.tsx", "utf8");
assert.match(componentSource, /role="combobox"/);
assert.match(componentSource, /role="listbox"/);
assert.match(componentSource, /ArrowDown/);
assert.match(componentSource, /ArrowUp/);
assert.match(componentSource, /event\.key === "Enter"/);
assert.match(componentSource, /event\.key === "Escape"/);

console.log(
  `Address autocomplete and delivery radius tests passed: reference distance ${nearbyEligibility.distanceMeters?.toFixed(2)} m, eligible.`,
);
