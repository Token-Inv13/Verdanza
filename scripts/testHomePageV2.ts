import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getLocalProducts } from "../src/services/productsService";

const pageSource = readFileSync("src/pages/HomePage.tsx", "utf8");
const styleSource = readFileSync("src/styles/index.css", "utf8");
const floatingContactSource = readFileSync("src/components/FloatingContactButton.tsx", "utf8");
const activeProducts = getLocalProducts();

assert.equal(activeProducts.length, 7, "Homepage V2 must keep the seven-product active catalog");
assert.ok(
  activeProducts.filter((product) => product.isFeatured).length >= 3,
  "Homepage V2 requires three existing featured products without changing catalog data",
);

assert.match(pageSource, /<main className="home-page-v2" data-home-page-v2>/);
assert.match(pageSource, /Une sélection CBD pensée pour vous\./);
assert.equal(
  occurrences(pageSource, "data-home-hero-primary"),
  1,
  "the hero must expose one primary CTA",
);
assert.equal(
  occurrences(pageSource, "data-home-hero-secondary"),
  1,
  "the hero must expose one secondary CTA",
);
assert.match(pageSource, /Découvrir la boutique/);
assert.match(pageSource, /ctaId: "home_hero_shop"/);
assert.match(pageSource, /ctaId: "home_hero_postal_delivery"/);
assert.match(pageSource, /ctaId: "home_hero_local_delivery"/);

assert.match(pageSource, /\/images\/verdanza-hero-premium\.webp/);
assert.match(pageSource, /srcSet=\{heroImage\?\.srcSet\}/);
assert.match(pageSource, /sizes="\(min-width: 1024px\) 52vw, 100vw"/);
assert.match(pageSource, /fetchPriority="high"/);
assert.match(pageSource, /width=\{heroImage\?\.width \|\| 1672\}/);
assert.match(pageSource, /height=\{heroImage\?\.height \|\| 941\}/);

assert.equal(
  occurrences(pageSource, "<HomeProductFinder"),
  1,
  "the validated homepage finder must be rendered exactly once",
);
assert.equal(
  occurrences(pageSource, "data-home-reassurance-item"),
  1,
  "the reassurance items must come from one mapped data source",
);
assert.equal(homeAssuranceCount(pageSource), 3, "reassurance must stay limited to three items");
assert.equal(
  occurrences(pageSource, "featuredProducts.slice(0, 3)"),
  2,
  "analytics and rendering must use the same three featured products",
);
assert.match(pageSource, /publishedBlogArticles\.slice\(0, 2\)/);

assert.match(pageSource, /title="Verdanza CBD - Fleurs et résines CBD en ligne"/);
assert.match(pageSource, /path="\/"/);
assert.match(pageSource, /buildHomeJsonLd\(contactEmail\)/);
assert.match(pageSource, /to="\/boutique"/);
assert.match(pageSource, /to="\/blog"/);

assert.match(styleSource, /\.home-hero-v2__image\s*\{[\s\S]*?filter: none;/);
assert.match(styleSource, /home-hero-v2-in 240ms/);
assert.match(styleSource, /home-hero-v2-in 280ms 40ms/);
assert.match(
  styleSource,
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.home-hero-v2__content,[\s\S]*?animation: none;/,
);

assert.match(floatingContactSource, /"\/": \["\[data-home-product-finder\]"\]/);
assert.match(floatingContactSource, /new IntersectionObserver/);
assert.doesNotMatch(
  floatingContactSource,
  /window\.addEventListener\("scroll"/,
  "contextual floating-help suppression must not add a scroll listener",
);
assert.match(floatingContactSource, /"\/fiches-produits"/);

console.log(
  "Homepage V2 tests passed: active catalog, two-CTA hero, responsive LCP image, one finder, contextual floating-help suppression, three reassurance items, three featured products, two guides, SEO and reduced motion.",
);

function occurrences(value: string, fragment: string) {
  return value.split(fragment).length - 1;
}

function homeAssuranceCount(source: string) {
  const block = source.match(/const homeAssurances = \[([\s\S]*?)\] as const;/)?.[1] ?? "";
  return occurrences(block, "ctaId:");
}
