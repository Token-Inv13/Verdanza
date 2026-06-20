import { useEffect, useState } from "react";

const key = "verdanza-age-confirmed";

export function AgeGate() {
  const [isConfirmed, setIsConfirmed] = useState(() => {
    return localStorage.getItem(key) === "true";
  });

  useEffect(() => {
    if (isConfirmed) localStorage.setItem(key, "true");
  }, [isConfirmed]);

  if (isConfirmed) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-forest/95 px-4 text-ivory">
      <div className="max-w-xl rounded-lg border border-champagne/40 bg-ivory p-8 text-forest shadow-soft">
        <img
          src="/verdanza-badge.png"
          alt="Verdanza CBD"
          className="mx-auto mb-6 h-28 w-28 object-contain"
        />
        <h2 className="font-display text-4xl">Acces reserve aux majeurs</h2>
        <p className="mt-4 text-sm leading-6 text-forest/75">
          Les produits presentes sur Verdanza sont reserves aux personnes
          majeures. Ils contiennent un taux de THC conforme, inferieur a 0,3 %,
          ne remplacent pas un traitement medical et doivent etre tenus hors de
          portee des enfants.
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
