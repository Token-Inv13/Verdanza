import { FieldValue } from "firebase-admin/firestore";
import {
  getRequiredAdminDb,
  requireConfirmationFlag,
} from "./_firebaseAdminScript.js";

async function main() {
  requireConfirmationFlag("repair:launch-promo-banner");

  const { db, projectId } = getRequiredAdminDb();
  const templateRef = db.collection("promoBanners").doc("template-launch-flowers-20");
  const activeRef = db.collection("promoBanners").doc("launch-flowers-20");
  const couponRef = db.collection("coupons").doc("fleurs20");
  const [templateSnapshot, activeSnapshot, couponSnapshot] = await Promise.all([
    templateRef.get(),
    activeRef.get(),
    couponRef.get(),
  ]);

  if (!couponSnapshot.exists) {
    throw new Error("Promotion coupons/fleurs20 introuvable.");
  }

  const template = templateSnapshot.data() || {};
  const message =
    typeof template.message === "string" && template.message.trim()
      ? template.message.trim().replace(/\s+/g, " ")
      : "20 EUR de fleurs offerts au choix des 30 EUR d'achat.";

  await db.runTransaction(async (transaction) => {
    transaction.set(
      templateRef,
      {
        isTemplate: true,
        isActive: false,
        isArchived: false,
        updatedAt: FieldValue.serverTimestamp(),
        ...(templateSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );

    transaction.set(
      activeRef,
      {
        title: "Offre de lancement",
        message,
        type: "top_bar",
        placement: "home",
        placements: ["home", "shop", "flowers"],
        buttonLabel: "",
        buttonUrl: "",
        linkedPromoCode: "",
        linkedCouponId: "fleurs20",
        deletedLinkedCouponId: "",
        isActive: true,
        isArchived: false,
        isTemplate: false,
        dismissible: false,
        variant: "promo",
        startsAt: "",
        endsAt: "",
        priority: 50,
        updatedAt: FieldValue.serverTimestamp(),
        ...(activeSnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );
  });

  console.log(
    JSON.stringify(
      {
        projectId,
        template: {
          id: templateRef.id,
          isTemplate: true,
          isActive: false,
        },
        activeBanner: {
          id: activeRef.id,
          linkedCouponId: "fleurs20",
          placements: ["home", "shop", "flowers"],
          isActive: true,
          isTemplate: false,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("repair:launch-promo-banner failed", error);
  process.exit(1);
});
