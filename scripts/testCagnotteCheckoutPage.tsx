import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

/** Shared production form and controllers; synthetic dependencies, no external network. */
export async function exerciseCagnotteSharedCheckout() {
  const bundle = await build({ stdin: { loader: "tsx", resolveDir: process.cwd(), sourcefile: "handoff-checkout-fixture.tsx", contents: `
    import React from "react"; import { createRoot } from "react-dom/client";
    import { BrowserRouter } from "react-router-dom";
    import { CheckoutPage } from "./src/pages/CheckoutPage";
    import { useCagnotteCheckout, useCheckoutAttempt } from "./src/hooks/useCagnotteCheckout";
    import { CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED } from "./src/config/cagnotteFeatures";
    import { createCheckoutStorage } from "./src/checkout/checkoutStorage";
    window.__reads=0; window.__sent=[]; window.__success=[];
    // The quote sees 20 EUR after a concurrent spend; the first wallet read still showed 30 EUR.
    const walletRead=async()=>{window.__reads++;return {currency:"EUR",capabilities:{canReadWallet:true,canRequestReservation:true,canAccrueLoyalty:true},
      wallet:{status:"active",availableCents:window.__reads===1?3000:2000,pendingCents:0,reservedCents:0,regularizationCents:0},
      history:{items:[],nextCursor:null,completeness:"timestamped_movements_only",limitation:""},freshness:{readAt:new Date().toISOString(),consistency:"wallet_and_page",refreshStartsAtFirstPage:true}}};
    const ordinary={subtotal:100,subtotalBeforeDiscount:100,deliveryFee:0,deliveryFeeStatus:"configured",deliveryNote:"Fixture",discountAmount:0,promoApplied:false,postalFreeShippingApplied:true,total:100,appliedPromotions:[]};
    const quoteOrder=async(input)=>{const requested=input.cagnotteUse?.requestedCents;if(!requested)return ordinary;const used=Math.min(requested,2000);return {...ordinary,cagnotteUse:{
      quoteVersion:"cagnotte-checkout-quote-v1",quoteFingerprint:String(requested).padStart(64,"0"),currency:"EUR",productsAfterDiscountsCents:10000,
      deliveryCents:0,requestedCagnotteCents:requested,proposedCagnotteCents:used,cagnotteCapCents:2000,payableCents:10000-used,
      estimatedLoyaltyCents:Math.round((10000-used)*0.05),loyaltyAccrualStatus:"estimated",limitationReasons:requested>2000?["twenty_percent_cap","available_balance"]:[],
      compatibility:{status:"allowed",blockingAdvantages:[],pendingAdvantages:[]}}};};
    const send=async(input)=>{window.__sent.push(input);await new Promise(resolve=>{window.__release=resolve;});const used=input.cagnotteUse?.acceptance.acceptedCagnotteCents||0;
      return {orderId:"synthetic-order",total:100,paymentAmount:(10000-used)/100,paymentStatus:"to_confirm",orderStatus:"contact_required",
        ...(used?{cagnotteUse:{amountCents:used,state:"reserved"}}:{}),summary:{items:[],subtotal:100,deliveryFee:0,deliveryMethod:"postal",discountAmount:0,appliedPromotions:[]}};};
    const noop=()=>{};
    const dependencies={cagnotteEnabled:CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED,
      useCagnotteCheckout:(options)=>useCagnotteCheckout({...options,read:walletRead}),
      useCheckoutAttempt:(id)=>{const attempt=useCheckoutAttempt(id);return {...attempt,submit:input=>attempt.submit(input,send),retry:()=>attempt.retry(send)};},
      clearCagnottePreference:noop,quoteOrder,submitOrder:send,loadDeliveryZones:async()=>({zones:[]}),initialDeliveryZones:[],
      analytics:{trackAddPaymentInfo:noop,trackAddShippingInfo:noop,trackContactClick:noop,trackBeginCheckout:noop,getGa4MeasurementContext:async()=>null,
        trackLocalDeliveryZoneSelected:noop,trackOrderSubmitted:noop,trackPaymentMethodSelected:noop},
      storage:createCheckoutStorage({local:()=>localStorage,session:()=>sessionStorage,randomUUID:()=>crypto.randomUUID(),
        keys:{coupon:"verdanza-coupon-code",request:"verdanza:checkout-request-id",summary:"verdanza:lastOrderSummary"}}),
      submissionSecurity:()=>({}),rememberOrderAnalytics:noop,navigateSuccess:id=>window.__success.push(id),
      createAddressSearch:()=>({search:async()=>({status:"empty",suggestions:[]}),dispose:noop}),ContactActions:()=>null,PromoBannerSlot:()=>null,contactEmail:"test@example.invalid",showAccountLinks:false,
      initialCustomer:{email:"test@example.invalid",phone:"0600000000",firstName:"Test",lastName:"Client",line1:"1 rue fictive",line2:"",postalCode:"75001",city:"Paris",country:"France"}};
    const product={id:"synthetic",name:"Produit fictif",price:10,stock:100,isActive:true};
    const cart={itemCount:10,subtotal:100,items:[{productId:"synthetic",quantity:10}],lines:[{productId:"synthetic",quantity:10,product,lineKey:"synthetic",quantityGrams:10,lineTotal:100,unitPrice:10}],
      cartWarnings:[],hasBlockingCartIssues:false,promotionSelections:[],setPromotionSelection:noop};
    const guest=location.search.includes("guest");
    const identity={user:guest?null:{uid:"synthetic-client",email:"test@example.invalid",displayName:"Test Client",getIdToken:async()=>"synthetic-token"},customerProfile:null};
    createRoot(document.getElementById("root")).render(<BrowserRouter><CheckoutPage cart={cart} identity={identity} dependencies={dependencies}/></BrowserRouter>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  define: { "import.meta.env": JSON.stringify({ VITE_CAGNOTTE_CHECKOUT_USE_DISPLAY_ENABLED: "true" }) }, logLevel: "silent" });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const guest of [true, false]) {
      const context = await browser.newContext(); const page = await context.newPage();
      const errors: string[] = []; const unexpected: string[] = [];
      page.on("pageerror", error => errors.push(error.stack || error.message));
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin === "http://127.0.0.1:5196" && url.pathname === "/checkout") {
          return route.fulfill({ contentType: "text/html", body: `<html><body><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>` });
        }
        unexpected.push(url.origin + url.pathname); return route.abort();
      });
      await page.goto(`http://127.0.0.1:5196/checkout${guest ? "?guest" : ""}`);
      const use = page.getByRole("checkbox", { name: "Utiliser ma cagnotte", exact: true });
      if (guest) {
        await page.getByText(/Connectez-vous pour consulter et utiliser/).waitFor();
        assert.equal(await use.count(), 0); assert.equal(await page.evaluate(() => Reflect.get(window, "__reads")), 0);
      } else {
        await use.check();
        await page.getByRole("button", { name: /Accepter — 80,00/ }).waitFor();
        await page.getByLabel("Montant souhaité en euros").fill("5,00");
        await page.getByRole("button", { name: "Appliquer ce montant" }).click();
        await page.getByRole("button", { name: /Accepter — 95,00/ }).click();
        await page.getByRole("button", { name: /Montant accepté — 95,00/ }).waitFor();
        await page.getByLabel("Montant souhaité en euros").fill("6,00");
        assert.equal(await page.getByRole("button", { name: /Montant accepté/ }).count(), 0);
        await page.getByRole("button", { name: "Utiliser le maximum" }).click();
        await page.getByRole("button", { name: /Accepter — 80,00/ }).waitFor();
        const reads = await page.evaluate(() => Reflect.get(window, "__reads"));
        await page.getByRole("button", { name: "Actualiser le solde" }).click();
        await page.waitForFunction(count => Reflect.get(window, "__reads") > count, reads);
        await page.getByRole("button", { name: "Continuer sans utiliser ma cagnotte" }).click();
        await page.getByRole("button", { name: "Valider le total sans cagnotte" }).click();
        await page.getByRole("button", { name: "Total sans cagnotte accepté" }).waitFor();
        await use.check();
        await page.getByRole("button", { name: /Accepter — 80,00/ }).click();
        assert.ok((await page.locator("body").innerText()).includes("Financé par votre cagnotte"));
        assert.ok((await page.locator("body").innerText()).includes("À régler hors cagnotte"));
        await page.getByRole("checkbox", { name: /Je confirme être majeur/ }).check();
        await page.getByRole("button", { name: /Valider la commande — 80,00/ }).click();
        await page.waitForFunction(() => Reflect.get(window, "__sent").length === 1);
        assert.equal(await use.isDisabled(), true);
        assert.equal(await page.getByLabel("Montant souhaité en euros").isDisabled(), true);
        await page.evaluate(() => document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
        assert.equal(await page.evaluate(() => Reflect.get(window, "__sent").length), 1);
        const sent = await page.evaluate(() => Reflect.get(window, "__sent")[0]);
        assert.equal(sent.cagnotteUse.acceptance.acceptedCagnotteCents, 2000);
        assert.equal(sent.cagnotteUse.acceptance.acceptedPayableCents, 8000);
        await page.evaluate(() => Reflect.get(window, "__release")());
        await page.waitForFunction(() => Reflect.get(window, "__success").length === 1);
        const summary = await page.evaluate(() => JSON.parse(sessionStorage.getItem("verdanza:lastOrderSummary") || "null"));
        assert.equal(summary.paymentAmount, 80);
      }
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); await context.close();
      console.log(`PASS shared cagnotte checkout: ${guest ? "guest cannot use/read" : "wallet, manual/max amount, acceptance, fallback, refresh, submit lock, server summary"}`);
    }
  } finally { await browser.close(); }
}
