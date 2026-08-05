export const GEOPLATFORM_COMPLETION_URL =
  "https://data.geopf.fr/geocodage/completion/";
export const AIX_CENTER_LON_LAT = "5.447913,43.529649";
export const ADDRESS_AUTOCOMPLETE_MIN_CHARACTERS = 3;
export const ADDRESS_AUTOCOMPLETE_TIMEOUT_MS = 8_000;

export type AddressSuggestion = {
  id: string;
  label: string;
  line1: string;
  houseNumber?: string;
  street?: string;
  postalCode: string;
  city: string;
  latitude: number;
  longitude: number;
  provider: "geoplateforme_ban";
};

export type AddressSearchStatus =
  | "idle"
  | "ready"
  | "no_results"
  | "unavailable"
  | "stale";

export type AddressSearchResult = {
  status: AddressSearchStatus;
  suggestions: AddressSuggestion[];
};

export class AddressAutocompleteError extends Error {
  constructor(
    public readonly code: "rate_limited" | "network" | "invalid_response" | "timeout",
  ) {
    super(code);
    this.name = "AddressAutocompleteError";
  }
}

export async function fetchAddressSuggestions(
  text: string,
  options: {
    signal: AbortSignal;
    fetchImpl?: typeof fetch;
  },
) {
  const normalizedText = text.trim();
  if (!hasEnoughUsefulCharacters(normalizedText)) return [];

  const url = new URL(GEOPLATFORM_COMPLETION_URL);
  url.searchParams.set("text", normalizedText);
  url.searchParams.set("type", "StreetAddress");
  url.searchParams.set("terr", "METROPOLE");
  url.searchParams.set("maximumResponses", "5");
  url.searchParams.set("lonlat", AIX_CENTER_LON_LAT);

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      method: "GET",
      signal: options.signal,
      headers: { accept: "application/json" },
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new AddressAutocompleteError("network");
  }

  if (response.status === 429) throw new AddressAutocompleteError("rate_limited");
  if (!response.ok) throw new AddressAutocompleteError("network");

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AddressAutocompleteError("invalid_response");
  }
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { results?: unknown }).results)) {
    throw new AddressAutocompleteError("invalid_response");
  }

  const rawResults = (payload as { results: unknown[] }).results;
  const suggestions = rawResults
    .map(parseSuggestion)
    .filter((entry): entry is AddressSuggestion => Boolean(entry));
  if (rawResults.length && !suggestions.length) {
    throw new AddressAutocompleteError("invalid_response");
  }
  return suggestions.slice(0, 5);
}

export class AddressAutocompleteCoordinator {
  private activeRequestId = 0;
  private activeController?: AbortController;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = ADDRESS_AUTOCOMPLETE_TIMEOUT_MS,
  ) {}

  async search(text: string): Promise<AddressSearchResult> {
    this.activeController?.abort();
    const requestId = ++this.activeRequestId;
    if (!hasEnoughUsefulCharacters(text)) {
      return { status: "idle", suggestions: [] };
    }

    const controller = new AbortController();
    this.activeController = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const suggestions = await fetchAddressSuggestions(text, {
        signal: controller.signal,
        fetchImpl: this.fetchImpl,
      });
      if (requestId !== this.activeRequestId || controller.signal.aborted) {
        return { status: "stale", suggestions: [] };
      }
      return {
        status: suggestions.length ? "ready" : "no_results",
        suggestions,
      };
    } catch (error) {
      if (requestId !== this.activeRequestId) {
        return { status: "stale", suggestions: [] };
      }
      if (timedOut) {
        return { status: "unavailable", suggestions: [] };
      }
      if (isAbortError(error)) {
        return { status: "stale", suggestions: [] };
      }
      return { status: "unavailable", suggestions: [] };
    } finally {
      clearTimeout(timeout);
      if (requestId === this.activeRequestId) this.activeController = undefined;
    }
  }

  dispose() {
    this.activeRequestId += 1;
    this.activeController?.abort();
    this.activeController = undefined;
  }
}

export function hasEnoughUsefulCharacters(text: string) {
  return text.replace(/\s/g, "").length >= ADDRESS_AUTOCOMPLETE_MIN_CHARACTERS;
}

function parseSuggestion(value: unknown): AddressSuggestion | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  const label = stringValue(result.fulltext);
  const city = stringValue(result.city);
  const postalCode = stringValue(result.zipcode);
  const latitude = Number(result.y);
  const longitude = Number(result.x);
  if (
    !label ||
    !city ||
    !postalCode ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  const houseNumber = stringValue(result.housenumber || result.number) || undefined;
  const street = stringValue(result.street) || undefined;
  const line1 = [houseNumber, street].filter(Boolean).join(" ") || label.split(",")[0]?.trim();
  if (!line1) return null;
  return {
    id: `${longitude}:${latitude}:${label}`,
    label,
    line1,
    houseNumber,
    street,
    postalCode,
    city,
    latitude,
    longitude,
    provider: "geoplateforme_ban",
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}
