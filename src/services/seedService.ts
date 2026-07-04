import { seedInitialDeliveryZones } from "./deliveryZonesService";
import { seedInitialProducts } from "./productsService";
import { auth } from "../lib/firebase";

export async function runManualInitialSeed() {
  const token = await auth?.currentUser?.getIdToken();
  if (token) {
    const response = await fetch("/api/seed-launch-data", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    const payload = (await response.json().catch(() => ({}))) as {
      products?: Awaited<ReturnType<typeof seedInitialProducts>>;
      deliveryZones?: { upserted: number };
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error || "Seed serveur impossible.");
    }
    return {
      products: payload.products ?? { upserted: 0, deactivated: 0 },
      deliveryZones: payload.deliveryZones?.upserted ?? 0,
    };
  }

  const [products, deliveryZones] = await Promise.all([
    seedInitialProducts(),
    seedInitialDeliveryZones(),
  ]);

  return { products, deliveryZones };
}
