import {
  couponArchiveItem,
  invoiceArchiveItem,
  isArchivedCoupon,
  isArchivedInvoice,
  isArchivedOrder,
  isArchivedPromoBanner,
  orderArchiveItem,
  promoBannerArchiveItem,
  type AdminArchiveCategory,
  type AdminArchiveItem,
} from "../lib/adminArchives";
import { getInvoicesWithFallback } from "./invoicesService";
import { getAdminOrdersWithFallback, updateOrderAdminFields } from "./ordersService";
import { getCouponsWithFallback } from "./couponsService";
import { getPromoBannersWithFallback } from "./promoBannersService";

export type AdminArchiveCategoryResult = {
  items: AdminArchiveItem[];
  source: "firestore" | "local" | "empty";
};

export async function loadAdminArchiveCategory(
  category: AdminArchiveCategory,
): Promise<AdminArchiveCategoryResult> {
  switch (category) {
    case "orders": {
      const { orders, source } = await getAdminOrdersWithFallback();
      return {
        source,
        items: orders.filter(isArchivedOrder).map(orderArchiveItem),
      };
    }
    case "coupons": {
      const { coupons, source } = await getCouponsWithFallback();
      return {
        source,
        items: coupons.filter(isArchivedCoupon).map(couponArchiveItem),
      };
    }
    case "promoBanners": {
      const { banners, source } = await getPromoBannersWithFallback();
      return {
        source,
        items: banners.filter(isArchivedPromoBanner).map(promoBannerArchiveItem),
      };
    }
    case "invoices": {
      const { invoices, source } = await getInvoicesWithFallback();
      return {
        source,
        items: invoices.filter(isArchivedInvoice).map(invoiceArchiveItem),
      };
    }
  }
}

export async function restoreAdminArchiveItem(item: AdminArchiveItem) {
  if (item.category !== "orders" || !item.canRestore) {
    throw new Error(item.restoreBlockedReason || "Restauration non autorisee depuis Archives.");
  }
  await updateOrderAdminFields(item.id, { restore: true });
}
