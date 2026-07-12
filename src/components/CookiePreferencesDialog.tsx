import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useConsent } from "../context/ConsentContext";

export function CookiePreferencesDialog() {
  const consent = useConsent();
  const titleId = useId();
  const firstButtonRef = useRef<HTMLButtonElement>(null);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    if (!consent.preferencesOpen) return;
    setAnalytics(consent.analyticsAllowed);
    window.setTimeout(() => firstButtonRef.current?.focus(), 0);
  }, [consent.analyticsAllowed, consent.preferencesOpen]);

  if (!consent.preferencesOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-forest/80 px-4 py-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-2xl rounded-lg border border-champagne/30 bg-ivory p-6 text-ink shadow-soft"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="font-display text-3xl text-forest">
              Préférences cookies
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink/70">
              Vous pouvez accepter, refuser ou modifier la mesure d'audience à
              tout moment. Les cookies publicitaires restent refusés dans cette phase.
            </p>
          </div>
          <button
            ref={firstButtonRef}
            className="icon-button"
            type="button"
            aria-label="Fermer les préférences cookies"
            onClick={consent.closePreferences}
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-6 grid gap-4">
          <article className="rounded-lg border border-forest/10 bg-cream p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-2xl text-forest">Cookies essentiels</h3>
                <p className="mt-2 text-sm leading-6 text-ink/70">
                  Toujours actifs. Ils sont nécessaires au panier, au compte, à la
                  sécurité, au choix d'âge et au choix de consentement.
                </p>
              </div>
              <span className="rounded-full bg-forest px-3 py-1 text-xs font-semibold text-ivory">
                Toujours actif
              </span>
            </div>
          </article>

          <article className="rounded-lg border border-forest/10 bg-cream p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-display text-2xl text-forest">Mesure d'audience</h3>
                <p className="mt-2 text-sm leading-6 text-ink/70">
                  Désactivée par défaut. Elle sert à comprendre les pages
                  consultées, les produits vus et le parcours de commande avec
                  Google Analytics et Google Tag Manager, sans envoyer vos
                  coordonnées.
                </p>
              </div>
              <label className="inline-flex min-w-44 items-center justify-between gap-3 rounded-full border border-forest/10 bg-ivory px-4 py-2 text-sm font-semibold text-forest">
                <span>{analytics ? "Activée" : "Désactivée"}</span>
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-forest"
                  checked={analytics}
                  onChange={(event) => setAnalytics(event.target.checked)}
                />
              </label>
            </div>
          </article>
        </div>

        <div className="mt-6 grid gap-2 sm:grid-cols-3">
          <button className="btn-primary justify-center" type="button" onClick={consent.acceptAll}>
            Tout accepter
          </button>
          <button className="btn-secondary justify-center" type="button" onClick={consent.rejectAll}>
            Tout refuser
          </button>
          <button
            className="btn-secondary justify-center"
            type="button"
            onClick={() => consent.saveAnalyticsPreference(analytics)}
          >
            Enregistrer
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
