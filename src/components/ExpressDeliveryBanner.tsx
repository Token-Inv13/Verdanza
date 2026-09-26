import { ArrowUpRight, Clock3, MapPin, Truck, X } from "lucide-react";
import { Link } from "react-router-dom";
import type { ExpressDeliverySummary } from "../lib/expressDeliveryBanner";
import type { PromoBanner } from "../types";

export function ExpressDeliveryBanner({ banner, summary, onConditionsClick, onDismiss }: {
  banner: PromoBanner;
  summary: ExpressDeliverySummary;
  onConditionsClick: () => void;
  onDismiss: (banner: PromoBanner) => void;
}) {
  return (
    <aside className="express-delivery-banner" data-express-delivery-banner aria-label="Livraison express locale">
      <div className="express-delivery-banner__heading">
        <MapPin aria-hidden="true" className="express-delivery-banner__pin" />
        <div>
          <p className="express-delivery-banner__eyebrow">Livraison locale</p>
          <h2 className="express-delivery-banner__title">Express à Aix-en-Provence</h2>
        </div>
      </div>
      <ul className="express-delivery-banner__details" aria-label="Informations de livraison">
        <li aria-label={`Délai indicatif : environ ${summary.delay} h`}>
          <Truck aria-hidden="true" /> <span>≈ {summary.delay} h</span>
        </li>
        <li aria-label={`Horaires : de ${summary.opensAt} h à ${summary.closesAt} h du matin`}>
          <Clock3 aria-hidden="true" /> <span>{summary.opensAt} h → {summary.closesAt} h</span>
        </li>
        <li aria-label={`Zone : jusqu’à ${summary.radius} km autour du centre-ville`}>
          <MapPin aria-hidden="true" /> <span>jusqu’à {summary.radius} km</span>
        </li>
      </ul>
      <Link
        className="express-delivery-banner__link"
        to="/livraison-locale"
        onClick={onConditionsClick}
      >
        Voir la zone et les conditions <ArrowUpRight aria-hidden="true" />
      </Link>
      {banner.dismissible && (
        <button type="button" className="express-delivery-banner__dismiss"
          aria-label="Fermer cette bannière" onClick={() => onDismiss(banner)}>
          <X aria-hidden="true" />
        </button>
      )}
    </aside>
  );
}
