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
            : "Livraison hors zone - Verdanza"
        }
        description="Livraison Verdanza : express locale a Aix-en-Provence et alentours, 7j/7 de 11h a 01h."
      />
      <div className="page-intro">
        <h1>{isLocal ? "Livraison express Aix" : "Livraison hors zone"}</h1>
        <p>
          {isLocal
            ? "Livraison express Aix-en-Provence et alentours, 7j/7 de 11h a 01h, a partir de 30 EUR d'achat."
            : "La livraison hors zone n'est pas ouverte au lancement local. Contactez Verdanza avant toute demande hors zone."}
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
            Pour l'ouverture client controlee, Verdanza concentre la livraison
            sur Aix-en-Provence et alentours. Les demandes hors zone doivent etre
            confirmees avant commande.
          </p>
        </section>
      )}
    </main>
  );
}
