import { useState } from "react";
import type { StockSnapshot } from "../../src/types/adminStock";
import type { Product, ProductImageAsset } from "../../src/types";
import type { ProductInput } from "../../src/services/productsService";

const imageUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Crect width='20' height='20' fill='green'/%3E%3C/svg%3E";
export const fixtureProduct: Product = {
  id: "admin-v3-fixture", internalReference: "VDZ-RES-ABCDEF", slug: "fiche-test",
  name: "Produit témoin", category: "resins", price: 6, compareAtPrice: 7,
  fixedPriceMode: "manual", fixedPriceOptions: [
    { id: "format-test", label: "Format témoin", quantityGrams: 4, totalPrice: 22, isActive: true, source: "manual", sortOrder: 0 },
  ],
  shortDescription: "Description témoin", longDescription: "Description longue témoin",
  image: imageUrl, imageAlt: "Image témoin",
  images: [{ id: "one", url: imageUrl, alt: "Image témoin", storagePath: "products/admin-v3-fixture/one.webp", sortOrder: 0, isPrimary: true }],
  cbdRate: "50 %", cbgRate: "1 %", thcRate: "< 0,3 %", origin: "France", cultureType: "Autre",
  aromas: ["Terre"], tags: ["Témoin"], stock: 20, lowStockThreshold: 2,
  isActive: false, isFeatured: true, qualitySealEnabled: true,
  seoTitle: "Titre témoin", seoDescription: "SEO témoin",
};

export const fixture = {
  saved: [] as ProductInput[], deleted: [] as Array<{ productId: string; confirmationReference: string }>,
  removed: [] as string[], uploads: 0, confirmations: 0, refreshes: 0,
  flags: [] as unknown[], stocks: [] as unknown[],
  blocked: "", failure: "", refreshFailure: false, release: () => {},
};

async function operation(kind: string) {
  if (fixture.blocked === kind) await new Promise<void>((resolve) => { fixture.release = resolve; });
  if (fixture.failure) throw new Error(fixture.failure);
}

export async function upsertProduct(product: ProductInput) {
  fixture.saved.push(structuredClone(product));
  await operation("save");
  return product.id || product.slug;
}
export async function deleteProductAdmin(input: { productId: string; confirmationReference: string }) {
  fixture.deleted.push(input);
  await operation("delete");
  return { storage: { failed: [] } };
}
export async function updateProductFlags(...args: unknown[]) { fixture.flags.push(args); }
export async function updateProductStock(...args: unknown[]) { fixture.stocks.push(args); }
export async function deleteProductImageByPath(path: string) { fixture.removed.push(path); }
export async function uploadProductImageAsset({ productId, sortOrder, isPrimary, alt, onProgress }: {
  productId: string; sortOrder: number; isPrimary: boolean; alt: string;
  onProgress: (progress: { fileName: string; progress: number; status: string }) => void;
}): Promise<ProductImageAsset> {
  fixture.uploads += 1;
  onProgress({ fileName: "fixture.webp", progress: 10, status: "uploading" });
  await operation("upload");
  return { id: `upload-${fixture.uploads}`, url: imageUrl, alt, sortOrder, isPrimary, storagePath: `products/${productId}/upload-${fixture.uploads}.webp` };
}

const noReference = { ...fixtureProduct, id: "without-reference", name: "Sans référence", internalReference: undefined };
const billingSettings = {};
export function useAdminData() {
  const [products, setProducts] = useState([fixtureProduct, noReference]);
  return {
    products,
    applyStockSnapshot: (snapshot: StockSnapshot) => setProducts((current) => current.map((product) => product.id === snapshot.productId ? { ...product, stock: snapshot.stock, lowStockThreshold: snapshot.lowStockThreshold } : product)), productSource: "firestore",
    orders: [], orderSource: "empty", deliveryZones: [], deliverySource: "local",
    coupons: [], couponSource: "empty", promoBanners: [], promoBannerSource: "empty",
    customers: [], customerSource: "empty", invoices: [], invoiceSource: "empty",
    billingSettings, billingSource: "local", productCosts: [], productCostsSource: "empty", productCostsError: "",
    supplierPurchases: [], supplierPurchasesSource: "empty", supplierPurchasesError: "", isLoading: false,
    refresh: async () => {
      fixture.refreshes += 1;
      if (fixture.refreshFailure) throw new Error("Actualisation refusée");
    }, refreshOrder: async () => {},
  };
}
export function useAuth() { return { user: { uid: "fixture-admin" }, adminUser: { email: "fixture@example.test" }, signOut: async () => {} }; }
// No Firebase app, credentials, or remote adapters enter the fixture.
export const app = null;
export const db = null;
export const isFirebaseConfigured = false;
export const firebaseConfig = {};
export async function getFirebaseStorage(): Promise<never> { throw new Error("Unexpected Firebase Storage access"); }
export async function getFirebaseAnalytics(): Promise<never> { throw new Error("Unexpected Firebase Analytics access"); }

export async function confirmFixture() {
  fixture.confirmations += 1;
  await operation("confirm");
}

export async function getFirebaseIdToken() { return "fixture-admin-token"; }
export async function getCurrentFirebaseUser() { return { uid: "fixture-admin", getIdToken: getFirebaseIdToken }; }
export async function loadFirebaseAuthApi(): Promise<never> { throw new Error("Unexpected fixture Auth access"); }
