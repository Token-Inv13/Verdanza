import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { logFirestoreFallback } from "../lib/clientLog";
import { promotionAvailability, promotionBoundaryTimestamp } from "../lib/promotionDates";
import { collections } from "./collections";
import type {
  PromoBanner,
  PromoBannerPlacement,
  PromoBannerType,
  PromoBannerVariant,
  Coupon,
} from "../types";

export type PromoBannerInput = Omit<PromoBanner, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

type CouponBannerLinkInput = Pick<Coupon, "code" | "label"> & { id?: string };

export async function getPromoBannersWithFallback() {
  if (!db) return { banners: [], source: "empty" as const };
  try {
    const snapshot = await getDocs(
      query(collection(db, collections.promoBanners), orderBy("priority", "asc")),
    );
    const banners = snapshot.docs.map(
      (entry) => normalizePromoBanner({ id: entry.id, ...entry.data() } as PromoBanner),
    );
    return {
      banners,
      source: banners.length ? ("firestore" as const) : ("empty" as const),
    };
  } catch (error) {
    logFirestoreFallback("Unable to load Firestore promo banners", error);
    return { banners: [], source: "empty" as const };
  }
}

export async function getPublicPromoBanners() {
  try {
    const response = await fetch("/api/public-promo-banners");
    if (response.ok) {
      const payload = (await response.json()) as { banners?: PromoBanner[] };
      return (payload.banners ?? []).map(normalizePromoBanner);
    }
  } catch {
    // Fall through to Firestore client fallback below.
  }

  if (!db) return [];
  try {
    const snapshot = await getDocs(
      query(
        collection(db, collections.promoBanners),
        where("isActive", "==", true),
        where("isArchived", "==", false),
      ),
    );
    return snapshot.docs
      .map((entry) => normalizePromoBanner({ id: entry.id, ...entry.data() } as PromoBanner))
      .filter((banner) => isPromoBannerVisibleNow(banner))
      .sort((left, right) => Number(left.priority || 0) - Number(right.priority || 0));
  } catch (error) {
    logFirestoreFallback("Unable to load public promo banners", error);
    return [];
  }
}

export async function upsertPromoBanner(input: PromoBannerInput) {
  if (!db) throw new Error("Firebase is not configured.");
  const title = input.title.trim();
  const message = input.message.trim();
  if (!title) throw new Error("Titre requis.");
  if (!message) throw new Error("Message requis.");
  const bannerId = input.id || slugify(`${title}-${Date.now()}`);
  const bannerRef = doc(db, collections.promoBanners, bannerId);
  const existing = await getDoc(bannerRef);
  const existingData = existing.exists()
    ? normalizePromoBanner({ id: existing.id, ...existing.data() } as PromoBanner)
    : null;
  const placements = normalizeBannerPlacements(
    input.placements?.length ? input.placements : [input.placement],
  );
  const primaryPlacement = placements.includes("all_public")
    ? "all_public"
    : placements[0] || "draft";

  await setDoc(
    bannerRef,
    {
      title,
      message,
      type: input.type,
      placement: primaryPlacement,
      placements,
      isActive: isExplicitBoolean(input.isActive)
        ? input.isActive
        : existingData?.isActive ?? false,
      startsAt: input.startsAt || "",
      endsAt: input.endsAt || "",
      priority: Number(input.priority || 0),
      buttonLabel: input.buttonLabel?.trim() || "",
      buttonUrl: sanitizeBannerUrl(input.buttonUrl || ""),
      linkedCouponId: input.linkedCouponId?.trim() || "",
      linkedPromoCode: input.linkedPromoCode?.trim().toUpperCase().replace(/\s+/g, "") || "",
      variant: input.variant,
      dismissible: isExplicitBoolean(input.dismissible) ? input.dismissible : false,
      isArchived: isExplicitBoolean(input.isArchived)
        ? input.isArchived
        : existingData?.isArchived ?? false,
      isTemplate: isExplicitBoolean(input.isTemplate)
        ? input.isTemplate
        : existingData?.isTemplate ?? false,
      deletedLinkedCouponId: input.deletedLinkedCouponId?.trim() || "",
      updatedAt: serverTimestamp(),
      ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true },
  );
}

