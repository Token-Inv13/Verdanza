import { seedInitialDeliveryZones } from "./deliveryZonesService";
import { seedInitialProducts } from "./productsService";

export async function runManualInitialSeed() {
  const [products, deliveryZones] = await Promise.all([
    seedInitialProducts(),
    seedInitialDeliveryZones(),
  ]);

  return { products, deliveryZones };
}
