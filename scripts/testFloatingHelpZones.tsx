import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChoiceOption, SelectorStep } from "../src/components/product-discovery/DiscoverySelectorControls";
import { ProductGallery, ProductPurchasePanel } from "../src/components/product/ProductPageSections";
import { normalizeProductImages } from "../src/lib/productImages";
import { resolveProductPurchaseOptions } from "../src/lib/productPurchaseOptions";
import { getLocalProducts } from "../src/services/productsService";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const noop = () => {};
const markedTags = (html: string) => html.match(/<[^>]+data-floating-help-suppress[^>]*>/g) || [];
const shop = readFileSync("src/components/shop/ShopProductSelector.tsx", "utf8");
assert.doesNotMatch(shop, /<section[^>]+data-floating-help-suppress/, "Shop envelopes must not be protected");
for (const step of [1, 2, 3]) assert.ok(shop.includes(`floatingHelpProtected={openStep === ${step}}`),
  "closed accordion choices must not create ghost surfaces");
assert.match(shop, /data-shop-selector-edit\s+data-floating-help-suppress="selector-edit"/);
assert.match(shop, /data-shop-selector-reset\s+data-floating-help-suppress="selector-reset"/);
for (const floatingHelpProtected of [false, true]) {
  const tags = markedTags(renderToStaticMarkup(<ChoiceOption label="Choix" selected={false} onSelect={noop}
    dataValue="test" floatingHelpProtected={floatingHelpProtected} />));
  assert.equal(tags.length, floatingHelpProtected ? 1 : 0);
  assert.ok(tags.every((tag) => tag.startsWith("<button")));
}
assert.equal(markedTags(renderToStaticMarkup(<ChoiceOption label="Choix partagé" selected={false} onSelect={noop} dataValue="test" />)).length, 0);
assert.equal(markedTags(renderToStaticMarkup(<SelectorStep number={1} title="Étape partagée" summary="" open completed={false} onToggle={noop}>Texte</SelectorStep>)).length, 0,
  "shared controls keep other pages unchanged by default");

const product = getLocalProducts().find((p) => p.slug === "mandarine-cbd")!;
assert.ok(product);
const options = resolveProductPurchaseOptions(product, []);
const panel = renderToStaticMarkup(<ProductPurchasePanel product={product} purchaseOptions={options}
  availabilityLabel="Rupture de stock" stockLabel="Rupture de stock" onSelectPurchaseOption={noop} onAddToCart={noop} />);
assert.equal(markedTags(panel).length, options.length + 1);
assert.ok(markedTags(panel).every((tag) => tag.startsWith("<button")), "purchase panel protects formats and cart, not its envelope");
const images = normalizeProductImages(product);
const gallery = renderToStaticMarkup(<ProductGallery product={product} images={images} selectedImage={images[0]} onSelectImage={noop} />);
assert.equal(markedTags(gallery).length, images.length > 1 ? images.length : 0);
assert.ok(markedTags(gallery).every((tag) => tag.startsWith("<button")), "gallery protects thumbnails only");

const blog = readFileSync("src/components/BlogCard.tsx", "utf8");
assert.equal(blog.match(/data-floating-help-suppress/g)?.length, 2);
assert.match(blog, /<Link to=\{blogArticlePath\(article\)\} data-floating-help-suppress="blog-editorial">\{article.title\}/);
assert.doesNotMatch(blog, /<div[^>]+data-floating-help-suppress/);
const card = readFileSync("src/components/ProductCard.tsx", "utf8");
assert.equal(card.match(/data-floating-help-suppress/g)?.length, 2);
assert.match(card, /data-floating-help-suppress="product-format"/);
assert.match(card, /data-floating-help-suppress="product-cart"/);
assert.doesNotMatch(card, /<div[^>]+data-floating-help-suppress/);
assert.match(readFileSync("src/layouts/MainLayout.tsx", "utf8"), /<footer[^>]+data-floating-help-suppress="footer"/);
assert.match(readFileSync("src/pages/ProductPage.tsx", "utf8"), /data-product-sticky-purchase\s+data-floating-help-suppress/);
console.log("Narrow help zones PASS: real Blog links, active Shop controls, card formats/cart, product formats/cart/thumbnails; footer/sticky preserved.");
