import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build, type Rollup } from "vite";
import { chromium, type Locator } from "playwright";
import type {} from "./fixtures/adminV3Fixture";

const fixturePath = fileURLToPath(new URL("./fixtures/adminV3Fixture.tsx", import.meta.url));
const mocksPath = fileURLToPath(new URL("./fixtures/adminV3Mocks.ts", import.meta.url)).replaceAll("\\", "/");
const bundle = await build({
  configFile: false, envFile: false, publicDir: false, logLevel: "error",
  esbuild: { jsx: "automatic" },
  define: { "process.env.NODE_ENV": JSON.stringify("development"), "import.meta.env": "{}" },
  plugins: [{ name: "admin-v3-local-mocks", enforce: "pre", resolveId(source) {
    if (/\/(productsService|productImagesService|useAdminData|AuthContext|firebase)(\.[jt]sx?)?$/.test(source)) return mocksPath;
  } }],
  build: { write: false, minify: false, lib: { entry: fixturePath, name: "AdminV3Fixture", formats: ["iife"] },
    rollupOptions: { output: { inlineDynamicImports: true } } },
});
const output = (Array.isArray(bundle) ? bundle[0] : bundle) as Rollup.RollupOutput;
const script = output.output.find((entry) => entry.type === "chunk");
assert.ok(script?.type === "chunk");
const css = output.output.filter((entry) => entry.type === "asset" && entry.fileName.endsWith(".css"))
  .map((entry) => entry.type === "asset" ? String(entry.source) : "").join("\n");
assert.ok(css.includes("100dvh"), "The mobile dialog must use dynamic viewport height");