export async function upsertAssociatedPromoBanner(input: {
  coupon: CouponBannerLinkInput;
  banners: PromoBanner[];
  title: string;
  message: string;
}) {
  await upsertPromoBanner(buildAssociatedPromoBannerInput(input));
}

export function buildAssociatedPromoBannerInput(input: {
  coupon: CouponBannerLinkInput;
  banners: PromoBanner[];
  title: string;
  message: string;
}): PromoBannerInput {
  const couponId = associatedPromoBannerCouponId(input.coupon);
  const couponCode = normalizePromoCode(input.coupon.code);
  if (!couponId || !couponCode) throw new Error("Promotion associee invalide.");

  const existing = findAssociatedPromoBanner(input.banners, input.coupon);
  return {
    ...(existing ?? {
      type: "top_bar",
      placement: "home",
      placements: ["home"],
      isActive: false,
      startsAt: "",
      endsAt: "",
      priority: 10,
      buttonLabel: "",
      buttonUrl: "",
      variant: "promo",
      dismissible: false,
      isArchived: false,
      isTemplate: false,
    }),
    id: existing?.id || associatedPromoBannerId(couponId),
    title: input.title,
    message: input.message,
    linkedCouponId: couponId,
    linkedPromoCode: couponCode,
    deletedLinkedCouponId: "",
    isActive: existing ? existing.isActive : false,
    variant: existing?.variant || "promo",
  };
}

export function findAssociatedPromoBanner(
  banners: PromoBanner[],
  coupon: CouponBannerLinkInput,
) {
  const couponId = associatedPromoBannerCouponId(coupon);
  const couponCode = normalizePromoCode(coupon.code);
  const expectedId = couponId ? associatedPromoBannerId(couponId) : "";
  return (
    banners.find((banner) => couponId && banner.linkedCouponId === couponId) ||
    banners.find(
      (banner) => couponCode && normalizePromoCode(banner.linkedPromoCode || "") === couponCode,
    ) ||
    banners.find((banner) => expectedId && banner.id === expectedId)
  );
}

export function associatedPromoBannerId(couponId: string) {
  return `banner-${couponId}`;
}

export function associatedPromoBannerCouponId(coupon: CouponBannerLinkInput) {
  const code = normalizePromoCode(coupon.code);
  return String(coupon.id || code.toLowerCase()).trim();
}

export async function updatePromoBannerStatus(bannerId: string, isActive: boolean) {
  if (!db) throw new Error("Firebase is not configured.");
  await updateDoc(doc(db, collections.promoBanners, bannerId), {
    isActive,
    updatedAt: serverTimestamp(),
  });
}

