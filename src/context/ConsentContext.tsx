import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  buildConsentState,
  readStoredConsent,
  removeAnalyticsCookies,
  storeConsent,
  type ConsentState,
} from "../lib/consent";
import {
  initializeGoogleConsentMode,
  loadGoogleTagManager,
  updateAnalyticsConsent,
} from "../lib/googleTagManager";
import { setAnalyticsConsentAllowed } from "../lib/analytics";

type ConsentContextValue = {
  consent: ConsentState | null;
  hasDecision: boolean;
  analyticsAllowed: boolean;
  preferencesOpen: boolean;
  openPreferences: () => void;
  closePreferences: () => void;
  acceptAll: () => void;
  rejectAll: () => void;
  saveAnalyticsPreference: (analytics: boolean) => void;
};

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<ConsentState | null>(() => readStoredConsent());
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  useEffect(() => {
    initializeGoogleConsentMode();
    const stored = readStoredConsent();
    if (stored?.analytics) {
      setAnalyticsConsentAllowed(true);
      updateAnalyticsConsent(true);
      loadGoogleTagManager();
    } else {
      setAnalyticsConsentAllowed(false);
      updateAnalyticsConsent(false);
    }
  }, []);

  const persistConsent = useCallback((analytics: boolean) => {
    const nextConsent = buildConsentState(analytics);
    storeConsent(nextConsent);
    setConsent(nextConsent);
    setAnalyticsConsentAllowed(analytics);
    updateAnalyticsConsent(analytics);
    if (analytics) {
      loadGoogleTagManager();
    } else {
      removeAnalyticsCookies();
    }
  }, []);

  const value = useMemo<ConsentContextValue>(
    () => ({
      consent,
      hasDecision: Boolean(consent),
      analyticsAllowed: Boolean(consent?.analytics),
      preferencesOpen,
      openPreferences: () => setPreferencesOpen(true),
      closePreferences: () => setPreferencesOpen(false),
      acceptAll: () => {
        persistConsent(true);
        setPreferencesOpen(false);
      },
      rejectAll: () => {
        persistConsent(false);
        setPreferencesOpen(false);
      },
      saveAnalyticsPreference: (analytics) => {
        persistConsent(analytics);
        setPreferencesOpen(false);
      },
    }),
    [consent, persistConsent, preferencesOpen],
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConsent() {
  const context = useContext(ConsentContext);
  if (!context) throw new Error("useConsent must be used inside ConsentProvider");
  return context;
}