const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
const unexpectedRequests: string[] = [];
let checks = 0;
function passed(name: string) { checks += 1; console.log(`PASS ${name}`); }
try {
  // One fixed mobile viewport, no server, no page.goto and no remote services.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "admin-v3-fixture.test" || !/^\/(brand|fonts|images)\//.test(url.pathname)) {
      unexpectedRequests.push(url.href);
    }
    await route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
  });
  await page.setContent('<!doctype html><html><head><base href="http://admin-v3-fixture.test/"></head><body style="overflow:auto"><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css });
  await page.evaluate(() => {
    window.fetch = async () => { throw new Error("Unexpected fixture fetch"); };
    XMLHttpRequest.prototype.open = () => { throw new Error("Unexpected fixture XHR"); };
  });
  await page.addScriptTag({ content: script.code });
  async function mode(value: "dialog" | "confirm" | "dashboard" | "products" | "stocks" | "comptabilite" | "parametres" | "sidebar") {
    await page.evaluate((next) => window.renderAdminV3(next), value);
  }
  async function visible(locator: Locator) { assert.ok(await locator.isVisible()); }
  async function focused(locator: Locator) { assert.ok(await locator.evaluate((element) => document.activeElement === element)); }
  async function overlay(dialog: Locator) { await dialog.locator("..").click({ position: { x: 1, y: 1 } }); }
  async function closeDiscard() {
    await page.getByRole("button", { name: "Abandonner les modifications", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
  }

  await mode("dialog");
  const opener = page.getByRole("button", { name: "Ouvrir dialogue", exact: true });
  await opener.click();
  let dialog = page.getByRole("dialog", { name: "Dialogue témoin", exact: true });
  await visible(dialog);
  assert.equal(await dialog.getAttribute("aria-modal"), "true");
  const desc = await dialog.getAttribute("aria-describedby");
  assert.equal(await page.locator(`[id='${desc}']`).textContent(), "Description accessible");
  await focused(dialog.getByLabel("Premier champ"));
  assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
  assert.ok(await page.locator("#root").evaluate((element) => (element as HTMLElement).inert));
  await dialog.getByRole("button", { name: "Fin", exact: true }).focus();
  await page.keyboard.press("Tab");
  await focused(dialog.getByRole("button", { name: "Fermer la fenêtre" }));
  await page.keyboard.press("Shift+Tab");
  await focused(dialog.getByRole("button", { name: "Fin", exact: true }));
  const dimensions = await dialog.evaluate((element) => {
    const panel = element.getBoundingClientRect();
    const body = element.children[1] as HTMLElement;
    const footer = element.lastElementChild!.getBoundingClientRect();
    return { width: panel.width, height: panel.height, innerScroll: body.scrollHeight > body.clientHeight, footerBottom: footer.bottom, viewport: innerHeight, pageWidth: document.documentElement.scrollWidth };
  });
  assert.ok(dimensions.width <= 390 && dimensions.height <= 844 && dimensions.innerScroll && dimensions.footerBottom < 844 && dimensions.pageWidth <= 390);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await focused(opener);
  assert.equal(await page.evaluate(() => document.body.style.overflow), "auto");
  assert.equal(await page.locator("#root").evaluate((element) => (element as HTMLElement).inert), false);
  passed("dialog: accessible title/description, initial/trapped/restored focus, scroll lock, mobile dimensions, stable footer and Escape");

  await opener.click();
  await overlay(dialog);
  await dialog.waitFor({ state: "detached" });
  await page.getByLabel("Fermer par overlay").uncheck();
  await opener.click();
  await overlay(dialog);
  await visible(dialog);
  await dialog.getByRole("button", { name: "Fermer la fenêtre" }).click();
  await page.getByLabel("Fermer par overlay").check();
  await opener.click();
  await dialog.getByRole("button", { name: "Opération critique" }).click();
  await page.keyboard.press("Escape");
  await overlay(dialog);
  assert.ok(await dialog.getByRole("button", { name: "Fermer la fenêtre" }).isDisabled());
  assert.equal(await dialog.getAttribute("aria-busy"), "true");
  await visible(dialog);
  await dialog.getByRole("button", { name: "Opération critique" }).click();
  await dialog.getByRole("button", { name: "Fermer la fenêtre" }).click();
  await dialog.waitFor({ state: "detached" });
  passed("dialog: configurable overlay and critical operation block accidental closing");

  await mode("confirm");
  await page.getByRole("button", { name: "Ouvrir confirmation" }).click();
  dialog = page.getByRole("dialog", { name: "Confirmation témoin" });
  await focused(dialog.getByRole("button", { name: "Annuler", exact: true }));
  await visible(dialog.getByText("Récapitulatif témoin"));
  await visible(dialog.getByText("Avertissement témoin"));
  await dialog.getByLabel("Champ métier").fill("Contenu métier");
  await page.evaluate(() => { window.adminV3.blocked = "confirm"; });
  await dialog.getByRole("button", { name: "Confirmer et continuer" }).evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  assert.equal(await page.evaluate(() => window.adminV3.confirmations), 1);
  assert.ok(await dialog.getByRole("button", { name: "Annuler", exact: true }).isDisabled());
  assert.ok(await dialog.getByLabel("Champ métier").isDisabled());
  await page.keyboard.press("Escape");
  await visible(dialog);
  await page.evaluate(() => { window.adminV3.failure = "Erreur témoin"; window.adminV3.release(); });
  await dialog.getByRole("alert").waitFor();
  assert.equal(await dialog.getByRole("alert").textContent(), "Erreur témoin");
  await page.evaluate(() => { window.adminV3.failure = ""; window.adminV3.blocked = ""; });
  await dialog.getByRole("button", { name: "Confirmer et continuer" }).click();
  await dialog.waitFor({ state: "detached" });
  passed("confirmation: editable fields, summary, warning, cancellation focus, async double click guard, error and retry");

  await mode("products");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.getByLabel("Nom", { exact: true }).count(), 0);
  const add = page.getByRole("button", { name: "Ajouter un produit", exact: true });
  await add.click();
  dialog = page.getByRole("dialog", { name: "Ajouter un produit", exact: true });
  assert.ok(await dialog.getByLabel("Actif", { exact: true }).isChecked());
  assert.equal(await dialog.getByLabel("Prix / g").inputValue(), "0");
  await dialog.getByLabel("Nom", { exact: true }).fill("Création test");
  await dialog.getByLabel("Prix / g").fill("5");
  await dialog.getByLabel("Stock", { exact: true }).fill("30");
  await page.evaluate(() => { window.adminV3.blocked = "save"; });
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  assert.equal(await page.evaluate(() => window.adminV3.saved.length), 1);
  await page.keyboard.press("Escape");
  await overlay(dialog);
  await visible(dialog);
  assert.ok(await dialog.getByRole("button", { name: "Fermer la fenêtre" }).isDisabled());
  assert.equal(await page.evaluate(() => window.adminV3.saved.length), 1);
  const created = await page.evaluate(() => window.adminV3.saved[0]);
  assert.equal(created.slug, "creation-test");
  assert.equal(created.isActive, true);
  assert.equal(created.isFeatured, false);
  assert.equal(created.fixedPriceMode, "automatic");
  assert.equal(created.stock, 30);
  await page.evaluate(() => { window.adminV3.blocked = ""; window.adminV3.release(); });
  await dialog.waitFor({ state: "detached" });
  await focused(add);
  passed("products: list first, create via dialog, unchanged defaults and slug/stock normalization, single save and pending block");

  const row = page.getByRole("row").filter({ hasText: "Produit témoin" });
  const edit = row.getByRole("button", { name: "Modifier", exact: true });
  await edit.click();
  dialog = page.getByRole("dialog", { name: "Modifier le produit", exact: true });
  const values: Record<string, string> = {
    Nom: "Produit témoin", Slug: "fiche-test", Categorie: "resins", "Prix / g": "6", "Prix promo": "7", Stock: "20", "Seuil faible": "2",
    "Description courte": "Description témoin", "Description longue": "Description longue témoin", CBD: "50 %", CBG: "1 %", THC: "< 0,3 %",
    Origine: "France", Culture: "Autre", "Aromes, separes par virgule": "Terre", "Tags, separes par virgule": "Témoin",
    "SEO title": "Titre témoin", "SEO description": "SEO témoin", Identifiant: "format-test", Libelle: "Format témoin", "Prix total": "22", Grammes: "4", "Texte alternatif": "Image témoin",
  };
  for (const [label, value] of Object.entries(values)) {
    const field = label === "Categorie" ? dialog.getByRole("combobox") : dialog.getByLabel(label, { exact: true });
    assert.equal(await field.inputValue(), value, label);
  }
  assert.equal(await dialog.getByLabel("Actif", { exact: true }).last().isChecked(), false);
  assert.ok(await dialog.getByLabel("Mis en avant", { exact: true }).isChecked());
  assert.ok(await dialog.getByLabel("Sceau qualité Verdanza", { exact: false }).isChecked());
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const saved = await page.evaluate(() => window.adminV3.saved[1]);
  const original = await page.evaluate(() => window.adminV3Product);
  assert.deepEqual(saved, original, "Editing and saving unchanged must preserve every field");
  await focused(edit);
  passed("products: edit retains all fields, images, manual fixed prices and publication flags; unchanged save payload");

  for (const close of ["overlay", "escape", "button"] as const) {
    await edit.click();
    await dialog.getByLabel("Nom", { exact: true }).fill(`Modification ${close}`);
    if (close === "overlay") await overlay(dialog);
    else if (close === "escape") await page.keyboard.press("Escape");
    else await dialog.getByRole("button", { name: "Fermer la fenêtre" }).click();
    const confirm = page.getByRole("dialog", { name: "Abandonner les modifications ?", exact: true });
    await visible(confirm);
    assert.equal(await page.getByRole("dialog").count(), 1, "Only the top dialog is accessible");
    assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
    await page.keyboard.press("Escape");
    await confirm.waitFor({ state: "detached" });
    await visible(dialog);
    assert.equal(await dialog.getByLabel("Nom", { exact: true }).inputValue(), `Modification ${close}`);
    assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
    await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
    await closeDiscard();
    await focused(edit);
  }
  assert.equal(await page.evaluate(() => window.adminV3.saved.length), 2);
  passed("products: overlay, Escape and close prompt before discard; nested focus/scroll locks and cancel preserve edits");

  await edit.click();
  await dialog.getByLabel("Grammes", { exact: true }).fill("5");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await dialog.getByRole("alert").waitFor();
  assert.match(await dialog.getByRole("alert").textContent() || "", /Formats prix fixe invalides/);
  assert.equal(await page.evaluate(() => window.adminV3.saved.length), 2);
  await dialog.getByLabel("Grammes", { exact: true }).fill("4");
  await dialog.getByLabel("Texte alternatif", { exact: true }).fill(" ");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  assert.match(await dialog.getByRole("alert").textContent() || "", /alternatif requis/);
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
  await closeDiscard();
  passed("products: existing fixed price and image validation still block invalid save");

  await edit.click();
  await page.evaluate(() => { window.adminV3.blocked = "upload"; });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "fixture.webp", mimeType: "image/webp", buffer: Buffer.from("fixture") });
  await page.keyboard.press("Escape");
  await visible(dialog);
  assert.ok(await dialog.getByRole("button", { name: "Enregistrer", exact: true }).isDisabled());
  await page.evaluate(() => { window.adminV3.blocked = ""; window.adminV3.release(); });
  await dialog.getByLabel("Texte alternatif", { exact: true }).nth(1).waitFor();
  await dialog.getByRole("button", { name: "Choisir comme principale", exact: true }).nth(1).click();
  await dialog.getByRole("button", { name: "Monter", exact: true }).nth(1).click();
  await dialog.getByRole("button", { name: "Supprimer l'image", exact: true }).nth(1).click();
  assert.deepEqual(await page.evaluate(() => window.adminV3.removed), [], "Storage cleanup must remain deferred until save");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const uploadedSave = await page.evaluate(() => window.adminV3.saved[2]);
  assert.equal(uploadedSave.images?.length, 1);
  assert.equal(uploadedSave.images?.[0].isPrimary, true);
  assert.match(uploadedSave.images?.[0].id || "", /upload-/);
  assert.deepEqual(await page.evaluate(() => window.adminV3.removed), ["products/admin-v3-fixture/one.webp"]);
  passed("products: safe mock image upload, pending lock, primary/reorder/remove and Storage cleanup after save");

  await edit.click();
  const deleteButton = dialog.getByRole("button", { name: "Supprimer definitivement le produit", exact: true });
  assert.ok(await deleteButton.isDisabled());
  await dialog.getByLabel("Saisissez VDZ-RES-ABCDEF pour confirmer", { exact: true }).fill("incorrect");
  assert.ok(await deleteButton.isDisabled());
  await dialog.getByLabel("Saisissez VDZ-RES-ABCDEF pour confirmer", { exact: true }).fill("VDZ-RES-ABCDEF");
  await page.evaluate(() => { window.adminV3.blocked = "delete"; window.adminV3.failure = "Dépendance bloquante"; });
  await deleteButton.evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await page.keyboard.press("Escape");
  await visible(dialog);
  assert.equal(await page.evaluate(() => window.adminV3.deleted.length), 1);
  await page.evaluate(() => { window.adminV3.blocked = ""; window.adminV3.release(); });
  await dialog.getByRole("alert").waitFor();
  assert.equal(await dialog.getByRole("alert").textContent(), "Dépendance bloquante");
  await page.evaluate(() => { window.adminV3.failure = ""; });
  await deleteButton.click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => window.adminV3.deleted[1]), { productId: "admin-v3-fixture", confirmationReference: "VDZ-RES-ABCDEF" });
  await page.getByRole("row").filter({ hasText: "Sans référence" }).getByRole("button", { name: "Modifier", exact: true }).click();
  assert.ok(await deleteButton.isDisabled());
  await dialog.getByRole("button", { name: "Fermer la fenêtre" }).click();
  passed("products: exact deletion reference, absent reference block, server error preserved, single critical action and retry");

  await edit.click();
  await page.evaluate(() => { window.adminV3.failure = "Sauvegarde refusée"; });
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(await dialog.getByLabel("Nom", { exact: true }).inputValue(), "Produit témoin");
  assert.equal(await dialog.getByRole("alert").textContent(), "Sauvegarde refusée");
  await page.evaluate(() => { window.adminV3.failure = ""; window.adminV3.refreshFailure = true; });
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await visible(page.getByText("Produit enregistre. Actualisation de la liste impossible ; rafraichissez les donnees.", { exact: true }));
  await page.evaluate(() => { window.adminV3.refreshFailure = false; });
  await row.getByRole("button", { name: "Inactif", exact: true }).click();
  assert.equal(await page.evaluate(() => window.adminV3.flags.length), 1);
  assert.equal(await page.evaluate(() => window.adminV3.stocks.length), 0);
  passed("products: save failure preserves fields, refresh failure distinguished after success, existing table publication service unchanged");

  await mode("sidebar");
  const nav = page.locator('nav[aria-label="Navigation administration"]');
  await page.getByRole("button", { name: "Ouvrir le menu admin", exact: true }).click();
  const marketing = nav.getByRole("button", { name: "Marketing", exact: true });
  const community = nav.getByRole("button", { name: "Communauté", exact: true });
  assert.equal(await marketing.getAttribute("aria-expanded"), "true");
  assert.equal(await community.getAttribute("aria-expanded"), "false");
  assert.equal(await nav.getByRole("link", { name: "Promotions", exact: true }).getAttribute("aria-current"), "page");
  assert.equal(await nav.locator('[aria-current="page"]').count(), 1);
  await marketing.click();
  assert.equal(await marketing.getAttribute("aria-expanded"), "false");
  await community.click();
  await marketing.click();
  for (const title of ["Tableau de bord", "Catalogue", "Commandes", "Marketing", "Communauté", "Contenu", "Gestion", "Paramètres"]) {
    const group = nav.getByRole("button", { name: title, exact: true });
    if (await group.getAttribute("aria-expanded") === "false") await group.click();
  }
  const expected = ["/admin", "/admin/analytics", "/admin/selection", "/admin/produits", "/admin/stocks", "/admin/commandes", "/admin/clients", "/admin/livraisons", "/admin/marketing", "/admin/bannieres", "/admin/coupons", "/admin/concours", "/admin/avis", "/admin/commentaires-blog", "/admin/favoris", "/admin/archives", "/admin/comptabilite", "/admin/comptabilite?tab=achats", "/admin/comptabilite?tab=couts", "/admin/factures", "/admin/facturation", "/admin/parametres"];
  assert.deepEqual(await nav.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href"))), expected);
  await community.click();
  // Route change opens a collapsed active group, including after it was manually closed.
  await page.getByRole("button", { name: "Simuler lien avis" }).evaluate((button) => (button as HTMLButtonElement).click());
  await nav.getByRole("link", { name: "Avis clients", exact: true }).waitFor();
  assert.equal(await community.getAttribute("aria-expanded"), "true");
  assert.equal(await nav.getByRole("link", { name: "Avis clients", exact: true }).getAttribute("aria-current"), "page");
  await nav.getByRole("link", { name: "Produits", exact: true }).click();
  await visible(page.getByRole("button", { name: "Ouvrir le menu admin", exact: true }));
  assert.equal(await nav.isVisible(), false);
  passed("sidebar: all routes and group ordering, exact active link, automatic open, manual collapse and mobile close on navigation");

  for (const [label, destination] of [
    ["Achats fournisseurs", "/admin/comptabilite?tab=achats"], ["Coûts manuels", "/admin/comptabilite?tab=couts"],
    ["Factures", "/admin/comptabilite?tab=factures"], ["Facturation", "/admin/comptabilite?tab=facturation"],
    ["Comptabilité", "/admin/comptabilite"],
  ]) {
    await page.getByRole("button", { name: "Ouvrir le menu admin", exact: true }).click();
    await nav.getByRole("link", { name: label, exact: true }).click();
    await page.waitForFunction((value) => document.querySelector('[data-testid="location"]')?.textContent === value, destination);
    assert.equal(await nav.getByRole("link", { name: label, exact: true, includeHidden: true }).getAttribute("aria-current"), "page");
    assert.equal(await nav.locator('[aria-current="page"]').count(), 1);
  }
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /path="factures"[^\n]*Navigate to="\/admin\/comptabilite\?tab=factures"/);
  assert.match(appSource, /path="facturation"[\s\S]*?Navigate to="\/admin\/comptabilite\?tab=facturation"/);
  passed("sidebar: existing accounting tabs and redirects retained, only the current tab is active");
  for (const section of ["dashboard", "products", "stocks", "comptabilite"] as const) {
    await mode(section);
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 1280, height: 720 }, { width: 820, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => ({ pageWidth: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert.ok(layout.pageWidth <= layout.viewport, `${section} déborde à ${viewport.width}px (${layout.pageWidth}px)`);
      if (process.env.ADMIN_V3_SHOTS_DIR && section === "dashboard" && [1440, 390].includes(viewport.width))
        await page.screenshot({ path: path.join(process.env.ADMIN_V3_SHOTS_DIR, `dashboard-after-${viewport.width}.png`) });
    }
    passed(`${section}: 1440, 1280, 820 et 390 sans débordement horizontal`);
  }
  await page.evaluate(() => { window.adminV3.readFailure = "products"; });
  await mode("dashboard");
  await page.getByText("Données indisponibles.", { exact: true }).waitFor();
  if (process.env.ADMIN_V3_SHOTS_DIR) await page.screenshot({ path: path.join(process.env.ADMIN_V3_SHOTS_DIR, "dashboard-read-error-390.png") });
  assert.equal(await page.getByText("0 produit", { exact: false }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Ajouter un produit" }).count(), 0);
  await page.evaluate(() => { window.adminV3.recoverOnRefresh = true; });
  await page.getByRole("button", { name: "Réessayer la lecture" }).click();
  await page.getByText("Données indisponibles.", { exact: true }).waitFor({ state: "detached" });
  passed("F2 : lecture principale refusée, aucun faux zéro ni mutation, retry rétablit le Dashboard");
  await page.evaluate(() => { window.adminV3.readFailure = "delivery"; });
  await mode("dashboard");
  await page.getByText("Zones de livraison indisponibles.").waitFor();
  assert.ok(await page.getByText("Vue rapide", { exact: true }).isVisible());
  assert.ok(await page.getByRole("button", { name: "Recharger les données" }).isVisible());
  passed("F2 : lecture secondaire refusée, Dashboard conservé avec warning et retry");
  await page.evaluate(() => { window.adminV3.readFailure = ""; window.adminV3.emptyReal = true; });
  await mode("products");
  assert.equal(await page.getByText("Données indisponibles.", { exact: true }).count(), 0);
  assert.ok(await page.getByText("Aucun produit pour le moment.").isVisible());
  passed("F2 : vide serveur confirmé distinct de l'erreur");
  assert.deepEqual(unexpectedRequests, [], "No remote requests or non-fixture endpoints permitted");
  assert.deepEqual(errors, [], "No uncaught component errors");
} finally {
  await browser.close();
}
console.log(`Admin V3: ${checks} scenarios passed, local mocks only; four viewports checked for Dashboard, Products, Stocks and Accounting. Settings has its own UI suite.`);
