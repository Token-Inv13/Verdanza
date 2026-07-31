import type { Coupon, Invoice, PromoBanner } from "../types";
import type { AdminOrderRow } from "../services/ordersService";

export type AdminArchiveCategory = "orders" | "coupons" | "promoBanners" | "invoices";

export type AdminArchiveItem = {
  id: string;
  category: AdminArchiveCategory;
  title: string;
  subtitle?: string;
  typeLabel?: string;
  archivedAt?: unknown;
  previousStatus?: string;
  detail?: string;
  href: string;
  canRestore: boolean;
  restoreBlockedReason?: string;
};

export type ArchiveSortDirection = "newest" | "oldest";

export const adminArchiveCategories: {
  key: AdminArchiveCategory;
  label: string;
  href: string;
}[] = [
  { key: "orders", label: "Commandes", href: "/admin/commandes" },
  { key: "coupons", label: "Promotions", href: "/admin/coupons" },
  { key: "promoBanners", label: "Bannieres", href: "/admin/bannieres" },
  { key: "invoices", label: "Factures", href: "/admin/comptabilite" },
];

export function isArchivedCoupon(coupon: Coupon) {
  return coupon.isArchived === true || hasArchiveDate(coupon);
}

export function isArchivedPromoBanner(banner: PromoBanner) {
  return banner.isArchived === true || hasArchiveDate(banner);
}

export function isArchivedOrder(order: AdminOrderRow) {
  return (
    order.archived === true ||
    order.hidden === true ||
    hasArchiveDate(order) ||
    Boolean(order.hiddenAt) ||
    Boolean(order.deletedAt)
  );
}

export function isArchivedInvoice(invoice: Invoice) {
  const record = invoice as Invoice & {
    archived?: boolean;
    isArchived?: boolean;
    archivedAt?: unknown;
  };
  return record.archived === true || record.isArchived === true || hasArchiveDate(record);
}

export function visibleAdminCoupons(coupons: Coupon[]) {
  return coupons.filter((coupon) => !isArchivedCoupon(coupon));
}

export function visibleAdminPromoBanners(banners: PromoBanner[]) {
  return banners.filter((banner) => !isArchivedPromoBanner(banner));
}

export function visibleAdminInvoices(invoices: Invoice[]) {
  return invoices.filter((invoice) => !isArchivedInvoice(invoice));
}

export function orderArchiveItem(order: AdminOrderRow): AdminArchiveItem {
  const isDeleted = Boolean(order.deletedAt);
  const canRestore =
    !isDeleted &&
    (order.archived === true ||
      order.hidden === true ||
      Boolean(order.archivedAt) ||
      Boolean(order.hiddenAt));
  return {
    id: order.id,
    category: "orders",
    title: order.id,
    subtitle: order.customer,
    typeLabel: order.deliveryMethod || order.delivery,
    archivedAt: order.archivedAt || order.hiddenAt || order.deletedAt,
    previousStatus: String(order.orderStatus || "Non communique"),
    detail: `${order.paymentStatus} - ${order.total}`,
    href: "/admin/commandes",
    canRestore,
    restoreBlockedReason: isDeleted
      ? "Commande marquee supprimee: restauration non proposee depuis Archives."
      : canRestore
        ? undefined
        : "Restauration indisponible pour cette commande.",
  };
}

export function couponArchiveItem(coupon: Coupon): AdminArchiveItem {
  return {
    id: coupon.id,
    category: "coupons",
    title: coupon.code,
    subtitle: coupon.label,
    typeLabel: coupon.discountType,
    archivedAt: coupon.archivedAt,
    previousStatus: coupon.isActive ? "Actif avant archivage" : "Inactif",
    detail: `${formatNumber(coupon.minimumOrder)} EUR minimum - ${coupon.usedCount || 0} utilisations`,
    href: "/admin/coupons",
    canRestore: false,
    restoreBlockedReason: "Promotion en lecture seule dans Archives.",
  };
}

export function promoBannerArchiveItem(banner: PromoBanner): AdminArchiveItem {
  return {
    id: banner.id,
    category: "promoBanners",
    title: banner.title,
    subtitle: banner.message,
    typeLabel: banner.type,
    archivedAt: banner.archivedAt,
    previousStatus: banner.isActive ? "Active avant archivage" : "Inactive",
    detail: banner.linkedPromoCode
      ? `Promotion ${banner.linkedPromoCode}`
      : "Sans promotion liee",
    href: "/admin/bannieres",
    canRestore: false,
    restoreBlockedReason: "Banniere en lecture seule dans Archives.",
  };
}

export function invoiceArchiveItem(invoice: Invoice): AdminArchiveItem {
  const record = invoice as Invoice & {
    archivedAt?: unknown;
    archived?: boolean;
    isArchived?: boolean;
  };
  return {
    id: invoice.id,
    category: "invoices",
    title: invoice.invoiceNumber || invoice.id,
    subtitle: invoice.customerName || invoice.customerEmail,
    typeLabel: invoice.origin || "facture",
    archivedAt: record.archivedAt,
    previousStatus: invoice.status,
    detail: `${formatNumber(invoice.total)} EUR - ${invoice.paymentStatus}`,
    href: "/admin/comptabilite",
    canRestore: false,
    restoreBlockedReason: "Facture en lecture seule dans Archives.",
  };
}

export function filterArchiveItems(items: AdminArchiveItem[], search: string) {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) return items;
  return items.filter((item) => archiveSearchText(item).includes(normalizedSearch));
}

export function sortArchiveItems(
  items: AdminArchiveItem[],
  direction: ArchiveSortDirection,
) {
  return [...items].sort((left, right) => {
    const delta = archiveDateValue(right.archivedAt) - archiveDateValue(left.archivedAt);
    return direction === "newest" ? delta : -delta;
  });
}

export function buildRestorePayload(category: AdminArchiveCategory) {
  return category === "orders" ? { restore: true } : null;
}

export function archiveDateValue(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return Date.parse(value) || 0;
  if (typeof value === "number") return value;
  if (typeof value === "object") {
    const candidate = value as { seconds?: number; toDate?: () => Date; toMillis?: () => number };
    if (typeof candidate.toMillis === "function") return candidate.toMillis();
    if (typeof candidate.toDate === "function") return candidate.toDate().getTime();
    if (typeof candidate.seconds === "number") return candidate.seconds * 1000;
  }
  return 0;
}

function archiveSearchText(item: AdminArchiveItem) {
  return [
    item.id,
    item.title,
    item.subtitle,
    item.typeLabel,
    item.previousStatus,
    item.detail,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function hasArchiveDate(record: { archivedAt?: unknown }) {
  return Boolean(record.archivedAt);
}

function formatNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed.toLocaleString("fr-FR") : "0";
}
