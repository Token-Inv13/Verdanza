import type { PromoBanner } from "../../src/types";

// Public payload observed in Phase 6B. Used only by local, network-isolated QA.
export const expressDeliveryBannerFixture: PromoBanner = {
  id: "livraison-express-a-aix-en-provence-1786182455265",
  title: "📍 Livraison express à Aix-en-Provence",
  message: "Livraison offerte 🎁 · environ 1 h ⏱️ · de 11 h à 1 h du matin · jusqu’à 15 km autour du centre-ville.",
  type: "shop_card",
  placement: "home",
  placements: ["home", "shop", "flowers", "resins"],
  isActive: true,
  priority: 50,
  variant: "info",
  dismissible: false,
  isArchived: false,
};
