import type { DeliveryZone } from "../types/index.js";
import {
  DEFAULT_LOCAL_DELIVERY_ESTIMATE_MAX_MINUTES,
  DEFAULT_LOCAL_DELIVERY_ESTIMATE_MIN_MINUTES,
  LOCAL_DELIVERY_MINIMUM,
  POSTAL_DELIVERY_MINIMUM,
} from "../config/deliveryRules.js";

export const deliveryZones: DeliveryZone[] = [
  {
    id: "postal-france",
    name: "Livraison postale en France",
    method: "postal",
    isActive: true,
    isOpen: true,
    status: "open",
    fee: 0,
    minimumOrder: POSTAL_DELIVERY_MINIMUM,
    minimumOrderAmount: POSTAL_DELIVERY_MINIMUM,
    estimatedDelay: "Expédition suivie en France",
    slots: ["Expédition suivie"],
    customerMessage:
      "Livraison postale en France à partir de 15 EUR. Livraison offerte à partir de 60 EUR.",
    sortOrder: 0,
  },
  ...[
    "Aix-en-Provence centre",
    "Les Milles",
    "Puyricard",
    "Luynes",
    "Venelles",
    "Eguilles",
    "Bouc-Bel-Air",
    "Gardanne",
    "Meyreuil",
    "Le Tholonet",
  ].map<DeliveryZone>((name, index) => ({
    id: `local-${index + 1}`,
    name,
    method: "local_express",
    isActive: true,
    isOpen: true,
    status: "open",
    fee: 0,
    minimumOrder: LOCAL_DELIVERY_MINIMUM,
    minimumOrderAmount: LOCAL_DELIVERY_MINIMUM,
    estimatedDelay: "Créneau local confirmé après validation",
    estimatedDelayMinMinutes: DEFAULT_LOCAL_DELIVERY_ESTIMATE_MIN_MINUTES,
    estimatedDelayMaxMinutes: DEFAULT_LOCAL_DELIVERY_ESTIMATE_MAX_MINUTES,
    slots: ["11:00-14:00", "14:00-18:00", "18:00-22:00", "22:00-01:00"],
    customerMessage: "Livraison locale selon disponibilité du créneau.",
    sortOrder: index + 1,
  })),
];

export const localDeliveryZones = deliveryZones.filter(
  (zone) => zone.method === "local_express",
);