export async function archivePromoBanner(bannerId: string) {
  if (!db) throw new Error("Firebase is not configured.");
  await updateDoc(doc(db, collections.promoBanners, bannerId), {
    isActive: false,
    isArchived: true,
    archivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function deletePromoBanner(bannerId: string) {
  if (!db) throw new Error("Firebase is not configured.");
  await deleteDoc(doc(db, collections.promoBanners, bannerId));
}

export function isPromoBannerVisibleNow(
  banner: PromoBanner,
  now = new Date(),
  linkedCoupon?: Coupon | null,
) {
  return promoBannerVisibility(banner, { now, linkedCoupon }).visible;
}

export function promoBannerVisibility(
  banner: PromoBanner,
  options: { now?: Date; linkedCoupon?: Coupon | null; hasLinkedCouponLookup?: boolean } = {},
): {
  visible: boolean;
  label: string;
  tone: "success" | "warning" | "danger" | "muted" | "gold";
} {
  const now = options.now ?? new Date();
  const placements = getBannerPlacements(banner);
  if (
    !banner.title.trim() ||
    !banner.message.trim()
  ) {
    return { visible: false, label: "Données invalides", tone: "danger" };
  }
  if (banner.isTemplate) return { visible: false, label: "Modèle non publiable", tone: "gold" };
  if (banner.isArchived) return { visible: false, label: "Archivée", tone: "muted" };
  if (!banner.isActive) return { visible: false, label: "Inactive manuellement", tone: "muted" };
  if (!placements.length || placements.every((placement) => placement === "draft")) {
    return { visible: false, label: "Aucun emplacement", tone: "warning" };
  }
  const startsAt = promotionBoundaryTimestamp(banner.startsAt, "start");
  const endsAt = promotionBoundaryTimestamp(banner.endsAt, "end");
  const current = now.getTime();
  if (startsAt && current < startsAt) return { visible: false, label: "Programmée", tone: "gold" };
  if (endsAt && current > endsAt) return { visible: false, label: "Expirée", tone: "danger" };

  const hasLinkedCoupon = Boolean(
    banner.linkedCouponId || banner.linkedPromoCode || banner.deletedLinkedCouponId,
  );
  if (hasLinkedCoupon && options.hasLinkedCouponLookup !== false) {
    if (!options.linkedCoupon) {
      return { visible: false, label: "Promotion liée introuvable", tone: "warning" };
    }
    const couponStatus = linkedCouponVisibility(options.linkedCoupon, now);
    if (!couponStatus.visible) return couponStatus;
  }

  return { visible: true, label: "Visible", tone: "success" };
}

export function promoBannerMatchesPlacement(
  banner: PromoBanner,
  placement: PromoBannerPlacement,
) {
  const placements = getBannerPlacements(banner);
  if (placements.includes("all_public")) return true;
  return placements.includes(placement);
}

export function promoBannerStatus(banner: PromoBanner): {
  label: string;
  tone: "success" | "warning" | "danger" | "muted" | "gold";
} {
  return promoBannerVisibility(banner, { hasLinkedCouponLookup: false });
}

export function normalizePromoBanner(banner: PromoBanner): PromoBanner {
  const placements = normalizeBannerPlacements(
    banner.placements?.length ? banner.placements : [banner.placement],
  );
  return {
    ...banner,
    title: String(banner.title || ""),
    message: String(banner.message || ""),
    type: normalizeBannerType(banner.type),
    placement: placements.includes("all_public")
      ? "all_public"
      : placements[0] || normalizeBannerPlacement(banner.placement),
    placements,
    priority: Number(banner.priority || 0),
    buttonLabel: banner.buttonLabel || "",
    buttonUrl: sanitizeBannerUrl(banner.buttonUrl || ""),
    linkedCouponId: banner.linkedCouponId || banner.deletedLinkedCouponId || "",
    linkedPromoCode: banner.linkedPromoCode || "",
    variant: normalizeBannerVariant(banner.variant),
    dismissible: Boolean(banner.dismissible),
    isActive: normalizeActiveState(banner),
    isArchived: Boolean(banner.isArchived || banner.archivedAt),
    isTemplate: Boolean(banner.isTemplate),
    deletedLinkedCouponId: banner.deletedLinkedCouponId || "",
    startsAt: normalizeBannerDateValue(banner.startsAt),
    endsAt: normalizeBannerDateValue(banner.endsAt),
  };
}

export function getBannerPlacements(banner: Pick<PromoBanner, "placement" | "placements">) {
  return normalizeBannerPlacements(
    banner.placements?.length ? banner.placements : [banner.placement],
  );
}

function normalizeBannerType(value: string): PromoBannerType {
  const normalized = String(value || "")
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
  const aliases: Record<string, PromoBannerType> = {
    topbar: "top_bar",
    top_bar: "top_bar",
    bandeau_haut_de_page: "top_bar",
    shopcard: "shop_card",
    shop_card: "shop_card",
    checkoutnotice: "checkout_notice",
    checkout_notice: "checkout_notice",
    modal: "modal",
  };
  if (aliases[normalized]) {
    return aliases[normalized];
  }
  return "shop_card";
}

function normalizeBannerPlacement(value: string): PromoBannerPlacement {
  const normalized = String(value || "")
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
  const aliases: Record<string, PromoBannerPlacement> = {
    home: "home",
    homepage: "home",
    accueil: "home",
    shop: "shop",
    boutique: "shop",
    flowers: "flowers",
    fleurs: "flowers",
    fleurs_cbd: "flowers",
    resins: "resins",
    resines: "resins",
    resines_cbd: "resins",
    cart: "cart",
    panier: "cart",
    checkout: "checkout",
    all: "all_public",
    all_public: "all_public",
    allpublic: "all_public",
    toutes_les_pages_publiques: "all_public",
    draft: "draft",
    brouillon: "draft",
  };
  if (aliases[normalized]) {
    return aliases[normalized];
  }
  return "draft";
}

function normalizeBannerPlacements(values: unknown[]) {
  const placements = values
    .map((value) => normalizeBannerPlacement(String(value || "")))
    .filter(Boolean);
  const unique = Array.from(new Set(placements));
  if (unique.includes("all_public")) return ["all_public"] as PromoBannerPlacement[];
  const publicPlacements = unique.filter((placement) => placement !== "draft");
  return publicPlacements.length ? publicPlacements : (["draft"] as PromoBannerPlacement[]);
}

function normalizeBannerVariant(value: string): PromoBannerVariant {
  if (["default", "promo", "delivery", "info", "warning"].includes(value)) {
    return value as PromoBannerVariant;
  }
  return "default";
}

export function sanitizeBannerUrl(value: string) {
  const url = value.trim();
  if (!url) return "";
  if (url.startsWith("/")) return url;
  if (/^https:\/\/verdanza\.fr(?:\/|$)/.test(url)) return url;
  if (/^https:\/\/verdanza-opal\.vercel\.app(?:\/|$)/.test(url)) {
    return url.replace("https://verdanza-opal.vercel.app", "https://verdanza.fr");
  }
  return "";
}

function normalizePromoCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeActiveState(banner: PromoBanner & { active?: unknown; enabled?: unknown; status?: unknown }) {
  if (isExplicitBoolean(banner.isActive)) return banner.isActive;
  if (isExplicitBoolean(banner.active)) return banner.active;
  if (isExplicitBoolean(banner.enabled)) return banner.enabled;
  const status = String(banner.status || "").trim().toLowerCase();
  if (["active", "actif", "visible", "published", "publie"].includes(status)) return true;
  if (["inactive", "inactif", "disabled", "draft", "brouillon", "archived"].includes(status)) {
    return false;
  }
  return false;
}

function isExplicitBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function linkedCouponVisibility(
  coupon: Coupon,
  now: Date,
): {
  visible: boolean;
  label: string;
  tone: "success" | "warning" | "danger" | "muted" | "gold";
} {
  const availability = promotionAvailability(coupon, now);
  if (coupon.isArchived) return { visible: false, label: "Promotion liée archivée", tone: "muted" };
  if (availability === "inactive") return { visible: false, label: "Promotion liée inactive", tone: "warning" };
  if (availability === "scheduled") return { visible: false, label: "Promotion liée programmée", tone: "gold" };
  if (availability === "expired") return { visible: false, label: "Promotion liée expirée", tone: "danger" };
  if (availability === "max_uses") return { visible: false, label: "Promotion liée indisponible", tone: "warning" };
  return { visible: true, label: "Visible", tone: "success" };
}

function normalizeBannerDateValue(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (
    typeof value === "object" &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return value.toDate().toISOString().slice(0, 10);
  }
  return "";
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
