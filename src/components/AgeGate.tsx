import { useEffect, useState } from "react";
import { staticImageVariants } from "../lib/generatedImageVariants";
import { ensureBodyScrollUnlocked } from "../lib/bodyScrollLock";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

const key = "verdanza-age-confirmed";

export function AgeGate() {
  const badgeImage = staticImageVariants["/verdanza-badge.png"];
  const [isConfirmed, setIsConfirmed] = useState(() => {
    return localStorage.getItem(key) === "true";
  });

  useEffect(() => {
    if (isConfirmed) {
      localStorage.setItem(key, "true");
      ensureBodyScrollUnlocked();
      window.dispatchEvent(new Event("verdanza:age-confirmed"));
    }
  }, [isConfirmed]);

  useBodyScrollLock(!isConfirmed);

  if (isConfirmed) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-forest/95 px-4 py-6 text-ivory">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="age-gate-title"
        className="w-full max-w-xl rounded-lg border border-champagne/40 bg-ivory p-8 text-forest shadow-soft"
      >
        <img
          src={badgeImage?.src || "/verdanza-badge.png"}
          srcSet={badgeImage?.srcSet}
          sizes={badgeImage?.sizes || "112px"}
          alt="Verdanza CBD"
          width={badgeImage?.width || 112}
          height={badgeImage?.height || 112}
          fetchPriority="high"
          decoding="async"
          className="mx-auto mb-6 h-28 w-28 object-contain"
        />
        <h2 id="age-gate-title" className="font-display text-4xl">
          Accès réservé aux majeurs
        </h2>
        <p className="mt-4 text-sm leading-6 text-forest/75">
          Les produits présentés sur Verdanza sont réservés aux personnes
          majeures. Ils contiennent un taux de THC conforme, inférieur à 0,3 %,
          ne remplacent pas un traitement médical et doivent être tenus hors de
          portée des enfants.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button className="btn-primary flex-1" onClick={() => setIsConfirmed(true)}>
            J'ai 18 ans ou plus
          </button>
          <a className="btn-secondary flex-1 text-center" href="https://www.google.fr">
            Quitter
          </a>
        </div>
      </div>
    </div>
  );
}
