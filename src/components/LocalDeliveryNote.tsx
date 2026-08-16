import { MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { trackCtaClick } from "../lib/analytics";
import type { ProductCategory } from "../types";

function productWording(category: ProductCategory) {
  if (category === "flowers") return "Cette fleur CBD";
  if (category === "resins") return "Cette résine CBD";
  return "Ce produit CBD";
}

export function LocalDeliveryNote({ category }: { category: ProductCategory }) {
  return (
    <aside
      className="mt-7 rounded-md border border-champagne/30 bg-cream p-5"
      aria-labelledby="product-local-delivery-title"
    >
      <div className="flex items-start gap-3">
        <MapPin className="mt-0.5 size-5 shrink-0 text-champagne" aria-hidden="true" />
        <div>
          <h2 id="product-local-delivery-title" className="font-display text-2xl text-forest">
            Livraison locale autour d’Aix-en-Provence
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink/70">
            {productWording(category)} peut être commandé avec le service local, selon
            l’éligibilité de votre adresse et les créneaux disponibles.
          </p>
          <Link
            to="/livraison-locale"
            className="mt-3 inline-flex text-sm font-semibold text-forest underline decoration-champagne/70 underline-offset-4"
            onClick={() =>
              trackCtaClick({
                ctaId: "product_local_delivery_conditions",
                ctaLocation: "product_delivery_note",
                destinationPath: "/livraison-locale",
                ctaCategory: "delivery",
              })
            }
          >
            Vérifier la zone et les conditions de livraison
          </Link>
        </div>
      </div>
    </aside>
  );
}
