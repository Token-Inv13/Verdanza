import { useEffect, useState } from "react";
import { CookiePreferencesDialog } from "./CookiePreferencesDialog";
import { useConsent } from "../context/ConsentContext";

const ageGateKey = "verdanza-age-confirmed";

export function CookieConsentBanner() {
  const consent = useConsent();
  const [ageConfirmed, setAgeConfirmed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(ageGateKey) === "true";
  });

  useEffect(() => {
    function refreshAgeState() {
      setAgeConfirmed(window.localStorage.getItem(ageGateKey) === "true");
    }
    window.addEventListener("storage", refreshAgeState);
    window.addEventListener("verdanza:age-confirmed", refreshAgeState);
    return () => {
      window.removeEventListener("storage", refreshAgeState);
      window.removeEventListener("verdanza:age-confirmed", refreshAgeState);
    };
  }, []);

  const showBanner = ageConfirmed && !consent.hasDecision && !consent.preferencesOpen;

  return (
    <>
      {showBanner && (
        <section
          className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-50 max-h-[min(70dvh,36rem)] overflow-y-auto overscroll-contain rounded-xl border border-forest/15 bg-ivory p-3 shadow-soft sm:inset-x-4 sm:p-4 lg:inset-x-0 lg:bottom-0 lg:max-h-none lg:rounded-none lg:border-x-0 lg:border-b-0 lg:px-4 lg:py-4"
          aria-label="Gestion des cookies"
          data-testid="cookie-consent-banner"
        >
          <div className="mx-auto grid w-full max-w-7xl min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-6">
            <div className="min-w-0 max-w-3xl">
              <h2 className="font-display text-xl leading-tight text-forest sm:text-2xl">Cookies et mesure d'audience</h2>
              <p className="mt-1 text-[0.8125rem] leading-5 text-ink/70 sm:mt-2 sm:text-sm sm:leading-6">
                Les cookies essentiels sont toujours actifs. La mesure d'audience
                Google Analytics et Google Tag Manager reste désactivée tant que
                vous ne l'acceptez pas.
              </p>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-2 min-[350px]:grid-cols-2 lg:min-w-[440px] lg:grid-cols-3">
              <button className="btn-primary w-full min-w-0 justify-center px-3 py-2.5 text-xs sm:text-sm" type="button" onClick={consent.acceptAll}>
                Tout accepter
              </button>
              <button className="btn-secondary w-full min-w-0 justify-center px-3 py-2.5 text-xs sm:text-sm" type="button" onClick={consent.rejectAll}>
                Tout refuser
              </button>
              <button
                className="btn-secondary w-full min-w-0 justify-center px-3 py-2.5 text-xs min-[350px]:col-span-2 sm:text-sm lg:col-span-1"
                type="button"
                onClick={consent.openPreferences}
              >
                Personnaliser
              </button>
            </div>
          </div>
        </section>
      )}
      <CookiePreferencesDialog />
    </>
  );
}
