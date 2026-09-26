import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "postcss";

const css = readFileSync("src/styles/index.css", "utf8");
const atmosphere = css.slice(css.indexOf("/* Phase 6D"));
assert.ok(atmosphere.startsWith("/* Phase 6D"));
assert.doesNotMatch(atmosphere, /url\(|filter:|will-change:|position:\s*fixed|background-position:|canvas|webgl|video/i);
assert.match(atmosphere, /pointer-events:\s*none/);
assert.match(atmosphere, /isolation:\s*isolate/);
assert.match(atmosphere, /overflow:\s*clip/);
assert.match(atmosphere, /height:\s*min\(84rem,\s*100%\)/);
assert.match(atmosphere, /@media \(min-width: 1024px\)/);
assert.match(atmosphere, /public-atmosphere-drift 36s ease-in-out infinite alternate/);
assert.match(atmosphere, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none;[\s\S]*transform: none;/);
const ast = parse(atmosphere);
let keyframes = 0;
ast.walkAtRules("keyframes", () => { keyframes += 1; });
assert.equal(keyframes, 1, "one atmospheric animation only");
ast.walkRules((rule) => {
  if (rule.parent?.type === "atrule" && rule.parent.name === "keyframes") return;
  assert.ok(rule.selector.split(",").every((selector) => selector.trim().startsWith(".public-atmosphere")), "no override of existing surfaces or global typography");
});
const layout = readFileSync("src/layouts/MainLayout.tsx", "utf8");
assert.match(layout, /<div className="public-atmosphere min-h-screen bg-ivory text-ink" data-public-atmosphere>/);
assert.doesNotMatch(layout, /canvas|webgl|requestAnimationFrame|mousemove|public-atmosphere[^\n]*onScroll/i);
console.log("Atmosphere CSS guard passed: scoped pseudo-elements, pointer-events none, bounded texture, no media/filters/fixed layer/JS motion, one slow desktop animation and reduced motion.");
