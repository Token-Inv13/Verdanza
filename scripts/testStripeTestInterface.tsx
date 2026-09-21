import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { deliveryZones } from "../src/data/deliveryZones.js";

// Real DOM and shared checkout, all HTTP intercepted before any network access.
const bundle = await build({
  stdin: { contents: `import React from "react"; import { createRoot } from "react-dom/client";
    import { BrowserRouter } from "react-router-dom";
    import { StripeTestApp } from "./src/stripe-test/StripeTestApp";
    createRoot(document.getElementById("root")).render(<BrowserRouter><StripeTestApp /></BrowserRouter>);`,
    loader: "tsx", resolveDir: process.cwd(), sourcefile: "stripe-dom-fixture.tsx" },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  define: { "import.meta.env": JSON.stringify({ DEV: true }) }, logLevel: "silent",
});
const products = [
  { id: "gram-fixture", name: "Golden Static fixture", price: 5.5, stock: 100, category: "resins", isActive: true, fixedPriceMode: "disabled" },
  { id: "fixed-fixture", name: "Cookie Kush Indoor fixture", price: 5, stock: 100, category: "flowers", isActive: true, fixedPriceMode: "manual",
    fixedPriceOptions: [{ id: "fixed-30-7g", totalPrice: 30, quantityGrams: 7, isActive: true, source: "manual" }] },
];
const origin = "http://127.0.0.1:5195";
const prefix = "verdanza:stripe-checkout-test:v1:";
const browser = await chromium.launch({ headless: true });
try {
  for (const local of [false, true]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    const unexpected: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let submissions = 0; let statusReads = 0; let paid = false;
    let submitted: Record<string, unknown> | null = null;
    let lastQuote = 0;
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === "https://checkout.stripe.com") {
        return route.fulfill({ contentType: "text/html", body: "Stripe response simulated; no payment sent." });
      }
      if (url.origin !== origin) { unexpected.push(url.origin); return route.abort(); }
      if (url.pathname.startsWith("/api/stripe-test/")) {
        const input = route.request().postDataJSON() ?? {};
        let result: unknown;
        if (url.pathname.endsWith("/catalog")) result = { products };
        else if (url.pathname.endsWith("/delivery-zones")) result = { zones: deliveryZones.map((zone) => ({ ...zone, isActive: true, isOpen: true, status: "open" })) };
        else if (url.pathname.endsWith("/quote")) {
          const subtotal = local ? 30 : 16.5;
          const fee = input.deliveryMethod === "local_express" ? 0 : 5.49;
          lastQuote = Math.round((subtotal + fee) * 100) / 100;
          result = { subtotal, subtotalBeforeDiscount: subtotal, deliveryFee: fee, deliveryFeeStatus: "configured",
            discountAmount: 0, total: lastQuote, promoApplied: false, appliedPromotions: [], promotionProgressMessages: [], giftPromotions: [] };
        } else if (url.pathname.endsWith("/checkout")) {
          submissions++; submitted = input;
          await new Promise((resolve) => setTimeout(resolve, 100));
          result = { url: "https://checkout.stripe.com/c/pay/cs_test_fixture" };
        } else if (url.pathname.endsWith("/status")) {
          statusReads++;
          result = { orderId: input.orderId, paymentStatus: paid ? "paid" : "payment_pending", amountCents: local ? 3000 : 2199, paidTransitions: paid ? 1 : 0 };
        } else { unexpected.push(url.pathname); return route.abort(); }
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
      }
      if (url.pathname.startsWith("/stripe-test")) {
        return route.fulfill({ contentType: "text/html", body: `<html><body><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>` });
      }
      unexpected.push(url.pathname); return route.abort();
    });
    await page.goto(`${origin}/stripe-test`);
    await page.evaluate(() => {
      localStorage.setItem("verdanza-cart", "public-cart-sentinel");
      sessionStorage.setItem("verdanza:lastOrderSummary", "public-summary-sentinel");
    });
    const input = local ? page.getByRole("spinbutton", { name: "Cookie Kush Indoor fixture format fixed-30-7g" })
      : page.getByRole("spinbutton", { name: "Golden Static fixture grammes" });
    await input.fill(local ? "1" : "3");
    await page.getByRole("link", { name: "Passer au checkout test" }).click();
    if (local) {
      await page.getByRole("combobox", { name: "Adresse", exact: true }).fill("1 rue du Test local");
      await page.getByRole("option", { name: /1 rue du Test local/ }).click();
      await page.getByRole("radio", { name: /Livraison locale Aix/ }).check();
    }
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Valider ma commande", exact: true }).waitFor();
    assert.equal(lastQuote, local ? 30 : 21.99);
    const cartBefore = await page.evaluate((key) => localStorage.getItem(key), `${prefix}cart`);
    await page.getByRole("button", { name: "Valider ma commande", exact: true }).click();
    await page.evaluate(() => document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await page.waitForURL("https://checkout.stripe.com/**");
    assert.equal(submissions, 1);
    assert.ok(submitted);
    const payload = submitted as Record<string, unknown>;
    assert.equal(payload.deliveryMethod, local ? "local_express" : "postal");
    assert.equal(payload.authToken, undefined); assert.equal(payload.cagnotteUse, undefined);
    const orderId = String(payload.checkoutRequestId);
    await page.goto(`${origin}/stripe-test/cancel?order_id=${orderId}`);
    await page.getByRole("status").filter({ hasText: "Votre panier test est conservé" }).waitFor();
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), `${prefix}cart`), cartBefore);
    paid = true;
    await page.goto(`${origin}/stripe-test/success?order_id=${orderId}`);
    await page.getByRole("status").filter({ hasText: "Le webhook signé a confirmé" }).waitFor();
    await page.reload();
    await page.getByRole("status").filter({ hasText: "Le webhook signé a confirmé" }).waitFor();
    assert.ok(statusReads >= 3); assert.equal(submissions, 1);
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem("verdanza-cart"), sessionStorage.getItem("verdanza:lastOrderSummary")]),
      ["public-cart-sentinel", "public-summary-sentinel"]);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await context.close();
    console.log(`PASS shared checkout DOM: ${local ? "fixed 7 g, local, 30 EUR" : "grams, postal, 21.99 EUR"}; double submit, cancel cart, server-status success/reload, public storage untouched.`);
  }
} finally { await browser.close(); }
