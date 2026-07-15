import { FieldValue } from "firebase-admin/firestore";
import {
  getRequiredAdminDb,
  requireConfirmationFlag,
} from "./_firebaseAdminScript.js";
import type {
  CouponDiscountType,
  ProductCategory,
  PromoBannerPlacement,
  PromoBannerType,
  PromoBannerVariant,
} from "../src/types/index.js";

type BannerTemplate = {
  id: string;
  title: string;
  message: string;
  type: PromoBannerType;
  placements: PromoBannerPlacement[];
  variant: PromoBannerVariant;
  priority: number;
  linkedPromoCode?: string;
};

type CouponTemplate = {
  id: string;
  code: string;
  label: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minimumOrder: number;
  maxUses?: number;
  categories?: ProductCategory[];
  internalNote?: string;
};

const bannerTemplates: BannerTemplate[] = [
  {
    id: "template-launch-flowers-20",
    title: "Offre de lancement",
    message:
      "20 € de fleurs offerts au choix dès 30 € d'achat. Offre confirmée après validation de commande.",
    type: "top_bar",
    placements: ["home", "shop", "flowers"],
    variant: "promo",
    priority: 50,
  },
  {
    id: "template-free-shipping-60",
    title: "Livraison postale offerte",
    message: "Livraison postale offerte à partir de 60 € d'achat.",
    type: "shop_card",
    placements: ["shop", "cart", "checkout"],
    variant: "delivery",
    priority: 10,
  },
  {
    id: "template-welcome10",
    title: "Code bienvenue",
    message: "Utilisez le code WELCOME10 pour bénéficier de 10 % de remise.",
    type: "top_bar",
    placements: ["shop", "flowers", "resins"],
    variant: "promo",
    priority: 50,
    linkedPromoCode: "WELCOME10",
  },
  {
    id: "template-payment-after-confirmation",
    title: "Paiement après confirmation",
    message:
      "Après validation, Verdanza confirme votre commande et peut vous envoyer un lien de paiement par email.",
    type: "checkout_notice",
    placements: ["checkout"],
    variant: "info",
    priority: 10,
  },
  {
    id: "template-new-selection",
    title: "Nouvelle sélection à venir",
    message:
      "De nouvelles références CBD sont en cours de sélection et seront ajoutées progressivement.",
    type: "shop_card",
    placements: ["shop", "flowers", "resins"],
    variant: "info",
    priority: 10,
  },
];

const couponTemplates: CouponTemplate[] = [
  {
    id: "welcome10",
    code: "WELCOME10",
    label: "Code bienvenue",
    discountType: "percent",
    discountValue: 10,
    minimumOrder: 15,
    maxUses: 1000,
  },
  {
    id: "postaloffert",
    code: "POSTALOFFERT",
    label: "Livraison postale offerte",
    discountType: "free_shipping",
    discountValue: 0,
    minimumOrder: 30,
  },
  {
    id: "fleurs20",
    code: "FLEURS20",
    label: "20 EUR offerts sur les fleurs",
    discountType: "fixed",
    discountValue: 20,
    minimumOrder: 30,
    categories: ["flowers"],
    internalNote: "Modele inactif. Limite aux fleurs CBD via categories.",
  },
  {
    id: "local5",
    code: "LOCAL5",
    label: "5 EUR offerts",
    discountType: "fixed",
    discountValue: 5,
    minimumOrder: 20,
  },
  {
    id: "resine10",
    code: "RESINE10",
    label: "10 % sur les resines",
    discountType: "percent",
    discountValue: 10,
    minimumOrder: 20,
    categories: ["resins"],
    internalNote: "Modele inactif. Limite aux resines CBD via categories.",
  },
];

async function createIfMissing(
  reference: FirebaseFirestore.DocumentReference,
  payload: FirebaseFirestore.DocumentData,
) {
  const snapshot = await reference.get();
  if (snapshot.exists) return false;
  await reference.set(payload, { merge: true });
  return true;
}

async function main() {
  requireConfirmationFlag("seed:marketing-templates");

  const { db, projectId } = getRequiredAdminDb();
  console.log(`Projet Firebase cible: ${projectId}`);
  console.log(`Modeles bannieres a verifier: ${bannerTemplates.length}`);
  console.log(`Modeles promos a verifier: ${couponTemplates.length}`);

  let createdBanners = 0;
  let skippedBanners = 0;
  let createdCoupons = 0;
  let skippedCoupons = 0;

  for (const template of bannerTemplates) {
    const created = await createIfMissing(
      db.collection("promoBanners").doc(template.id),
      {
        ...template,
        placement: template.placements[0],
        buttonLabel: "",
        buttonUrl: "",
        linkedPromoCode: template.linkedPromoCode || "",
        dismissible: false,
        isActive: false,
        isArchived: false,
        isTemplate: true,
        startsAt: "",
        endsAt: "",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
    );
    if (created) createdBanners += 1;
    else skippedBanners += 1;
  }

  for (const template of couponTemplates) {
    const created = await createIfMissing(
      db.collection("coupons").doc(template.id),
      {
        ...template,
        usedCount: 0,
        isActive: false,
        isArchived: false,
        isTemplate: true,
        startsAt: "",
        endsAt: "",
        productIds: [],
        categories: template.categories || [],
        internalNote:
          template.internalNote || "Modele inactif cree pour activation manuelle.",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
    );
    if (created) createdCoupons += 1;
    else skippedCoupons += 1;
  }

  console.log(
    JSON.stringify(
      {
        createdBanners,
        skippedBanners,
        createdCoupons,
        skippedCoupons,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
