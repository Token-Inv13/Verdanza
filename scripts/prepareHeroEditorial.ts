import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

// Explicit local input only; no network, AI generation, filters or upscaling.
// Keep the two approved proposals intact, removing only the white separator.
const input = process.argv[2];
if (!input) throw new Error("Usage: node --import tsx scripts/prepareHeroEditorial.ts <approved-composite.png>");
const source = readFileSync(resolve(input));
const metadata = await sharp(source).metadata();
if (metadata.width !== 1774 || metadata.height !== 887 || metadata.format !== "png") {
  throw new Error("Expected the approved 1774×887 PNG composite; revalidate extraction coordinates for another source.");
}
const outputDir = resolve("public/images");
mkdirSync(outputDir, { recursive: true });
const proposals = [
  { name: "hero-editorial-desktop", left: 0, top: 0, width: 1774, height: 438 },
  { name: "hero-editorial-mobile", left: 0, top: 447, width: 1774, height: 440 },
];
for (const { name, ...crop } of proposals) {
  const extracted = sharp(source).extract(crop);
  const output = await extracted.clone().webp({ lossless: true, effort: 6 }).toBuffer();
  // Lossless masters must reproduce the original extracted RGB pixels exactly.
  const originalPixels = await extracted.clone().raw().toBuffer();
  const masterPixels = await sharp(output).raw().toBuffer();
  if (!originalPixels.equals(masterPixels)) throw new Error(`Lossless pixel mismatch for ${name}`);
  writeFileSync(resolve(outputDir, `${name}.webp`), output);
  console.log(JSON.stringify({ name, ...crop, bytes: output.length,
    compositeSha256: createHash("sha256").update(source).digest("hex") }));
}
