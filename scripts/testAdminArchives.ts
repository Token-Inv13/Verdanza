import assert from "node:assert/strict";
import {
  adminArchiveCategories,
  buildRestorePayload,
  couponArchiveItem,
  filterArchiveItems,
  invoiceArchiveItem,
  isArchivedCoupon,
  isArchivedInvoice,
  isArchivedOrder,
  isArchivedPromoBanner,
  orderArchiveItem,
  promoBannerArchiveItem,
  sortArchiveItems,
  visibleAdminCoupons,
  visibleAdminInvoices,
  visibleAdminPromoBanners,
} from "../src/lib/adminArchives";
import type { Coupon, Invoice, PromoBanner } from "../src/types";
import type { AdminOrderRow } from "../src/services/ordersService";

assert.deepEqual(
  adminArchiveCategories.map((category) => category.key),
  ["orders", "coupons", "promoBanners", "invoices"],
);

const activeCoupon = couponFixture({ id: "welcome10", code: "WELCOME10" });
const archivedCoupon = couponFixture({
  id: "local5",
  code: "LOCAL5",
  isArchived: true,
  archivedAt: "2026-07-29T10:00:00.000Z",
});
const contestCoupon = couponFixture({
  id: "contest-prize",
  code: "VDZ-PRIVATE",
  source: "contest",
});
assert.equal(isArchivedCoupon(archivedCoupon), true);
assert.deepEqual(visibleAdminCoupons([activeCoupon, archivedCoupon]).map((coupon) => coupon.id), [
  "welcome10",
]);
assert.deepEqual(
  visibleAdminCoupons([activeCoupon, contestCoupon]).map((coupon) => coupon.id),
  ["welcome10"],
  "contest prize coupons stay out of the generic promotions module",
);
assert.equal(couponArchiveItem(archivedCoupon).canRestore, false);

const activeBanner = bannerFixture({ id: "banner-active", title: "Active banner" });
const archivedBanner = bannerFixture({
  id: "banner-archived",
  title: "Archived banner",
  isArchived: true,
  archivedAt: "2026-07-28T10:00:00.000Z",
});
assert.equal(isArchivedPromoBanner(archivedBanner), true);
assert.deepEqual(
  visibleAdminPromoBanners([activeBanner, archivedBanner]).map((banner) => banner.id),
  ["banner-active"],
);
assert.equal(promoBannerArchiveItem(archivedBanner).canRestore, false);

const archivedOrder: AdminOrderRow = {
  id: "order-1",
  customer: "Client test",
  paymentStatus: "paid",
  orderStatus: "prepared",
  delivery: "local",
  items: [],
  total: "32,00 EUR",
  archived: true,
  archivedAt: "2026-07-26T10:00:00.000Z",
};
const hiddenOrder: AdminOrderRow = {
  ...archivedOrder,
  id: "order-hidden",
  archived: false,
  hidden: true,
  hiddenAt: "2026-07-25T10:00:00.000Z",
};
const deletedOrder: AdminOrderRow = {
  ...archivedOrder,
  id: "order-deleted",
  archived: false,
  archivedAt: undefined,
  deletedAt: "2026-07-26T11:00:00.000Z",
};
assert.equal(isArchivedOrder(archivedOrder), true);
assert.equal(isArchivedOrder(hiddenOrder), true);
assert.equal(isArchivedOrder(deletedOrder), true);
assert.equal(orderArchiveItem(archivedOrder).canRestore, true);
assert.equal(orderArchiveItem(hiddenOrder).canRestore, true);
assert.equal(orderArchiveItem(deletedOrder).canRestore, false);

const archivedInvoice = invoiceFixture({
  id: "invoice-1",
  invoiceNumber: "VER-2026-0001",
  isArchived: true,
  archivedAt: "2026-07-24T10:00:00.000Z",
});
const activeInvoice = invoiceFixture({ id: "invoice-active", invoiceNumber: "VER-2026-0009" });
assert.equal(isArchivedInvoice(archivedInvoice), true);
assert.equal(invoiceArchiveItem(archivedInvoice).canRestore, false);
assert.deepEqual(visibleAdminInvoices([activeInvoice, archivedInvoice]).map((invoice) => invoice.id), [
  "invoice-active",
]);

const items = [
  couponArchiveItem(archivedCoupon),
  promoBannerArchiveItem(archivedBanner),
  orderArchiveItem(archivedOrder),
  invoiceArchiveItem(archivedInvoice),
];
assert.deepEqual(filterArchiveItems(items, "local5").map((item) => item.id), ["local5"]);
assert.deepEqual(sortArchiveItems(items, "newest").map((item) => item.id), [
  "local5",
  "banner-archived",
  "order-1",
  "invoice-1",
]);
assert.deepEqual(sortArchiveItems(items, "oldest").map((item) => item.id), [
  "invoice-1",
  "order-1",
  "banner-archived",
  "local5",
]);

assert.deepEqual(buildRestorePayload("orders"), { restore: true });
assert.equal(buildRestorePayload("coupons"), null);
assert.equal(buildRestorePayload("promoBanners"), null);
assert.equal(buildRestorePayload("invoices"), null);

console.log("Admin archives tests passed");

function couponFixture(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: "coupon",
    code: "COUPON",
    label: "Coupon",
    discountType: "percent",
    discountValue: 10,
    minimumOrder: 30,
    usedCount: 0,
    isActive: true,
    ...overrides,
  };
}

function bannerFixture(overrides: Partial<PromoBanner> = {}): PromoBanner {
  return {
    id: "banner",
    title: "Banner",
    message: "Message",
    type: "top_bar",
    placement: "home",
    placements: ["home"],
    isActive: false,
    priority: 10,
    variant: "promo",
    dismissible: false,
    ...overrides,
  };
}

function invoiceFixture(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "invoice",
    invoiceNumber: "VER-2026-0000",
    origin: "manual",
    status: "draft",
    customerName: "Client",
    lines: [],
    subtotal: 0,
    deliveryFee: 0,
    discountAmount: 0,
    total: 0,
    paymentStatus: "to_confirm",
    createdAt: "2026-07-24T10:00:00.000Z",
    updatedAt: "2026-07-24T10:00:00.000Z",
    ...overrides,
  };
}
