import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const adminPageSource = await readFile(
  new URL("../src/pages/admin/AdminPage.tsx", import.meta.url),
  "utf8",
);

assert.match(
  adminPageSource,
  /section === "Produits"[\s\S]*?className="mt-8 grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-\[420px_minmax\(0,1fr\)\]"/,
  "Admin Produits must use shrinkable grid tracks",
);
assert.match(
  adminPageSource,
  /<ProductForm[\s\S]*?<section className="min-w-0">[\s\S]*?<ProductTable/,
  "The product table grid item must be allowed to shrink",
);
assert.match(
  adminPageSource,
  /function ProductForm[\s\S]*?<form onSubmit=\{onSubmit\} className="admin-card min-w-0 h-fit">/,
  "The product form grid item must be allowed to shrink",
);
assert.match(
  adminPageSource,
  /function ProductTable[\s\S]*?<div className="overflow-x-auto">\s*<table className="w-full min-w-\[1040px\]/,
  "The wide products table must keep its internal horizontal scroller",
);

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <style>
          * { box-sizing: border-box; }
          html, body { margin: 0; }
          .admin-shell { display: grid; grid-template-columns: 260px minmax(0, 1fr); }
          .sidebar { width: 260px; }
          .main { min-width: 0; }
          .page { padding: 32px; }
          .products-grid {
            display: grid;
            min-width: 0;
            grid-template-columns: minmax(0, 1fr);
            gap: 24px;
          }
          .product-form, .catalog-grid-item { min-width: 0; }
          .product-form { height: 240px; border: 1px solid #ddd; }
          .catalog-card { overflow: hidden; border: 1px solid #ddd; }
          .table-scroller { overflow-x: auto; }
          table { width: 100%; min-width: 1040px; }
          @media (min-width: 1280px) {
            .products-grid { grid-template-columns: 420px minmax(0, 1fr); }
          }
          @media (max-width: 1023px) {
            .admin-shell { grid-template-columns: minmax(0, 1fr); }
            .sidebar { display: none; }
            .page { padding: 24px; }
          }
          @media (max-width: 639px) {
            .page { padding: 16px; }
          }
        </style>
      </head>
      <body>
        <div class="admin-shell">
          <aside class="sidebar"></aside>
          <main class="main">
            <div class="page">
              <div class="products-grid">
                <form class="product-form"><input aria-label="Nom du produit"></form>
                <section class="catalog-grid-item">
                  <section class="catalog-card">
                    <button type="button">Tous</button>
                    <button type="button">Actifs</button>
                    <button type="button">Inactifs</button>
                    <div class="table-scroller" tabindex="0">
                      <table><tbody><tr><td>Produit</td><td>Stock</td><td>Actions</td></tr></tbody></table>
                    </div>
                  </section>
                </section>
              </div>
            </div>
          </main>
        </div>
      </body>
    </html>
  `);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const metrics = await page.evaluate(() => {
      const root = document.documentElement;
      const scroller = document.querySelector<HTMLElement>(".table-scroller");
      const form = document.querySelector<HTMLElement>(".product-form");
      const gridItem = document.querySelector<HTMLElement>(".catalog-grid-item");
      if (!scroller || !form || !gridItem) {
        throw new Error("Missing responsive test fixture element");
      }
      return {
        pageClientWidth: root.clientWidth,
        pageScrollWidth: root.scrollWidth,
        internalClientWidth: scroller.clientWidth,
        internalScrollWidth: scroller.scrollWidth,
        formWidth: form.getBoundingClientRect().width,
        gridItemWidth: gridItem.getBoundingClientRect().width,
      };
    });

    assert.ok(
      metrics.pageScrollWidth <= metrics.pageClientWidth,
      `${viewport.width}px: the page must not scroll horizontally`,
    );
    assert.ok(
      metrics.internalScrollWidth > metrics.internalClientWidth,
      `${viewport.width}px: the products table must remain internally scrollable`,
    );
    assert.ok(metrics.formWidth <= metrics.pageClientWidth, `${viewport.width}px: form must fit`);
    assert.ok(
      metrics.gridItemWidth <= metrics.pageClientWidth,
      `${viewport.width}px: products grid item must fit`,
    );

    console.log(`${viewport.width}x${viewport.height}`, metrics);
  }
} finally {
  await browser.close();
}

console.log("Admin products responsive tests passed");
