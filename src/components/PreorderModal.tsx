import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getPreorderCountdown, isPreorderActive } from "../lib/preorder";

const storageKey = "verdanza-preorder-modal-dismissed";

export function PreorderModal() {
  const [now, setNow] = useState(() => new Date());
  const [isDismissed, setIsDismissed] = useState(() => {
    return window.localStorage.getItem(storageKey) === "true";
  });
  const active = isPreorderActive(now);
  const countdown = useMemo(() => getPreorderCountdown(now), [now]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!active || isDismissed) return null;

  function dismiss() {
    window.localStorage.setItem(storageKey, "true");
    setIsDismissed(true);
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-forest/70 px-4 py-8 backdrop-blur-sm">
      <section className="max-w-2xl rounded-lg border border-champagne/40 bg-ivory p-6 text-forest shadow-soft md:p-8">
        <p className="text-xs uppercase tracking-[0.24em] text-champagne">
          Précommande
        </p>
        <h2 className="mt-3 font-display text-4xl leading-tight">
          Ouverture Verdanza bientôt disponible
        </h2>
        <p className="mt-4 leading-7 text-ink/75">
          Verdanza ouvre officiellement le jeudi 16 juillet. Les précommandes
          sont déjà possibles : validez votre panier, nous vous recontactons
          pour confirmer les disponibilités, la livraison et le règlement.
        </p>
        <div className="mt-5 rounded-md border border-forest/10 bg-cream p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-forest/60">
            Ouverture dans
          </p>
          <p className="mt-2 font-display text-3xl">
            {countdown.days} j {countdown.hours} h {countdown.minutes} min
          </p>
        </div>
        <p className="mt-4 text-sm leading-6 text-ink/65">
          Livraison locale Aix-en-Provence et alentours, et livraison postale en
          France selon disponibilité.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Link to="/boutique" className="btn-primary justify-center" onClick={dismiss}>
            Précommander
          </Link>
          <Link to="/boutique" className="btn-secondary justify-center" onClick={dismiss}>
            Voir la boutique
          </Link>
          <button className="btn-secondary justify-center" onClick={dismiss}>
            Fermer
          </button>
        </div>
      </section>
    </div>
  );
}
