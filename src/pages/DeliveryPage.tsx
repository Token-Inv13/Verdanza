import { localDeliveryZones } from "../data/deliveryZones";
import { Seo } from "../components/Seo";
import {
  LOCAL_DELIVERY_MINIMUM,
  POSTAL_DELIVERY_MINIMUM,
  POSTAL_FREE_SHIPPING_THRESHOLD,
} from "../config/deliveryRules";

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
            ? "Livraison locale Aix-en-Provence et alentours, 7j/7 de 11h à 01h, à partir de 20 € d'achat."
            : "Livraison postale disponible en France à partir de 15 € d'achat. Livraison postale offerte à partir de 60 €."}
        </p>
      </div>
      {isLocal ? (
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {localDeliveryZones.map((zone) => (
            <article key={zone.id} className="feature-panel">
              <h2>{zone.name}</h2>
              <p>
                Minimum {LOCAL_DELIVERY_MINIMUM} EUR - frais{" "}
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
            Livraison postale disponible en France à partir de{" "}
            {POSTAL_DELIVERY_MINIMUM} € d'achat. Elle est offerte à partir de{" "}
            {POSTAL_FREE_SHIPPING_THRESHOLD} €. En dessous de 60 €, les frais
            postaux sont confirmés avec vous après validation de la commande.
          </p>
        </section>
      )}
    </main>
  );
}
