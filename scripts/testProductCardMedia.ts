import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { productCardImageVariants, productImageVariants } from "../src/lib/generatedImageVariants";
import { normalizeProductImages } from "../src/lib/productImages";
import { productCardMediaBySlug, resolveProductCardMedia } from "../src/lib/productCardMedia";
import { getLocalProducts } from "../src/services/productsService";

const activeProducts = getLocalProducts();
const blueDream = getLocalProducts(false).find((product) => product.slug === "blue-dream-cbd");
assert.ok(blueDream, "the Firestore-published Blue Dream needs a local card source");
const preparedSlugs = ["skittlez-plus", "black-afghan", "ice-o-lator", "mousseux-skywalker"];
const preparedProducts = preparedSlugs.map((slug) => {
  const product = getLocalProducts(false).find((item) => item.slug === slug);
  assert.ok(product, `${slug}: prepared card source is missing`);
  assert.equal(product.isActive, true, `${slug}: product must be active in the commercial catalogue`);
  return product;
});
assert.equal(preparedProducts.length, 4);
const cardProducts = [...activeProducts, blueDream];
// Validate the committed pipeline rather than a temporary image-generation report.
const generator = readFileSync("scripts/generateImages.ts", "utf8");
const cropDeclaration = generator.match(/const goldenStaticCardCrop: ImageCrop = \{ left: (\d+), top: (\d+), width: (\d+), height: (\d+) \}/);
assert.ok(cropDeclaration, "Golden Static crop must be declared in the image pipeline");
const goldenCrop = { left: Number(cropDeclaration[1]), top: Number(cropDeclaration[2]),
  width: Number(cropDeclaration[3]), height: Number(cropDeclaration[4]) };
assert.equal(activeProducts.length, 11, "the eleven active products need card media");
assert.deepEqual(
  Object.keys(productCardMediaBySlug).sort(),
  [...activeProducts.filter((product) => !preparedSlugs.includes(product.slug)), blueDream].map((product) => product.slug).sort(),
  "existing card-media choices remain unchanged",
);

function publicFile(url: string) {
  return resolve("public", decodeURIComponent(url).replace(/^\//, ""));
}

for (const product of cardProducts) {
  const media = resolveProductCardMedia(product);
  assert.ok(media.src && media.alt, `${product.name}: a photo and useful alt text are required`);
  assert.ok(existsSync(publicFile(media.src)), `${product.name}: card source is missing`);
  const source = await sharp(publicFile(media.src)).metadata();
  assert.equal(source.format, "webp", `${product.name}: card source must be WebP`);
  assert.ok((source.width || 0) >= 600 && (source.height || 0) >= 600, `${product.name}: source is too small`);

  const optimized = productCardImageVariants[media.src] || productImageVariants[media.src]?.card;
  assert.ok(optimized, `${product.name}: responsive card variant is missing`);
  assert.ok(optimized.width && optimized.height && optimized.sizes, `${product.name}: dimensions/sizes are missing`);
  assert.ok(optimized.srcSet.includes("320w") && optimized.srcSet.includes(`${Math.min(640, source.width || 0)}w`),
    `${product.name}: responsive srcSet is incomplete`);
  for (const candidate of optimized.srcSet.split(", ")) {
    const [url, descriptor] = candidate.split(" ");
    const file = publicFile(url);
    assert.ok(existsSync(file), `${product.name}: missing ${url}`);
    const metadata = await sharp(file).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, Number.parseInt(descriptor, 10), `${product.name}: wrong width descriptor`);
    assert.ok((metadata.width || 0) <= (source.width || 0), `${product.name}: image must not be enlarged`);
  }

  const gallery = normalizeProductImages(product);
  assert.equal(gallery[0]?.url, product.image, `${product.name}: ProductPage primary image must not change`);
  assert.ok(gallery.some((image) => image.url === media.src), `${product.name}: card photo must come from the existing gallery`);
  if (product.slug === "blue-dream-cbd") {
    assert.equal(media.src, "/Fiche produit/Blue%20Dream/bl.webp");
    assert.notEqual(media.src, product.image, "the macro must remain ProductPage-only");
  }
  if (media.src !== product.image) {
    assert.ok(
      statSync(publicFile(optimized.src)).size < statSync(publicFile(productImageVariants[product.image].card.src)).size,
      `${product.name}: dedicated card photo must not increase the 640px payload`,
    );
  }
  if (product.slug === "golden-static") {
    const crop = goldenCrop;
    assert.ok(crop, "Golden Static needs a dedicated card-only crop");
    assert.deepEqual(crop, { left: 0, top: 67, width: 713, height: 615 });
    assert.equal(crop.width, source.width, "no horizontal product pixels may be cropped");
    const { data, info } = await sharp(publicFile(media.src)).raw().toBuffer({ resolveWithObject: true });
    let top = info.height;
    let bottom = -1;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const offset = (y * info.width + x) * info.channels;
        if (data[offset] < 200 && data[offset + 1] < 200 && data[offset + 2] < 200) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    }
    assert.ok(top - crop.top > 150 && crop.top + crop.height - bottom > 150,
      "Golden Static and its natural shadow must keep breathing room above and below");
    assert.equal(optimized.width, 640);
    assert.equal(optimized.height, 552);
  }
}

console.log("PASS ProductCard media: eight existing and four newly active WebP sources, responsive variants without upscale, original galleries, and Golden Static fully in frame.");
