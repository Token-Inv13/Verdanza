import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { collections } from "./collections";
import type {
  PromoBanner,
  PromoBannerPlacement,
  PromoBannerType,
  PromoBannerVariant,
} from "../types";

export type PromoBannerInput = Omit<PromoBanner, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

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
    console.warn("Unable to load Firestore promo banners", error);
    return { banners: [], source: "empty" as const };
  }
}

export async function getPublicPromoBanners() {
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
    if (import.meta.env.DEV) {
      console.warn("Unable to load public promo banners", error);
    }
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

  await setDoc(
    doc(db, collections.promoBanners, bannerId),
    {
      title,
      message,
      type: input.type,
      placement: input.placement,
      isActive: Boolean(input.isActive),
      startsAt: input.startsAt || "",
      endsAt: input.endsAt || "",
      priority: Number(input.priority || 0),
      buttonLabel: input.buttonLabel?.trim() || "",
      buttonUrl: sanitizeBannerUrl(input.buttonUrl || ""),
      linkedPromoCode: input.linkedPromoCode?.trim().toUpperCase().replace(/\s+/g, "") || "",
      variant: input.variant,
      dismissible: Boolean(input.dismissible),
      isArchived: Boolean(input.isArchived),
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
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

export function isPromoBannerVisibleNow(banner: PromoBanner, now = new Date()) {
  if (!banner.isActive || banner.isArchived || banner.placement === "draft") return false;
  const startsAt = parseBannerDate(banner.startsAt);
  const endsAt = parseBannerDate(banner.endsAt);
  const current = now.getTime();
  if (startsAt && current < startsAt) return false;
  if (endsAt && current > endOfDay(endsAt)) return false;
  return true;
}

export function promoBannerMatchesPlacement(
  banner: PromoBanner,
  placement: PromoBannerPlacement,
) {
  if (banner.placement === "all_public") return true;
  return banner.placement === placement;
}

export function promoBannerStatus(banner: PromoBanner): {
  label: string;
  tone: "success" | "warning" | "danger" | "muted" | "gold";
} {
  const now = Date.now();
  const startsAt = parseBannerDate(banner.startsAt);
  const endsAt = parseBannerDate(banner.endsAt);
  if (banner.isArchived) return { label: "Archivee", tone: "muted" };
  if (!banner.isActive) return { label: "Inactive", tone: "muted" };
  if (startsAt && now < startsAt) return { label: "Programmee", tone: "gold" };
  if (endsAt && now > endOfDay(endsAt)) return { label: "Expiree", tone: "danger" };
  return { label: "Active", tone: "success" };
}

function normalizePromoBanner(banner: PromoBanner): PromoBanner {
  return {
    ...banner,
    title: String(banner.title || ""),
    message: String(banner.message || ""),
    type: normalizeBannerType(banner.type),
    placement: normalizeBannerPlacement(banner.placement),
    priority: Number(banner.priority || 0),
    buttonLabel: banner.buttonLabel || "",
    buttonUrl: sanitizeBannerUrl(banner.buttonUrl || ""),
    linkedPromoCode: banner.linkedPromoCode || "",
    variant: normalizeBannerVariant(banner.variant),
    dismissible: Boolean(banner.dismissible),
    isActive: Boolean(banner.isActive),
    isArchived: Boolean(banner.isArchived || banner.archivedAt),
    startsAt: normalizeBannerDateValue(banner.startsAt),
    endsAt: normalizeBannerDateValue(banner.endsAt),
  };
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

function normalizeBannerVariant(value: string): PromoBannerVariant {
  if (["default", "promo", "delivery", "info", "warning"].includes(value)) {
    return value as PromoBannerVariant;
  }
  return "default";
}

function sanitizeBannerUrl(value: string) {
  const url = value.trim();
  if (!url) return "";
  if (url.startsWith("/")) return url;
  if (url.startsWith("https://verdanza.fr")) return url;
  if (url.startsWith("https://verdanza-opal.vercel.app")) return url;
  return "";
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

function parseBannerDate(value: unknown) {
  const normalized = normalizeBannerDateValue(value);
  if (!normalized) return 0;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function endOfDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}
