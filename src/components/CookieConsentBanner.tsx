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
          className="fixed bottom-0 left-0 right-0 z-50 border-t border-forest/10 bg-ivory px-4 py-4 shadow-soft"
          aria-label="Gestion des cookies"
        >
          <div className="container-page flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <h2 className="font-display text-2xl text-forest">Cookies et mesure d'audience</h2>
              <p className="mt-2 text-sm leading-6 text-ink/70">
                Les cookies essentiels sont toujours actifs. La mesure d'audience
                Google Analytics et Google Tag Manager reste désactivée tant que
                vous ne l'acceptez pas.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[440px]">
              <button className="btn-primary justify-center" type="button" onClick={consent.acceptAll}>
                Tout accepter
              </button>
              <button className="btn-secondary justify-center" type="button" onClick={consent.rejectAll}>
                Tout refuser
              </button>
              <button
                className="btn-secondary justify-center"
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
