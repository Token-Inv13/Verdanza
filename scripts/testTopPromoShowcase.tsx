import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { TopPromoShowcase } from "../src/components/TopPromoShowcase.tsx";
import {
  orderedTopPromoBanners,
  publicCodeForBanner,
  publicPromoCode,
  publicPromotionSummary,
  topPromoPresentation,
} from "../src/lib/publicPromotionBanners.ts";
import type { Coupon, Product, PromoBanner } from "../src/types/index.js";

type TestCase = { name: string; run: () => void };
const root = process.cwd();

const automaticCoupon: Coupon = {
  id: "weekend-gift",
  code: "WEEKENDAOUT2026",
  label: "Cadeau week-end",
  discountType: "fixed",
  discountValue: 0,
  minimumOrder: 30,
  autoApply: true,
  promotionType: "tiered_product_gift",
  giftProductIds: ["blue-dream"],
  giftTiers: [
    { id: "tier-70", minimumSubtotal: 70, quantityGrams: 3 },
    { id: "tier-30", minimumSubtotal: 30, quantityGrams: 1 },
    { id: "tier-50", minimumSubtotal: 50, quantityGrams: 2 },
  ],
  usedCount: 0,
  isActive: true,
};

const products = [{ id: "blue-dream", name: "Blue Dream" }] as Product[];
const autoSummary = publicPromotionSummary(automaticCoupon, products);

const automaticBanner = banner({
  id: "weekend",
  priority: 5,
  title: "Jusqu’à 3 g offerts ce week-end",
  message: "Plus vous commandez, plus vous recevez.",
  linkedPromoCode: "WEEKENDAOUT2026",
  promotionSummary: autoSummary,
  buttonLabel: "Découvrir la boutique",
  buttonUrl: "/boutique",
});

const welcomeBanner = banner({
  id: "welcome",
  priority: 10,
  title: "Bienvenue chez Verdanza",
  message: "-10 % dès 30 € avec le code",
  linkedPromoCode: "WELCOME10",
  promotionSummary: {
    applicationMode: "code",
    requiresCode: true,
    promotionType: "percentage_cart_discount",
    discountType: "percent",
    discountValue: 10,
    minimumOrder: 30,
  },
});

const thirdBanner = banner({
  id: "delivery",
  priority: 20,
  title: "Livraison suivie",
  message: "Une troisième information utile.",
  variant: "delivery",
});

