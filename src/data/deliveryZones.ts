import type { DeliveryZone } from "../types/index.js";

export const deliveryZones: DeliveryZone[] = [
  {
    id: "postal-france",
    name: "Livraison postale en France",
    method: "postal",
    isActive: true,
    fee: 0,
    minimumOrder: 0,
    estimatedDelay: "Expedition suivie en France",
    slots: ["Expedition suivie"],
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
    fee: 0,
    minimumOrder: 30,
    estimatedDelay: "Livraison express 7j/7 de 11h00 a 01h00",
    slots: ["11:00-14:00", "14:00-18:00", "18:00-22:00", "22:00-01:00"],
  })),
];

export const localDeliveryZones = deliveryZones.filter(
  (zone) => zone.method === "local_express",
);
