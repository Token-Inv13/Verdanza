import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasFloatingHelpCollision } from "../src/lib/floatingHelpCollision";

const button = { left: 330, right: 378, top: 784, bottom: 832 };
assert.equal(hasFloatingHelpCollision(button, [{ left: 16, right: 374, top: 200, bottom: 500 }]), false,
  "a visible surface above the help footprint must not suppress it");
assert.equal(hasFloatingHelpCollision(button, [{ left: 16, right: 300, top: 784, bottom: 832 }]), false,
  "a card on the left must not suppress help");
assert.equal(hasFloatingHelpCollision(button, [{ left: 16, right: 374, top: 800, bottom: 1000 }]), true);
assert.equal(hasFloatingHelpCollision(button, [{ left: 0, right: 390, top: 841, bottom: 1200 }]), true,
  "ten-pixel entry margin protects the approaching footer");
const band = [{ left: 0, right: 390, top: 843, bottom: 1200 }];
assert.equal(hasFloatingHelpCollision(button, band, false), false);
assert.equal(hasFloatingHelpCollision(button, band, true), true, "two-pixel hysteresis prevents boundary flicker");
assert.equal(hasFloatingHelpCollision(button, [{ left: 0, right: 390, top: 844, bottom: 1200 }], true), false);
assert.equal(hasFloatingHelpCollision(button, [{ left: 350, right: 350, top: 800, bottom: 900 }]), false);
assert.equal(hasFloatingHelpCollision({ ...button, bottom: button.top }, band), false);
assert.equal(hasFloatingHelpCollision(button, []), false);

const source = readFileSync("src/components/FloatingContactButton.tsx", "utf8");
assert.match(source, /button\.getBoundingClientRect\(\)/);
assert.match(source, /target\.getBoundingClientRect\(\)/);
assert.match(source, /requestAnimationFrame\(measureCollision\)/);
assert.match(source, /if \(collision === collisionRef\.current\) return;/);
assert.match(source, /passive: true, capture: true/);
assert.match(source, /new ResizeObserver/);
assert.match(source, /new MutationObserver/);
assert.doesNotMatch(source, /if \(isSuppressed\) return null/);
assert.match(source, /aria-hidden=\{isSuppressed \|\| undefined\}/);
assert.match(source, /disabled=\{isSuppressed\}/);
assert.match(source, /tabIndex=\{isSuppressed \? -1 : undefined\}/);
assert.match(source, /invisible pointer-events-none/);
assert.match(source, /isOpen && !isSuppressed/);
assert.match(source, /motion-reduce:transition-none/);
console.log("Floating help collision: positive/negative geometry, safety margin, hysteresis, measurable footprint, accessibility and frame batching PASS.");
