export function publicDeliveryLabel(input: {
  deliveryMethod?: string | null;
  deliveryZone?: string | null;
}) {
  const zone = input.deliveryZone?.trim();
  if (zone && zone !== "local_express" && zone !== "postal") return zone;
  const method = input.deliveryMethod || zone;
  if (method === "local_express") return "Express local";
  if (method === "postal") return "Livraison postale";
  return "Mode de livraison à confirmer";
}
