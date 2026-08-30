import { useEffect, useState } from "react";
import { BrandLogo } from "./BrandLogo";
import { ensureBodyScrollUnlocked } from "../lib/bodyScrollLock";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import {
  AGE_GATE_CONFIRMED_EVENT,
  AGE_GATE_STORAGE_KEY,
  isAgeConfirmedLocally,
} from "../lib/ageGate";

export function AgeGate() {
  const [isConfirmed, setIsConfirmed] = useState(() => {
    return isAgeConfirmedLocally();
  });

  useEffect(() => {
    if (isConfirmed) {
      localStorage.setItem(AGE_GATE_STORAGE_KEY, "true");
      ensureBodyScrollUnlocked();
      window.dispatchEvent(new Event(AGE_GATE_CONFIRMED_EVENT));
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
        <BrandLogo
          variant="seal"
          className="mx-auto mb-6 h-28 w-28 object-contain"
        />
        <h2
          id="age-gate-title"
          className="text-4xl font-semibold leading-tight"
          style={{ fontFamily: "Georgia, serif" }}
        >
          Verdanza — accès réservé aux majeurs
        </h2>
        <p className="mt-4 text-sm leading-6 text-forest/75">
          Verdanza est une boutique en ligne de fleurs et résines CBD réservée
          aux personnes majeures. Les produits présentés contiennent un taux de
          THC conforme, inférieur à 0,3 %, ne remplacent pas un traitement
          médical et doivent être tenus hors de portée des enfants.
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
