import type { DeliveryZone } from "../types";

export const deliveryZones: DeliveryZone[] = [
  {
    id: "postal-france",
    name: "Livraison postale",
    method: "postal",
    isActive: true,
    fee: 5.9,
    minimumOrder: 0,
    estimatedDelay: "48 h a 72 h apres preparation",
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
    fee: index < 4 ? 4.9 : 6.9,
    minimumOrder: 35,
    estimatedDelay: index < 4 ? "60 a 120 min" : "Selon creneau disponible",
    slots: ["12:00-14:00", "18:00-21:00"],
  })),
];

export const localDeliveryZones = deliveryZones.filter(
  (zone) => zone.method === "local_express",
);
