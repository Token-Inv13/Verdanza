import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { homeHeroImageVariant as desktop, homeHeroTabletImageVariant as tablet,
  homeHeroMobileImageVariant as mobile } from "../src/lib/generatedImageVariants";

const sources = [
  ["hero-editorial-desktop", 1774, 438],
  ["hero-editorial-mobile", 1774, 440],
] as const;
for (const [name, width, height] of sources) {
  const metadata = await sharp(resolve("public/images", `${name}.webp`)).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, width);
  assert.equal(metadata.height, height);
}
for (const [name, variant, maxWidth, ratio] of [
  ["desktop", desktop, 1034, 1034 / 438],
  ["tablet", tablet, 1774, 1774 / 438],
  ["mobile", mobile, 1774, 1774 / 440],
] as const) {
  const candidates = [...variant.srcSet.matchAll(/(\/[^, ]+) (\d+)w/g)];
  assert.ok(candidates.length >= 3);
  for (const [, url, descriptor] of candidates) {
    const path = resolve("public", url.slice(1));
    const metadata = await sharp(path).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, Number(descriptor));
    assert.ok(metadata.width <= maxWidth, `${name}: no upscale`);
    assert.ok(Math.abs(metadata.width / metadata.height! - ratio) < 0.03, `${name}: keep the approved framing`);
    assert.ok(statSync(path).size <= 160 * 1024, `${name}: variant image budget`);
  }
}
assert.equal(desktop.width, 1034);
assert.equal(desktop.height, 438);
assert.equal(tablet.width, 1280);
assert.equal(tablet.height, 316);
assert.equal(mobile.width, 1774);
assert.equal(mobile.height, 440);

const home = readFileSync("src/pages/HomePage.tsx", "utf8");
assert.equal(home.split("<picture ").length - 1, 1, "one picture, no parallel hidden images");
assert.equal(home.split('className="home-hero-v2__image"').length - 1, 1);
assert.ok(home.indexOf('media="(min-width: 900px)"') < home.indexOf('media="(min-width: 768px)"'));
assert.match(home, /\{isAgeConfirmed && \(\s*<picture/);
assert.match(home, /fetchPriority="high"/);
assert.match(home, /decoding="async"/);
const heroMarkup = home.slice(home.indexOf("<picture "), home.indexOf("</picture>") + 10);
assert.doesNotMatch(heroMarkup, /loading="lazy"/);
assert.equal(heroMarkup.split("<source").length - 1, 2);
assert.equal(heroMarkup.split("width={").length - 1, 3);
assert.equal(heroMarkup.split("height={").length - 1, 3);
const styles = readFileSync("src/styles/index.css", "utf8");
assert.match(styles, /\.home-hero-v2__image\s*\{[\s\S]*?height: auto;[\s\S]*?object-fit: contain;[\s\S]*?filter: none;/);
assert.match(styles, /@keyframes home-hero-media-in\s*\{\s*from \{ opacity: 0; \}\s*to \{ opacity: 1; \}/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.home-hero-v2__media[\s\S]*?animation: none;/);
const config = readFileSync("vite.config.ts", "utf8");
const precache = config.match(/globPatterns:\s*\[([\s\S]*?)\]/)?.[1] || "";
assert.doesNotMatch(precache, /images|webp/, "the SW must not precache both hero masters");
console.log("Hero editorial tests passed: two approved WebP masters, ten non-upscaled variants, picture order/dimensions, one image, age gate, contain framing, fade-only/reduced motion and no dual SW precache.");
