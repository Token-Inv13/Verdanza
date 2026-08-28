import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../api/_server/firebaseAdmin.js";
import { validateTieredProductGift } from "../src/lib/tieredProductGifts.js";
import type { Coupon, PromoBanner, Product } from "../src/types/index.js";

const campaignId = "weekend-aout-2026";
const confirmation = "weekend-aout-2026";
const giftProductIds = [
  "flower-blue-dream-cbd",
  "flower-mandarine-cbd",
  "flower-harlequin-greenhouse",
];
const apply = process.argv.includes("--apply");
const confirmed = process.argv.includes(`--confirm=${confirmation}`);
const db = getAdminDb();

const productSnapshots = await Promise.all(
  giftProductIds.map((productId) => db.collection("products").doc(productId).get()),
);
const products = productSnapshots.map((snapshot) => ({
  id: snapshot.id,
  exists: snapshot.exists,
  ...(snapshot.data() || {}),
})) as Array<Product & { exists: boolean }>;
for (const product of products) {
  if (!product.exists) throw new Error(`Produit cadeau introuvable : ${product.id}`);
  if (!product.isActive) throw new Error(`Produit cadeau inactif : ${product.id}`);
  if (Number(product.stock || 0) < 1) throw new Error(`Stock cadeau insuffisant : ${product.id}`);
}

const nowIso = new Date().toISOString();
const campaign: Omit<Coupon, "id" | "usedCount"> = {
  code: "WEEKENDAOUT2026",
  label: "Dernier week-end d’août — fleurs offertes",
  discountType: "fixed",
  discountValue: 0,
  minimumOrder: 0,
  autoApply: true,
  promotionType: "tiered_product_gift",
  stackable: false,
  priority: 5,
  startsAt: nowIso,
  endsAt: "2026-08-30T21:59:59.000Z",
  isActive: true,
  isArchived: false,
  giftSelectionMode: "customer_choice",
  defaultGiftProductId: "flower-blue-dream-cbd",
  giftProductIds,
  giftTiers: [
    { id: "tier-30", minimumSubtotal: 30, quantityGrams: 1 },
    { id: "tier-50", minimumSubtotal: 50, quantityGrams: 2 },
    { id: "tier-70", minimumSubtotal: 70, quantityGrams: 3 },
  ],
  qualifyingScope: "cart_subtotal",
  qualifyingCategories: [],
  qualifyingProductIds: [],
  productIds: [],
  categories: [],
  internalNote: "Campagne du dernier week-end d’août 2026. Cadeau d’une seule fleur, sans mélange.",
};
const issues = validateTieredProductGift(campaign);
if (issues.length) throw new Error(issues.join(" "));

const banner: Omit<PromoBanner, "id"> = {
  title: "JUSQU’À 3 G OFFERTS CE WEEK-END",
  message: "1 g dès 30 € · 2 g dès 50 € · 3 g dès 70 €. Blue Dream, Mandarine ou Harlequin au choix. Sans code.",
  type: "top_bar",
  placement: "all_public",
  placements: ["all_public"],
  isActive: true,
  startsAt: campaign.startsAt,
  endsAt: campaign.endsAt,
  priority: 5,
  buttonLabel: "Découvrir la boutique",
  buttonUrl: "/boutique",
  linkedCouponId: campaignId,
  linkedPromoCode: campaign.code,
  deletedLinkedCouponId: "",
  variant: "promo",
  dismissible: true,
  isArchived: false,
  isTemplate: false,
};

const campaignRef = db.collection("coupons").doc(campaignId);
const bannerRef = db.collection("promoBanners").doc(campaignId);
const fleursRef = db.collection("coupons").doc("fleurs20");
const [existingCampaign, existingBanner, fleurs20] = await Promise.all([
  campaignRef.get(),
  bannerRef.get(),
  fleursRef.get(),
]);

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  verifiedProducts: products.map((product) => ({
    id: product.id,
    name: product.name,
    isActive: product.isActive,
    stock: product.stock,
    price: product.price,
  })),
  campaignDiff: diff(existingCampaign.data() || {}, campaign),
  bannerDiff: diff(existingBanner.data() || {}, banner),
  fleurs20: fleurs20.exists
    ? { isActive: fleurs20.data()?.isActive, action: fleurs20.data()?.isActive ? "disable" : "none" }
    : { exists: false, action: "none" },
}, null, 2));

if (!apply) {
  console.log(`Dry-run uniquement. Pour appliquer : --apply --confirm=${confirmation}`);
  process.exit(0);
}
if (!confirmed) throw new Error(`Confirmation requise : --confirm=${confirmation}`);

await db.runTransaction(async (transaction) => {
  const [currentCampaign, currentBanner, currentFleurs, ...currentProducts] = await Promise.all([
    transaction.get(campaignRef),
    transaction.get(bannerRef),
    transaction.get(fleursRef),
    ...giftProductIds.map((productId) => transaction.get(db.collection("products").doc(productId))),
  ]);
  for (const snapshot of currentProducts) {
    const data = snapshot.data();
    if (!snapshot.exists || data?.isActive !== true || Number(data.stock || 0) < 1) {
      throw new Error(`Produit cadeau indisponible pendant la transaction : ${snapshot.id}`);
    }
  }
  transaction.set(campaignRef, {
    ...campaign,
    usedCount: Number(currentCampaign.data()?.usedCount || 0),
    createdAt: currentCampaign.exists
      ? currentCampaign.data()?.createdAt || FieldValue.serverTimestamp()
      : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  transaction.set(bannerRef, {
    ...banner,
    createdAt: currentBanner.exists
      ? currentBanner.data()?.createdAt || FieldValue.serverTimestamp()
      : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  if (currentFleurs.exists && currentFleurs.data()?.isActive === true) {
    transaction.update(fleursRef, {
      isActive: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
});

console.log(`Campagne ${campaignId} et bannière appliquées. usedCount existant préservé.`);

function diff(current: Record<string, unknown>, desired: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(desired)
      .filter(([key, value]) => JSON.stringify(normalize(current[key])) !== JSON.stringify(normalize(value)))
      .map(([key, value]) => [key, { before: normalize(current[key]), after: normalize(value) }]),
  );
}

function normalize(value: unknown): unknown {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  return value;
}
