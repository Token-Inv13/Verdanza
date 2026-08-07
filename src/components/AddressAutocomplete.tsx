import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  AddressAutocompleteCoordinator,
  hasEnoughUsefulCharacters,
  type AddressSearchStatus,
  type AddressSuggestion,
} from "../services/addressAutocompleteService";
import type { DeliveryEligibilityReason } from "../lib/deliveryEligibility";

type AddressAutocompleteProps = {
  value: string;
  selectedAddress?: AddressSuggestion | null;
  eligibility: DeliveryEligibilityReason;
  eligibleMessage?: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
};

export function AddressAutocomplete({
  value,
  selectedAddress,
  eligibility,
  eligibleMessage,
  onChange,
  onSelect,
}: AddressAutocompleteProps) {
  const listboxId = useId();
  const coordinatorRef = useRef<AddressAutocompleteCoordinator>();
  const [status, setStatus] = useState<AddressSearchStatus>("idle");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  if (!coordinatorRef.current) {
    coordinatorRef.current = new AddressAutocompleteCoordinator();
  }

  useEffect(() => {
    const coordinator = coordinatorRef.current;
    return () => coordinator?.dispose();
  }, []);

  useEffect(() => {
    const coordinator = coordinatorRef.current;
    if (!coordinator) return;
    if (selectedAddress?.label === value) {
      setLoading(false);
      setSuggestions([]);
      setStatus("idle");
      setIsOpen(false);
      return;
    }
    if (!hasEnoughUsefulCharacters(value)) {
      coordinator.dispose();
      setLoading(false);
      setSuggestions([]);
      setStatus("idle");
      setIsOpen(false);
      return;
    }
    coordinator.dispose();

    let cancelled = false;
    const debounce = window.setTimeout(() => {
      setLoading(true);
      void coordinator.search(value).then((result) => {
        if (cancelled || result.status === "stale") return;
        setLoading(false);
        setStatus(result.status);
        setSuggestions(result.suggestions);
        setActiveIndex(result.suggestions.length ? 0 : -1);
        setIsOpen(result.status === "ready");
      });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(debounce);
    };
  }, [selectedAddress?.label, value]);

  function selectSuggestion(suggestion: AddressSuggestion) {
    setSuggestions([]);
    setStatus("idle");
    setIsOpen(false);
    setActiveIndex(-1);
    onSelect(suggestion);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!suggestions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1,
      );
    } else if (event.key === "Enter" && isOpen && activeIndex >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
    }
  }

  const feedback = addressFeedback({
    value,
    selectedAddress,
    eligibility,
    status,
    loading,
    eligibleMessage,
  });
  const activeOptionId =
    isOpen && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <div className="relative min-w-0 text-sm font-medium text-forest">
      <label htmlFor={`${listboxId}-input`}>Adresse</label>
      <div className="relative mt-2">
        <input
          id={`${listboxId}-input`}
          className="input-field w-full min-w-0 pr-20"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          aria-describedby={`${listboxId}-feedback`}
          aria-busy={loading}
          autoComplete="street-address"
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setIsOpen(status === "ready" && suggestions.length > 0)}
          onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
          onKeyDown={handleKeyDown}
        />
        {loading && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-normal text-ink/50">
            Recherche…
          </span>
        )}
      </div>

      {isOpen && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full min-w-0 overflow-y-auto overflow-x-hidden rounded-md border border-forest/15 bg-ivory py-1 shadow-xl"
        >
          {suggestions.map((suggestion, index) => (
            <li
              id={`${listboxId}-option-${index}`}
              key={suggestion.id}
              role="option"
              aria-selected={index === activeIndex}
              className={`cursor-pointer break-words px-3 py-3 text-sm font-normal leading-5 ${
                index === activeIndex ? "bg-cream text-forest" : "text-ink"
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectSuggestion(suggestion)}
            >
              {suggestion.label}
            </li>
          ))}
        </ul>
      )}

      <p
        id={`${listboxId}-feedback`}
        className={`mt-2 text-xs font-normal leading-5 ${feedback.isError ? "text-red-700" : "text-ink/65"}`}
        aria-live="polite"
      >
        {feedback.message}
      </p>
    </div>
  );
}

function addressFeedback(input: {
  value: string;
  selectedAddress?: AddressSuggestion | null;
  eligibility: DeliveryEligibilityReason;
  status: AddressSearchStatus;
  loading: boolean;
  eligibleMessage?: string;
}) {
  if (input.selectedAddress && input.eligibility === "eligible") {
    return {
      message:
        input.eligibleMessage ||
        "Adresse éligible à la livraison locale. Livraison offerte dès 20 € · Délai estimé : environ 1 h.",
      isError: false,
    };
  }
  if (input.selectedAddress && input.eligibility === "outside_radius") {
    return {
      message:
        "Cette adresse se situe hors de notre zone de livraison locale. La livraison postale en France reste disponible.",
      isError: true,
    };
  }
  if (
    input.selectedAddress &&
    (input.eligibility === "missing_address_coordinates" ||
      input.eligibility === "invalid_address_coordinates")
  ) {
    return {
      message:
        "Cette adresse n’a pas pu être vérifiée. Sélectionnez de nouveau une adresse proposée dans la liste.",
      isError: true,
    };
  }
  if (
    input.selectedAddress &&
    (input.eligibility === "invalid_zone_coordinates" ||
      input.eligibility === "no_active_local_zone")
  ) {
    return {
      message:
        "La livraison locale est temporairement indisponible. La livraison postale en France reste disponible.",
      isError: true,
    };
  }
  if (input.loading) return { message: "Recherche de l’adresse…", isError: false };
  if (input.status === "unavailable") {
    return {
      message:
        "La vérification de l’adresse est temporairement indisponible. Réessayez dans quelques instants ou choisissez la livraison postale.",
      isError: true,
    };
  }
  if (input.status === "no_results") {
    return {
      message:
        "Adresse introuvable ou incomplète. Vérifiez le numéro, le nom de la voie et le code postal.",
      isError: true,
    };
  }
  if (hasEnoughUsefulCharacters(input.value)) {
    return {
      message: "Sélectionnez une adresse proposée dans la liste pour pouvoir la vérifier.",
      isError: false,
    };
  }
  return {
    message:
      "Commencez à saisir votre adresse, puis sélectionnez-la dans la liste pour vérifier la livraison locale.",
    isError: false,
  };
}