const tests: TestCase[] = [
  {
    name: "no banner renders no promotional space",
    run() {
      assertEqual(render([]), "");
    },
  },
  {
    name: "promotion summary is sanitized, sorted and describes automatic application",
    run() {
      assertEqual(autoSummary.applicationMode, "automatic");
      assertEqual(autoSummary.requiresCode, false);
      assertEqual(autoSummary.giftTiers?.map((tier) => tier.minimumSubtotal).join(","), "30,50,70");
      assertEqual(autoSummary.giftProductNames?.join(","), "Blue Dream");
      assertEqual(Object.hasOwn(autoSummary, "giftProductIds"), false);
      assertEqual(Object.hasOwn(autoSummary, "usedCount"), false);
    },
  },
  {
    name: "automatic technical codes are never public",
    run() {
      assertEqual(publicPromoCode("WEEKENDAOUT2026", automaticCoupon, autoSummary), "");
      assertEqual(publicCodeForBanner(automaticBanner), "");
      assertNotIncludes(render([automaticBanner]), "WEEKENDAOUT2026");
    },
  },
  {
    name: "manual codes remain visible and copyable",
    run() {
      const html = render([automaticBanner, welcomeBanner]);
      assertIncludes(html, "WELCOME10");
      assertIncludes(html, "Copier le code WELCOME10");
      assertIncludes(html, 'aria-live="polite"');
      const promotedHtml = render([welcomeBanner]);
      assertIncludes(promotedHtml, "WELCOME10");
      assertIncludes(promotedHtml, "Copier le code WELCOME10");
    },
  },
  {
    name: "priority controls main and secondary placement",
    run() {
      const ordered = orderedTopPromoBanners([welcomeBanner, automaticBanner]);
      assertEqual(ordered[0].id, "weekend");
      const presentation = topPromoPresentation([welcomeBanner, automaticBanner]);
      assertEqual(presentation.primary?.id, "weekend");
      assertEqual(presentation.secondary?.id, "welcome");
    },
  },
  {
    name: "one banner renders without false navigation",
    run() {
      const html = render([automaticBanner]);
      assertIncludes(html, "Jusqu’à 3 g offerts ce week‑end");
      assertNotIncludes(html, "Offre suivante");
      assertNotIncludes(html, "secondary-promo-rail");
    },
  },
  {
    name: "two banners show one main card and one secondary rail without carousel controls",
    run() {
      const html = render([automaticBanner, welcomeBanner]);
      assertEqual(count(html, 'data-testid="top-promo-showcase"'), 1);
      assertEqual(count(html, 'data-testid="secondary-promo-rail"'), 1);
      assertNotIncludes(html, "Offre suivante");
      assertNotIncludes(html, "Position dans les offres");
    },
  },
  {
    name: "three banners expose manual navigation and dots without autoplay",
    run() {
      const html = render([automaticBanner, welcomeBanner, thirdBanner]);
      assertIncludes(html, "Offre précédente");
      assertIncludes(html, "Offre suivante");
      assertIncludes(html, "Afficher l&#x27;offre 3");
      assertNotIncludes(read("src/components/TopPromoShowcase.tsx"), "setInterval");
    },
  },
  {
    name: "gift thresholds come from structured data rather than banner copy",
    run() {
      const html = render([{ ...automaticBanner, message: "Texte sans aucun palier." }]);
      assertIncludes(html, "30 €");
      assertIncludes(html, "1 g offert");
      assertIncludes(html, "50 €");
      assertIncludes(html, "2 g offerts");
      assertIncludes(html, "70 €");
      assertIncludes(html, "3 g offerts");
    },
  },
  {
    name: "mobile showcase uses shrinkable tiers and an integrated close control",
    run() {
      const source = read("src/components/TopPromoShowcase.tsx");
      assertIncludes(source, 'data-testid="gift-tier-grid"');
      assertIncludes(source, "min-[350px]:grid-cols-3");
      assertIncludes(source, "grid-cols-[auto_minmax(0,1fr)]");
      assertIncludes(source, 'className="absolute right-1 top-1 z-10"');
      assertIncludes(source, "h-11 w-11");
      assertNotIncludes(source, "min-w-[105px]");
      assertNotIncludes(source, "snap-x");
    },
  },
  {
    name: "optional CTA and close controls degrade gracefully",
    run() {
      const plain = banner({ id: "plain", title: "Titre long ".repeat(8), message: "Message long ".repeat(12), dismissible: false });
      const html = render([plain]);
      assertIncludes(html, "Titre long");
      assertIncludes(html, "Message long");
      assertNotIncludes(html, "Fermer la promotion");
      assertNotIncludes(html, "Découvrir la boutique");
    },
  },
  {
    name: "dismissal key remains backward compatible and non-top slots remain generic",
    run() {
      const slotSource = read("src/components/PromoBannerSlot.tsx");
      assertIncludes(slotSource, "verdanza_banner_dismissed_${bannerId}");
      assertIncludes(slotSource, 'if (type === "top_bar")');
      assertIncludes(slotSource, "<PublicPromoBanner key={banner.id}");
      assertIncludes(slotSource, "new Set(current).add(banner.id)");
    },
  },
  {
    name: "showcase reserves compact loading space and contains no promotional image dependency",
    run() {
      const slotSource = read("src/components/PromoBannerSlot.tsx");
      const showcaseSource = read("src/components/TopPromoShowcase.tsx");
      assertIncludes(slotSource, "h-[176px]");
      assertIncludes(slotSource, "motion-reduce:animate-none");
      assertNotIncludes(showcaseSource, "<img");
      assertNotIncludes(showcaseSource, "Blue Dream");
    },
  },
];

let passed = 0;
for (const test of tests) {
  try {
    test.run();
    passed += 1;
    console.log(`PASS ${test.name}`);
  } catch (error) {
    console.error(`FAIL ${test.name}`);
    throw error;
  }
}
console.log(`Top promo showcase: ${passed}/${tests.length} tests passed.`);

function banner(overrides: Partial<PromoBanner>): PromoBanner {
  return {
    id: "banner",
    title: "Promotion",
    message: "Une offre Verdanza.",
    type: "top_bar",
    placement: "all_public",
    placements: ["all_public"],
    isActive: true,
    priority: 100,
    variant: "promo",
    dismissible: true,
    ...overrides,
  };
}

function render(banners: PromoBanner[]) {
  const previousConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    if (!String(args[0] || "").includes("useLayoutEffect does nothing on the server")) {
      previousConsoleError(...args);
    }
  };
  try {
    return renderToStaticMarkup(
      <MemoryRouter>
        <TopPromoShowcase banners={banners} onDismiss={() => undefined} />
      </MemoryRouter>,
    );
  } finally {
    console.error = previousConsoleError;
  }
}

function read(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

function count(value: string, search: string) {
  return value.split(search).length - 1;
}

function assertEqual(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

function assertIncludes(value: string, search: string) {
  if (!value.includes(search)) throw new Error(`Expected output to include ${search}`);
}

function assertNotIncludes(value: string, search: string) {
  if (value.includes(search)) throw new Error(`Expected output not to include ${search}`);
}
