import {
  getLocalProducts,
  getProductsWithFallback as loadPublicCatalog,
} from "../../src/services/productsService";
import type { PublicProductCatalogResult } from "../../src/services/productsService";

export * from "../../src/services/productsService";

export type PublicAuditCatalogMode = "authoritative" | "empty" | "error" | "pending" | "blocked";
declare global {
  interface Window {
    __VERDANZA_AUDIT_CATALOG_MODE__?: PublicAuditCatalogMode;
    __VERDANZA_AUDIT_CATALOG_RESULT__?: PublicProductCatalogResult;
  }
}

// Test data only: seven editorial references and synthetic stock, no live catalogue.
const fixtureProducts = getLocalProducts().map((product) => ({
  ...product,
  stock: product.id === "resin-supreme-50-cbd" ? 0 : 8,
}));

export async function getProductsWithFallback(): Promise<PublicProductCatalogResult> {
  if (window.__VERDANZA_AUDIT_CATALOG_MODE__ === "blocked") {
    const result = await loadPublicCatalog();
    window.__VERDANZA_AUDIT_CATALOG_RESULT__ = result;
    return result;
  }
  const result = await loadPublicCatalog(async () => {
    switch (window.__VERDANZA_AUDIT_CATALOG_MODE__ || "authoritative") {
      case "empty": return [];
      case "error": throw Object.assign(new Error("Synthetic Firestore outage"), { code: "unavailable" });
      case "pending": return new Promise<never>(() => {});
      case "authoritative": return fixtureProducts;
      case "blocked": throw new Error("Unreachable fixture branch");
    }
  });
  window.__VERDANZA_AUDIT_CATALOG_RESULT__ = result;
  return result;
}
