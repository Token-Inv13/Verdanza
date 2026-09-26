import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

// Actual ProductCard + purchase helpers, isolated cart/analytics fixtures and no network.
const fixture = {
  id: "card-fixture", slug: "card-fixture", name: "Cookie Kush fixture", category: "flowers",
  price: 5, stock: 8, isActive: true, fixedPriceMode: "manual",
  fixedPriceOptions: [{ id: "seven", totalPrice: 30, quantityGrams: 7, isActive: true }],
  aromas: ["Floral", "Doux"], texture: "Compacte", image: "/fixture.webp",
  qualitySealEnabled: true, cbdRate: "10 %", thcRate: "< 0,3 %", tags: [],
};
const bundle = await build({
  stdin: { contents: `import React from "react"; import { createRoot } from "react-dom/client";
    import { BrowserRouter } from "react-router-dom";
    import { ProductCard } from "./src/components/ProductCard";
    const root = createRoot(document.getElementById("root"));
    const initial = ${JSON.stringify(fixture)}; let product = initial;
    window.calls = []; window.analytics = [];
    window.fixtureCart = { items: [],
      addItem(id) { window.calls.push(["gram", id]); window.fixtureCart.items = [...window.fixtureCart.items, {productId:id,quantity:1,purchaseMode:"gram"}]; render(); },
      addFixedPriceOption(id, option) { window.calls.push(["fixed", id, option]); window.fixtureCart.items = [...window.fixtureCart.items, {productId:id,quantity:1,purchaseMode:"fixed_price",fixedPriceOptionId:option}]; render(); }
    };
    function render() { root.render(<BrowserRouter><ProductCard product={product} priorityImage itemListId="fixture-list" itemListName="Fixtures" /></BrowserRouter>); }
    window.setFixture = ({overrides = {}, items = []}) => { product = {...initial,...overrides}; window.fixtureCart.items = items; window.calls = []; window.analytics = []; render(); };
    render();`, loader: "tsx", resolveDir: process.cwd(), sourcefile: "product-card-fixture.tsx" },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  define: { "import.meta.env": "{}" }, logLevel: "silent",
  plugins: [{ name: "isolated-card-services", setup(bundler) {
    bundler.onResolve({ filter: /(?:context\/CartContext|lib\/analytics|components\/FavoriteButton|\.\/FavoriteButton|\.\/ProductImage|\.\/QualityBadge)$/ }, (args) => ({ path: args.path, namespace: "card-fixtures" }));
    bundler.onLoad({ filter: /.*/, namespace: "card-fixtures" }, (args) => {
      const contents = args.path.endsWith("CartContext") ? "export const useCart = () => window.fixtureCart;"
        : args.path.endsWith("analytics") ? "export const trackAddToCart = (p,q) => window.analytics.push(['add',p.id,q]); export const trackSelectItem = (p,id,name) => window.analytics.push(['select',p.id,id,name]);"
        : args.path.endsWith("FavoriteButton") ? "export const FavoriteButton = () => <button aria-label='Favori fixture'>Favori</button>;"
        : args.path.endsWith("ProductImage") ? "export const ProductImage = ({variant, src, ...props}) => <img {...props} data-source={src} src='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=' />;"
        : "export const QualityBadge = () => <span data-quality-fixture>Qualité</span>;";
      return { contents, loader: "tsx", resolveDir: process.cwd() };
    });
  } }],
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const unexpected: string[] = []; const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    if (route.request().url() === "http://127.0.0.1:5199/card-fixture") {
      return route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script>${bundle.outputFiles[0].text}</script>` });
    }
    unexpected.push(route.request().url()); return route.abort();
  });
  await page.goto("http://127.0.0.1:5199/card-fixture");
  const card = page.locator("article.product-card-v2");
  await card.waitFor();
  assert.equal(await card.locator("img.product-card-v2__image").getAttribute("loading"), "eager");
  assert.equal(await card.locator("[data-quality-fixture]").count(), 0, "quality seal stays on ProductPage, not on the card");
  assert.match(await card.innerText(), /Doux/);
  assert.doesNotMatch(await card.innerText(), /Compacte|Aspect|Détail/, "secondary appearance is not rendered on cards");
  await page.evaluate("window.setFixture({overrides:{slug:'cookie-kush-indoor',aromas:['Sucré','Sirupeux','Gourmand','Rond','Intense']}})");
  await page.waitForFunction(() => document.querySelector('.product-card-v2__image')?.getAttribute('data-source')?.includes('cookie-pile.webp'));
  assert.equal(
    await card.locator("img.product-card-v2__image").getAttribute("data-source"),
    "/Fiche produit/Cookie Kush (int%C3%A9rieur)/cookie-pile.webp",
    "the card uses its dedicated distant photo",
  );
  assert.equal(await card.locator('ul[aria-label^="Profil aromatique"] li').count(), 3);
  assert.match(await card.getByRole("img", { name: "Intensité fort" }).getAttribute("aria-label") || "", /fort/);
  await page.evaluate("window.setFixture({})");
  await page.waitForFunction(() => document.querySelector('.product-card-v2__image')?.getAttribute('data-source') === '/fixture.webp');
  const format = card.getByRole("combobox");
  await card.locator("label").click();
  assert.equal(page.url(), "http://127.0.0.1:5199/card-fixture", "format label must not navigate away from the card");
  await format.selectOption("fixed-price-seven");
  assert.match(await card.innerText(), /30,00 € · 7 g/);
  assert.match(await card.innerText(), /4,29 €\/g/);
  await card.getByRole("button", { name: "Ajouter 7 g de Cookie Kush fixture au panier", exact: true }).click();
  assert.deepEqual(await page.evaluate("window.calls"), [["fixed", "card-fixture", "seven"]]);
  assert.deepEqual(await page.evaluate("window.analytics"), [["add", "card-fixture", 7]]);
  assert.equal(await format.locator('option[value="fixed-price-seven"]').isDisabled(), true);
  await card.getByRole("button", { name: "Ajouter 1 g de Cookie Kush fixture au panier", exact: true }).click();
  assert.deepEqual(await page.evaluate("window.calls"), [["fixed", "card-fixture", "seven"], ["gram", "card-fixture"]]);
  const blocked = card.getByRole("button", { name: /Stock déjà réservé/ });
  await blocked.waitFor(); assert.equal(await blocked.isDisabled(), true);
  await page.evaluate("window.setFixture({items:[{productId:'card-fixture',quantity:2,purchaseMode:'gram'}]})");
  await card.getByRole("button", { name: "Ajouter 1 g de Cookie Kush fixture au panier", exact: true }).waitFor();
  assert.equal(await format.locator('option[value="fixed-price-seven"]').isDisabled(), true);
  await page.evaluate("window.setFixture({overrides:{stock:7}})");
  await page.waitForFunction("!document.querySelector('option[value=\"fixed-price-seven\"]').disabled");
  await format.selectOption("fixed-price-seven");
  await card.getByRole("button", { name: "Ajouter 7 g de Cookie Kush fixture au panier", exact: true }).click();
  await blocked.waitFor(); assert.equal(await blocked.isDisabled(), true);
  await page.evaluate("window.setFixture({items:[{productId:'card-fixture',quantity:1,purchaseMode:'fixed_price',fixedPriceOptionId:'obsolete'}]})");
  await blocked.waitFor(); assert.equal(await blocked.isDisabled(), true);
  await page.evaluate("window.setFixture({overrides:{isActive:false}})");
  await card.getByRole("button", { name: /Indisponible/ }).waitFor();
  assert.equal(await format.count(), 0);
  assert.equal(await card.getByRole("button", { name: /Indisponible/ }).isDisabled(), true);
  await page.evaluate("window.setFixture({overrides:{stock:0}})");
  await card.getByRole("button", { name: /Rupture/ }).waitFor();
  assert.equal(await card.getByRole("button", { name: /Rupture/ }).isDisabled(), true);
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log("PASS ProductCard V2.1: dedicated media, concise aromas/intensity, no card-only appearance or seal, cart-aware formats, prices, analytics, stock and no network.");
} finally { await browser.close(); }
