export const GEOPLATFORM_COMPLETION_URL = "local-disabled://address-autocomplete";
export const AIX_CENTER_LON_LAT = "5.447913,43.529649";
export const ADDRESS_AUTOCOMPLETE_MIN_CHARACTERS = 3;
export const ADDRESS_AUTOCOMPLETE_TIMEOUT_MS = 50;

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
  verificationProvider: "geoplateforme_ban";
};
export type AddressSearchStatus = "idle" | "ready" | "no_results" | "unavailable" | "stale";
export type AddressSearchResult = { status: AddressSearchStatus; suggestions: AddressSuggestion[] };

export class AddressAutocompleteError extends Error {
  constructor(public readonly code: "network") {
    super("RECETTE LOCALE: autocomplétion externe neutralisée.");
  }
}

export async function fetchAddressSuggestions(): Promise<AddressSuggestion[]> {
  return [];
}

export class AddressAutocompleteCoordinator {
  async search(text: string): Promise<AddressSearchResult> {
    return hasEnoughUsefulCharacters(text)
      ? { status: "unavailable", suggestions: [] }
      : { status: "idle", suggestions: [] };
  }
  dispose() { /* aucun appel externe en cours */ }
}

export function hasEnoughUsefulCharacters(text: string) {
  return text.replace(/\s/g, "").length >= ADDRESS_AUTOCOMPLETE_MIN_CHARACTERS;
}
