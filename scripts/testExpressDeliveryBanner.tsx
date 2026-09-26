import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ExpressDeliveryBanner } from "../src/components/ExpressDeliveryBanner";
import { expressDeliverySummary } from "../src/lib/expressDeliveryBanner";
import type { PromoBanner } from "../src/types";
import { expressDeliveryBannerFixture as banner } from "./fixtures/expressDeliveryBanner";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const before = JSON.stringify(banner);
const summary = expressDeliverySummary(banner);
assert.deepEqual(summary, { delay: "1", opensAt: "11", closesAt: "1", radius: "15" });
assert.equal(JSON.stringify(banner), before, "presentation must not mutate the source");
assert.deepEqual(expressDeliverySummary({
  ...banner,
  message: banner.message.replace("environ 1 h", "environ 2 h").replace("15 km", "12 km"),
}), { delay: "2", opensAt: "11", closesAt: "1", radius: "12" }, "metrics must come from the active message");

const unsupported: Partial<PromoBanner>[] = [
  { id: "other-delivery" }, { title: "Livraison express à Marseille" },
  { type: "top_bar" }, { variant: "promo" }, { variant: "warning" },
  { linkedCouponId: "coupon" }, { linkedPromoCode: "WELCOME" },
  { promotionSummary: { applicationMode: "code", requiresCode: true } },
  { buttonLabel: "Autre lien", buttonUrl: "/boutique" },
  { message: `${banner.message} Sous réserve de disponibilité.` },
  { message: banner.message.replace("11 h", "25 h") },
  { message: banner.message.replace("environ 1 h", "environ 0 h") },
  { message: banner.message.replace("15 km", "0 km") },
  { message: "Nouvelles conditions de livraison." },
];
for (const overrides of unsupported) {
  assert.equal(expressDeliverySummary({ ...banner, ...overrides }), null,
    `unrecognized content must keep the complete generic banner: ${JSON.stringify(overrides)}`);
}
assert.ok(expressDeliverySummary({ ...banner, variant: "delivery" }));

assert.ok(summary);
const previousConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (!String(args[0]).includes("useLayoutEffect does nothing on the server")) previousConsoleError(...args);
};
try {
  for (const dismissible of [false, true]) {
    const html = renderToStaticMarkup(<MemoryRouter>
      <ExpressDeliveryBanner banner={{ ...banner, dismissible }} summary={summary}
        onConditionsClick={() => undefined} onDismiss={() => undefined} />
    </MemoryRouter>);
    assert.match(html, /Express à Aix-en-Provence/);
    assert.match(html, /≈ 1 h/);
    assert.match(html, /11 h → 1 h/);
    assert.match(html, /jusqu’à 15 km/);
    assert.match(html, /href="\/livraison-locale"/);
    assert.match(html, /Voir la zone et les conditions/);
    assert.doesNotMatch(html, /\p{Extended_Pictographic}/u, "no emoji in the premium view");
    assert.equal(html.includes("Fermer cette bannière"), dismissible);
  }
} finally {
  console.error = previousConsoleError;
}

const source = readFileSync("src/components/ExpressDeliveryBanner.tsx", "utf8");
assert.match(source, /onClick=\{onConditionsClick\}/);
assert.match(source, /onDismiss\(banner\)/);
const slotSource = readFileSync("src/components/PromoBannerSlot.tsx", "utf8");
assert.match(slotSource, /trackCtaClick\(/);
assert.match(slotSource, /ctaLocation: `promo_banner_\$\{currentPlacement\}`/);
console.log("Express banner tests passed: source-derived metrics, immutable input, safe generic fallback, local link, consent-aware analytics, accessible icons and optional dismissal.");
