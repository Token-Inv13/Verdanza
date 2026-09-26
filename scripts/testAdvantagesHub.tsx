import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AdvantagesHub } from "../src/components/AdvantagesHub";
import { AdvantagesNavigation } from "../src/components/AdvantagesNavigation";
import { getAdvantagesEntries, isAdvantagesPath } from "../src/lib/advantages";
import { resolveCagnotteDisplayConfiguration } from "../src/config/cagnotteFeatures";
import { canonicalUrl, prerenderSeoRoutes, sitemapUrls, staticSeoRoutes } from "./seoRoutes";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const originalConsoleError = console.error;
let serializationWarnings = 0;
console.error = (message: unknown, ...args: unknown[]) => {
  if (typeof message === "string" && message.startsWith("Warning: useLayoutEffect does nothing on the server")) {
    serializationWarnings += 1;
    return;
  }
  originalConsoleError(message, ...args);
};
for (const value of [undefined, "false", "true", true, "TRUE"]) {
  const enabled = resolveCagnotteDisplayConfiguration({ VITE_CAGNOTTE_READ_DISPLAY_ENABLED: value }).readDisplayEnabled;
  assert.equal(enabled, value === "true", "reuse the exact existing flag resolver, not a new flag");
  const entries = getAdvantagesEntries(enabled);
  assert.deepEqual(entries.map((entry) => entry.id), ["contest", "loyalty", "referral"]);
  assert.equal(entries[0].status, "active");
  assert.equal(entries[0].to, "/concours");
  assert.equal(entries[1].status, enabled ? "active" : "soon");
  assert.equal(entries[1].to, enabled ? "/compte/avantages" : undefined);
  assert.equal(entries[2].status, "soon");
  assert.equal(entries[2].to, undefined);
  assert.equal(entries[2].event, undefined);
  const hub = renderToStaticMarkup(<MemoryRouter><AdvantagesHub loyaltyEnabled={enabled} /></MemoryRouter>);
  assert.equal((hub.match(/data-advantage=/g) || []).length, 3);
  assert.equal((hub.match(/<a /g) || []).length, enabled ? 2 : 1);
  assert.match(hub, /href="\/concours"/);
  assert.equal(hub.includes('href="/compte/avantages"'), enabled);
  const referral = hub.match(/<article[^>]*data-advantage="referral"[\s\S]*?<\/article>/)![0];
  assert.doesNotMatch(referral, /<a\b|<button\b|tabindex|role="button"|href=/);
  assert.match(referral, /Bientôt/);
  assert.doesNotMatch(hub, /\bpoints\b|\bsolde\b|\bremise\b|€/i);
  const nav = renderToStaticMarkup(<MemoryRouter initialEntries={["/concours"]}>
    <AdvantagesNavigation loyaltyEnabled={enabled} onNavigate={() => {}} />
  </MemoryRouter>);
  assert.match(nav, /href="\/avantages"/);
  assert.match(nav, /is-active/);
  assert.match(nav, /aria-expanded="false"/);
  assert.match(nav, /aria-controls=/);
  assert.equal(nav.includes('href="/compte/avantages"'), enabled);
  assert.match(nav, /Parrainage<small>Bientôt<\/small>/);
  assert.doesNotMatch(nav, /href="[^"]*(?:referral|parrainage)/);
}
assert.equal(isAdvantagesPath("/concours/gain/test"), true);
assert.equal(isAdvantagesPath("/compte/avantages"), true);
assert.equal(isAdvantagesPath("/boutique"), false);
assert.equal(isAdvantagesPath("/concoursss"), false);
assert.equal(canonicalUrl("/avantages?test=1#fragment"), "https://verdanza.fr/avantages");
assert.deepEqual(staticSeoRoutes.find((route) => route.path === "/avantages"), {
  path: "/avantages", kind: "public-indexable", component: "AdvantagesPage", indexable: true,
});
assert.ok(prerenderSeoRoutes().some((route) => route.path === "/avantages"));
assert.ok(sitemapUrls().includes("https://verdanza.fr/avantages"));
assert.ok(!sitemapUrls().includes("https://verdanza.fr/compte/avantages"));
assert.ok(!staticSeoRoutes.some((route) => /referral|parrainage/.test(route.path)));
const app = readFileSync("src/App.tsx", "utf8");
assert.match(app, /const AdvantagesPage = lazy\(/);
assert.match(app, /<Route path="\/avantages" element=\{<AdvantagesPage \/>\} \/>/);
const layout = readFileSync("src/layouts/MainLayout.tsx", "utf8");
const headerItems = layout.slice(layout.indexOf("const navItems"), layout.indexOf("const mobileMenuId"));
assert.match(headerItems, /label: "Avantages", to: "\/avantages"/);
assert.doesNotMatch(headerItems, /label: "Concours"/);
assert.match(layout, /loyaltyEnabled=\{CAGNOTTE_READ_DISPLAY_ENABLED\}/);
assert.match(layout, /aria-label="Navigation mobile"/);
const page = readFileSync("src/pages/AdvantagesPage.tsx", "utf8");
assert.match(page, /loyaltyEnabled=\{CAGNOTTE_READ_DISPLAY_ENABLED\}/);
assert.match(page, /Plus de raisons de revenir\./);
assert.match(page, /trackEvent\("advantages_view"/);
assert.match(page, /trackEvent\(entry.event/);
assert.match(page, /if \(!analyticsAllowed\)/);
for (const file of ["src/lib/advantages.ts", "src/components/AdvantagesHub.tsx", "src/components/AdvantagesNavigation.tsx", "src/pages/AdvantagesPage.tsx"]) {
  assert.doesNotMatch(readFileSync(file, "utf8"), /fetch\(|fetchCagnotte|CagnottePanel|referralService|from ["'][^"']*services\//);
}
assert.match(readFileSync("src/pages/account/AccountAdvantagesPage.tsx", "utf8"), /noindex/);
console.error = originalConsoleError;
console.log(`Static serialization: ${serializationWarnings} expected React Router useLayoutEffect warnings; browser/prerender are validated separately.`);
console.log("Advantages hub/navigation unit tests passed: exact flag true/false, active contest, pending referral without action, public SEO, private noindex, no services and consent-aware analytics wiring.");
