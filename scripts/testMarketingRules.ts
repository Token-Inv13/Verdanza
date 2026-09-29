import { equal, rejects } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { CAGNOTTE_DEMO, validateCagnotteTestEnvironment, assertCagnotteEmulatorAvailable } from "./cagnotteEmulator.js";
validateCagnotteTestEnvironment(process.env); await assertCagnotteEmulatorAvailable(CAGNOTTE_DEMO);
const env = await initializeTestEnvironment({ projectId: CAGNOTTE_DEMO.projectId, firestore: { host: CAGNOTTE_DEMO.host, port: CAGNOTTE_DEMO.port, rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
const denied = (op: Promise<unknown>) => rejects(op, (e: unknown) => Boolean(e && typeof e === "object" && "code" in e && e.code === "permission-denied")); let checks = 0;
try {
  const collections = ["marketingDrafts", "marketingOperations", "marketingAuditLogs", "marketingCouponCodes"];
  await env.withSecurityRulesDisabled(async (context) => { const db = context.firestore(); await db.doc("adminUsers/marketing-rules-admin").set({ isActive: true }); for (const collection of collections) await db.doc(`${collection}/fixture`).set({ secret: "private proposal" }); await db.doc("coupons/marketing-rules-coupon").set({ code: "FIXTURE", isActive: false, usedCount: 4 }); await db.doc("coupons/marketing-rules-contest").set({ code: "PROTECTED", source: "contest", isActive: true, usedCount: 0 }); await db.doc("promoBanners/marketing-rules-banner").set({ title: "Fixture", isActive: false, isArchived: false }); await db.doc("promoBanners/marketing-rules-active").set({ title: "Active", isActive: true, isArchived: false }); });
  for (const context of [env.unauthenticatedContext(), env.authenticatedContext("customer"), env.authenticatedContext("marketing-rules-admin")]) {
    const db = context.firestore();
    for (const collection of collections) { await denied(db.doc(`${collection}/fixture`).get()); await denied(db.doc(`${collection}/forged`).set({ secret: "forged" })); await denied(db.doc(`${collection}/fixture`).update({ secret: "changed" })); await denied(db.doc(`${collection}/fixture`).delete()); checks += 4; }
  }
  const admin = env.authenticatedContext("marketing-rules-admin").firestore();
  await denied(admin.doc("coupons/marketing-rules-coupon").update({ usedCount: 0 })); checks++;
  await denied(admin.doc("coupons/marketing-rules-coupon").update({ isActive: true })); checks++;
  await denied(admin.doc("coupons/marketing-rules-new-active").set({ code: "NEW", isActive: true, usedCount: 0 })); checks++;
  await denied(admin.doc("coupons/marketing-rules-new-count").set({ code: "NEW", isActive: false, usedCount: 5 })); checks++;
  await denied(admin.doc("coupons/marketing-rules-coupon").update({ source: "contest" })); checks++;
  await denied(admin.doc("coupons/marketing-rules-coupon").update({ redeemableByEmailHash: "forged" })); checks++;
  await denied(admin.doc("coupons/marketing-rules-contest").update({ isActive: false })); checks++;
  await denied(admin.doc("coupons/marketing-rules-contest").delete()); checks++;
  await admin.doc("coupons/marketing-rules-coupon").update({ label: "Configuration inactive" }); equal((await admin.doc("coupons/marketing-rules-coupon").get()).data()?.usedCount, 4); checks++;
  await admin.doc("coupons/marketing-rules-inactive").set({ code: "INACTIVE", isActive: false, usedCount: 0 }); checks++;
  await denied(admin.doc("promoBanners/marketing-rules-banner").update({ isActive: true })); checks++;
  await denied(admin.doc("promoBanners/marketing-rules-new").set({ isActive: true })); checks++;
  await denied(admin.doc("promoBanners/marketing-rules-active").update({ title: "Changed" })); checks++;
  await denied(admin.doc("promoBanners/marketing-rules-active").update({ linkedCouponId: "marketing-rules-contest" })); checks++;
  await denied(admin.doc("promoBanners/marketing-rules-active").update({ linkedCouponId: "marketing-rules-coupon", deletedLinkedCouponId: "marketing-rules-coupon" })); checks++;
  await admin.doc("promoBanners/marketing-rules-active").update({ linkedCouponId: "deleted-coupon", deletedLinkedCouponId: "deleted-coupon" }); checks++;
  await denied(admin.doc("promoBanners/marketing-rules-active").update({ linkedCouponId: "marketing-rules-contest", deletedLinkedCouponId: "" })); checks++;
  const neutralization = admin.batch(); neutralization.delete(admin.doc("coupons/marketing-rules-inactive")); neutralization.update(admin.doc("promoBanners/marketing-rules-active"), { linkedCouponId: "marketing-rules-inactive", deletedLinkedCouponId: "marketing-rules-inactive" }); await neutralization.commit(); checks++;
  await admin.doc("promoBanners/marketing-rules-banner").update({ title: "Configuration inactive" }); checks++;
  await admin.doc("promoBanners/marketing-rules-active").update({ isActive: false, isArchived: true }); checks++;
  for (const context of [env.unauthenticatedContext(), env.authenticatedContext("customer")]) { await denied(context.firestore().doc("coupons/marketing-rules-coupon").get()); await denied(context.firestore().doc("promoBanners/marketing-rules-banner").get()); await denied(context.firestore().doc("coupons/forged").set({ isActive: false, usedCount: 0 })); await denied(context.firestore().doc("promoBanners/forged").set({ isActive: false })); checks += 4; }
  console.log(`${checks} contrôles de règles Marketing, confidentialité et compteurs validés.`);
} finally { await env.cleanup(); }
