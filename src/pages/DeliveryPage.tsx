import { localDeliveryZones } from "../data/deliveryZones";
import { Seo } from "../components/Seo";

export function DeliveryPage({ mode }: { mode: "local" | "postal" }) {
  const isLocal = mode === "local";
  return (
    <main className="container-page py-12">
      <Seo
        title={
          isLocal
            ? "Livraison CBD express Aix-en-Provence - Verdanza"
            : "Livraison postale CBD - Verdanza"
        }
        description="Modes de livraison Verdanza : express locale a Aix-en-Provence et livraison postale suivie."
      />
      <div className="page-intro">
        <h1>{isLocal ? "Livraison express Aix" : "Livraison postale"}</h1>
        <p>
          {isLocal
            ? "La livraison locale est preparee pour Aix-en-Provence et les communes proches, avec zones activables dans l'admin."
            : "La livraison postale est prevue pour les commandes hors zone locale, avec suivi et preparation discrete."}
        </p>
      </div>
      {isLocal ? (
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {localDeliveryZones.map((zone) => (
            <article key={zone.id} className="feature-panel">
              <h2>{zone.name}</h2>
              <p>
                Minimum {zone.minimumOrder} EUR - frais{" "}
                {zone.fee.toFixed(2).replace(".", ",")} EUR
              </p>
              <p>Delai estime : {zone.estimatedDelay}</p>
            </article>
          ))}
        </div>
      ) : (
        <section className="mt-10 rounded-lg border border-forest/10 bg-cream p-8">
          <h2 className="font-display text-3xl text-forest">Expedition suivie</h2>
          <p className="mt-4 max-w-3xl leading-7 text-ink/70">
            Frais indicatif : 5,90 EUR. Livraison offerte et transporteurs a
            parametrer selon la strategie commerciale finale.
          </p>
        </section>
      )}
    </main>
  );
}
