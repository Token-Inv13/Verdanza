import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";

// Production components and shared form, synthetic Auth/API/quotes, all external traffic refused.
async function fixture(enabled: boolean) {
  return build({ stdin: { loader: "tsx", resolveDir: process.cwd(), sourcefile: "referral-client-fixture.tsx", contents: `
    import React,{useState} from "react"; import {createRoot} from "react-dom/client";
    import {BrowserRouter,Routes,Route,useNavigate,useLocation} from "react-router-dom";
    import {ReferralPanel} from "./src/components/referral/ReferralPanel";
    import {AccountAdvantagesPage} from "./src/pages/account/AccountAdvantagesPage";
    import {ReferralLinkPage} from "./src/pages/ReferralLinkPage";
    import {AccountAuthGate} from "./src/components/AccountAuthGate";
    import {CheckoutPage} from "./src/pages/CheckoutPage";
    import {useCagnotteCheckout,useCheckoutAttempt} from "./src/hooks/useCagnotteCheckout";
    import {createCheckoutStorage} from "./src/checkout/checkoutStorage";
    window.__authUser=location.search.includes("guest")?null:{uid:"synthetic-client",email:"test@example.invalid"};
    window.__tokens=0;window.__quotes=[];window.__sent=[];window.__fingerprint="a".repeat(64);window.__linkError="";window.__cartQuantity=5;
    window.__success=[];window.__reads=0;window.__copied="";window.__copyFail=false;window.__ensureError="";
    Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async(text)=>{if(window.__copyFail)throw Error("denied");window.__copied=text;}}});
    const noop=()=>{};
    const ordinary={subtotal:50,subtotalBeforeDiscount:50,deliveryFee:0,deliveryFeeStatus:"configured",deliveryNote:"Fixture",discountAmount:0,promoApplied:false,postalFreeShippingApplied:true,total:50,appliedPromotions:[]};
    const quoteOrder=async(input)=>{window.__quotes.push(input);const requested=input.cagnotteUse?.requestedCents||0;
      if(input.referralUse){if(requested>0)throw Object.assign(Error("conflict"),{code:"REFERRAL_CAGNOTTE_CONFLICT"});
        if(input.couponCode||window.__reason)return {...ordinary,total:48,referralUse:{applied:false,quoteVersion:"referral-checkout-quote-v1",reason:window.__reason||"priority_advantage"}};
        return {...ordinary,total:45,referralUse:{applied:true,quoteVersion:"referral-checkout-quote-v1",quoteFingerprint:window.__fingerprint,
          referralDiscountCents:500,productsBeforeReferralCents:5000,productsAfterReferralCents:4500,deliveryCents:0,payableCents:4500,loyaltyEstimateCents:225}};}
      if(requested)return {...ordinary,cagnotteUse:{quoteVersion:"cagnotte-checkout-quote-v1",quoteFingerprint:"c".repeat(64),currency:"EUR",productsAfterDiscountsCents:5000,
        deliveryCents:0,requestedCagnotteCents:requested,proposedCagnotteCents:1000,cagnotteCapCents:1000,payableCents:4000,estimatedLoyaltyCents:200,
        loyaltyAccrualStatus:"estimated",limitationReasons:[],compatibility:{status:"allowed",blockingAdvantages:[],pendingAdvantages:[]}}};
      return input.couponCode?{...ordinary,total:48,discountAmount:2,promoApplied:true,couponCode:input.couponCode}:ordinary;};
    const walletRead=async()=>{window.__reads++;return {currency:"EUR",capabilities:{canReadWallet:true,canRequestReservation:true,canAccrueLoyalty:true},wallet:{status:"active",availableCents:1000,pendingCents:0,reservedCents:0,regularizationCents:0},history:{items:[],nextCursor:null},freshness:{readAt:new Date().toISOString()}};};
    const send=async(input)=>{window.__sent.push(input);return {orderId:"synthetic-order",total:input.referralUse?45:50,paymentAmount:input.referralUse?45:input.cagnotteUse?40:50,
      paymentStatus:"to_confirm",orderStatus:"contact_required",...(input.referralUse?{referralUse:{discountCents:500}}:{}),...(input.cagnotteUse?{cagnotteUse:{amountCents:1000,state:"reserved"}}:{}),
      summary:{items:[],subtotal:50,deliveryFee:0,deliveryMethod:"postal",discountAmount:0,appliedPromotions:[]}};};
    const dependencies={cagnotteEnabled:true,referralEnabled:${enabled},quoteOrder,
      useCagnotteCheckout:(options)=>useCagnotteCheckout({...options,read:walletRead}),
      useCheckoutAttempt:(id)=>{const a=useCheckoutAttempt(id);return {...a,submit:input=>a.submit(input,send),retry:()=>a.retry(send)};},
      clearCagnottePreference:noop,submitOrder:send,loadDeliveryZones:async()=>({zones:[{id:"synthetic-zone",name:"Zone fictive",method:"local_express",isActive:true,fee:0,minimumOrder:20,estimatedDelay:"Fixture",slots:[],validationMode:"radius",addressValidationEnabled:true,centerLatitude:48.85,centerLongitude:2.35,radiusMeters:10000}]}),initialDeliveryZones:[],
      analytics:{trackAddPaymentInfo:noop,trackAddShippingInfo:noop,trackContactClick:noop,trackBeginCheckout:noop,getGa4MeasurementContext:async()=>null,trackLocalDeliveryZoneSelected:noop,trackOrderSubmitted:noop,trackPaymentMethodSelected:noop},
      storage:createCheckoutStorage({local:()=>localStorage,session:()=>sessionStorage,randomUUID:()=>crypto.randomUUID(),keys:{coupon:"fixture:coupon",request:"fixture:request",summary:"fixture:summary"}}),
      submissionSecurity:()=>({}),rememberOrderAnalytics:noop,navigateSuccess:id=>window.__success.push(id),createAddressSearch:()=>({search:async()=>({status:"ready",suggestions:[{id:"synthetic-address",label:"1 rue fictive Paris",line1:"1 rue fictive",postalCode:"75001",city:"Paris",latitude:48.85,longitude:2.35,verificationProvider:"geoplateforme_ban"}]}),dispose:noop}),
      ContactActions:()=>null,PromoBannerSlot:()=>null,contactEmail:"test@example.invalid",showAccountLinks:false,
      initialCustomer:{email:"checkout@example.invalid",phone:"0600000000",firstName:"Test",lastName:"Client",line1:"1 rue fictive",line2:"",postalCode:"75001",city:"Paris",country:"France"}};
    function Login(){const navigate=useNavigate();const location=useLocation();return <button onClick={()=>{window.__authUser={uid:"synthetic-client",email:"test@example.invalid"};navigate(location.state.from);}}>Connexion fictive</button>}
    function Root(){const [,refresh]=useState(0);const q=window.__cartQuantity;const product={id:"synthetic",name:"Produit fictif",price:10,stock:100,isActive:true};
      const cart={itemCount:q,subtotal:q*10,items:[{productId:"synthetic",quantity:q}],lines:[{productId:"synthetic",quantity:q,product,lineKey:"synthetic",quantityGrams:q,lineTotal:q*10,unitPrice:10}],cartWarnings:[],hasBlockingCartIssues:false,promotionSelections:[],setPromotionSelection:noop};
      return <><button onClick={()=>{window.__cartQuantity++;refresh(n=>n+1)}}>Modifier le panier fixture</button><Routes>
        <Route path="/panel" element={<ReferralPanel enabled={${enabled}} identityKey="synthetic-client"/>}/>
        <Route path="/account" element={<AccountAdvantagesPage/>}/><Route path="/connexion" element={<Login/>}/>
        <Route element={<AccountAuthGate/>}><Route path="/parrainage/:code" element={<ReferralLinkPage/>}/></Route>
        <Route path="/checkout" element={<CheckoutPage cart={cart} identity={{user:window.__authUser,customerProfile:null}} dependencies={dependencies}/>}/>
      </Routes></>}
    createRoot(document.getElementById("root")).render(<BrowserRouter><Root/></BrowserRouter>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", logLevel: "silent",
  define: { "import.meta.env": JSON.stringify({ VITE_REFERRAL_DISPLAY_ENABLED: enabled ? "true" : "false", VITE_REFERRAL_CHECKOUT_DISPLAY_ENABLED: enabled ? "true" : "false" }) },
  plugins: [{ name: "synthetic-auth-only", setup(plugin) {
    plugin.onLoad({ filter: /[\\/]context[\\/]AuthContext\.tsx$/ }, () => ({ contents: "export function useAuth(){return {user:window.__authUser,isLoading:false}}", loader: "tsx" }));
    plugin.onLoad({ filter: /[\\/]lib[\\/]firebaseAuth\.ts$/ }, () => ({ contents: "export async function getFirebaseIdToken(){window.__tokens++;return window.__authUser?'synthetic-current-token':null}", loader: "ts" }));
  } }] });
}
const browser = await chromium.launch({ headless: true }); let passed = 0;
try {
  for (const enabled of [false, true]) {
    const bundle = await fixture(enabled);
    async function withPage(path: string, run: (page: Page, requests: Record<string, unknown>[]) => Promise<void>) {
      const context = await browser.newContext(); const page = await context.newPage(); const requests: Record<string, unknown>[] = [];
      const errors: string[] = [], unexpected: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin !== "http://127.0.0.1:5198") { unexpected.push(url.href); await route.abort(); return; }
        if (url.pathname === "/api/referral") {
          const data = route.request().postDataJSON() as Record<string, unknown> | null; requests.push({ method: route.request().method(), ...data });
          const error = await page.evaluate(() => Reflect.get(window, "__linkError"));
          const ensureError = await page.evaluate(() => Reflect.get(window, "__ensureError"));
          const payload = data?.action === "ensure_code" ? ensureError ? { code: ensureError } : { code: "A".repeat(26) } : data?.action === "link" ? error ? { code: error } : { state: "linked", changed: true } : {
            version: "referral-self-v1", code: path.includes("empty") ? null : "A".repeat(26), relation: null,
            sponsorSummary: { referralsTotal: 3, linkedCount: 1, pendingCount: 1, rewardedCount: 1, cancelledCount: 0, reversedCount: 0, pendingRewardCents: 1000, validatedRewardCents: 1000 } };
          await route.fulfill({ status: data?.action === "link" && error ? 409 : data?.action === "ensure_code" && ensureError ? 403 : 200, contentType: "application/json", body: JSON.stringify(payload) }); return;
        }
        await route.fulfill({ contentType: "text/html", body: `<html><body><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>` });
      });
      try { await page.goto(`http://127.0.0.1:5198${path}`); await run(page, requests); assert.deepEqual(errors, []); assert.deepEqual(unexpected, []); passed++; }
      finally { await context.close(); }
    }
    if (!enabled) {
      await withPage("/account", async (page, requests) => { await page.locator("main, #root").first().waitFor(); assert.equal(await page.locator("[data-referral-panel]").count(), 0); assert.equal(requests.length, 0); assert.equal(await page.evaluate(() => Reflect.get(window, "__tokens")), 0); });
      await withPage("/checkout", async page => {
        await page.getByRole("checkbox", { name: /Je confirme être majeur/ }).check();
        await page.getByRole("button", { name: "Valider ma commande", exact: true }).click();
        await page.waitForFunction(() => Reflect.get(window, "__sent").length === 1);
        assert.equal(await page.locator("[data-referral-checkout]").count(), 0);
        assert.equal(await page.evaluate(() => Reflect.get(window, "__sent")[0].referralUse), undefined);
        assert.equal(await page.evaluate(() => Reflect.get(window, "__quotes").some((q: { referralUse?: unknown }) => q.referralUse)), false);
      });
    } else {
      await withPage("/panel", async (page, requests) => {
        await page.getByLabel("Votre lien d’invitation").waitFor(); assert.equal(requests.length, 1); assert.equal(requests[0].method, "GET");
        assert.match(await page.locator("body").innerText(), /Récompenses validées.*10,00/);
        await page.getByRole("button", { name: "Copier le lien" }).click();
        assert.equal(await page.evaluate(() => Reflect.get(window, "__copied")), `http://127.0.0.1:5198/parrainage/${"A".repeat(26)}`);
        await page.evaluate(() => Reflect.set(window, "__copyFail", true)); await page.getByRole("button", { name: "Copier le lien" }).click();
        await page.getByText("Sélectionnez et copiez le lien ci-dessus.").waitFor(); assert.equal(await page.getByLabel("Votre lien d’invitation").evaluate((input: HTMLInputElement) => input.selectionStart), 0);
      });
      await withPage("/panel?empty", async (page, requests) => {
        await page.getByRole("button", { name: "Créer mon lien de parrainage" }).waitFor(); assert.equal(requests.length, 1);
        await page.getByRole("button", { name: "Créer mon lien de parrainage" }).click(); await page.getByLabel("Votre lien d’invitation").waitFor();
        assert.equal(requests.filter(r => r.action === "ensure_code").length, 1);
      });
      await withPage("/panel?empty", async page => {
        await page.getByRole("button", { name: "Créer mon lien de parrainage" }).waitFor();
        await page.evaluate(() => Reflect.set(window, "__ensureError", "sponsor_ineligible"));
        await page.getByRole("button", { name: "Créer mon lien de parrainage" }).click();
        await page.getByText("Votre lien sera disponible après une première commande personnelle payée et livrée.").waitFor();
        assert.equal(await page.getByLabel("Votre lien d’invitation").count(), 0);
      });
      await withPage(`/parrainage/${"A".repeat(26)}?guest#invitation`, async (page, requests) => {
        await page.getByRole("button", { name: "Connexion fictive" }).click(); await page.getByRole("button", { name: "Associer cette invitation à mon compte" }).waitFor();
        assert.equal(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash, `/parrainage/${"A".repeat(26)}?guest#invitation`);
        assert.equal(requests.length, 0); assert.match(await page.locator('meta[name="robots"]').getAttribute("content") || "", /noindex/);
        await page.getByRole("button", { name: "Associer cette invitation à mon compte" }).click(); await page.getByText("Invitation associée à votre compte.").waitFor();
        assert.equal(requests.filter(r => r.action === "link").length, 1); assert.equal(await page.getByRole("link", { name: "Découvrir la boutique" }).getAttribute("href"), "/boutique");
      });
      for (const [code, text] of [["referral_code_unknown", "Cette invitation n’est pas valide"], ["self_referral", "propre invitation"],
        ["referee_already_paid", "première commande produits"], ["referral_email_claimed", "Cette adresse est déjà associée"],
        ["referral_checkout_reserved", "Une commande utilise déjà"], ["referral_history_inconclusive", "confirmer votre éligibilité"]]) {
        await withPage(`/parrainage/${"A".repeat(26)}`, async page => {
          await page.evaluate(value => Reflect.set(window, "__linkError", value), code);
          await page.getByRole("button", { name: "Associer cette invitation à mon compte" }).click(); await page.getByText(new RegExp(text)).waitFor();
          assert.equal((await page.locator("body").innerText()).includes(code), false);
        });
      }
      await withPage("/checkout?guest", async page => { await page.getByText("Total de la commande").waitFor(); assert.equal(await page.locator("[data-referral-checkout]").count(), 0); });
      for (const [reason, text] of [["below_threshold", "50 € de produits éligibles"], ["no_relation", "Aucune invitation"], ["right_consumed", "déjà été utilisé"], ["right_reserved", "autre commande en cours"]]) {
        await withPage("/checkout", async page => {
          await page.evaluate(value => Reflect.set(window, "__reason", value), reason);
          await page.getByRole("button", { name: "Vérifier mon avantage parrainage" }).click();
          await page.getByText(new RegExp(text)).last().waitFor();
          assert.equal(await page.getByRole("button", { name: "Appliquer les 5 €" }).count(), 0);
          assert.equal((await page.locator("body").innerText()).includes(reason), false);
        });
      }
      await withPage("/checkout", async page => {
        await page.getByRole("button", { name: "Vérifier mon avantage parrainage" }).waitFor();
        assert.equal(await page.evaluate(() => Reflect.get(window, "__quotes").some((q: { referralUse?: unknown }) => q.referralUse)), false);
        await page.getByRole("button", { name: "Vérifier mon avantage parrainage" }).click(); await page.getByRole("button", { name: "Appliquer les 5 €" }).click();
        assert.match(await page.locator("body").innerText(), /Fidélité estimée.*2,25/);
        await page.getByRole("checkbox", { name: /Je confirme être majeur/ }).check();
        await page.evaluate(() => Reflect.set(window, "__fingerprint", "b".repeat(64)));
        await page.getByRole("button", { name: /Valider la commande — 45,00/ }).click(); await page.getByRole("button", { name: "Appliquer les 5 €" }).waitFor();
        assert.equal(await page.evaluate(() => Reflect.get(window, "__sent").length), 0);
        await page.getByRole("button", { name: "Appliquer les 5 €" }).click(); await page.getByRole("button", { name: /Valider la commande — 45,00/ }).click();
        await page.waitForFunction(() => Reflect.get(window, "__sent").length === 1);
        const request = await page.evaluate(() => Reflect.get(window, "__sent")[0]); assert.equal(request.referralUse.acceptance.quoteFingerprint, "b".repeat(64));
        assert.equal(request.referralUse.acceptance.acceptedReferralDiscountCents, 500); assert.equal(request.referralUse.acceptance.acceptedPayableCents, 4500);
        assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture:summary") || "{}").referralUse), { discountCents: 500 });
      });
      await withPage("/checkout", async page => {
        await page.getByRole("button", { name: "Vérifier mon avantage parrainage" }).click(); await page.getByRole("button", { name: "Appliquer les 5 €" }).click();
        await page.getByRole("button", { name: "Modifier le panier fixture" }).click(); assert.equal(await page.getByText("Avantage parrainage accepté.").count(), 0);
        await page.getByRole("button", { name: "Vérifier mon avantage parrainage" }).click(); await page.getByRole("button", { name: "Appliquer les 5 €" }).click();
        await page.getByPlaceholder("WELCOME10").fill("PROMO"); assert.equal(await page.getByText("Avantage parrainage accepté.").count(), 0);
        await page.getByRole("button", { name: "Appliquer", exact: true }).click(); await page.getByRole("button", { name: "Vérifier mon avantage parrainage" }).click();
        await page.getByText("Une promotion ou un autre avantage prioritaire s’applique à cette commande.").waitFor();
        assert.equal(await page.evaluate(() => Reflect.get(window, "__sent").length), 0);
      });
      await withPage("/checkout", async page => {
        await page.getByRole("option", { name: "1 rue fictive Paris" }).click();
        await page.getByRole("button", { name: "Vérifier mon avantage parrainage" }).click(); await page.getByRole("button", { name: "Appliquer les 5 €" }).click();
        await page.getByRole("radio", { name: /Livraison locale Aix-en-Provence/ }).check();
        assert.equal(await page.getByText("Avantage parrainage accepté.").count(), 0);
        assert.equal(await page.getByRole("button", { name: /Valider ma commande/ }).isDisabled(), true);
        await page.getByRole("button", { name: "Vérifier mon avantage parrainage" }).click(); await page.getByRole("button", { name: "Appliquer les 5 €" }).click();
        await page.getByLabel("Code postal", { exact: true }).fill("75002"); assert.equal(await page.getByText("Avantage parrainage accepté.").count(), 0);
        assert.equal(await page.evaluate(() => Reflect.get(window, "__sent").length), 0);
      });
      for (const keepReferral of [true, false]) {
        await withPage("/checkout", async page => {
          const use = page.getByRole("checkbox", { name: "Utiliser ma cagnotte", exact: true }); await use.check();
          await page.getByRole("button", { name: /Accepter — 40,00/ }).waitFor(); await page.getByRole("button", { name: "Vérifier mon avantage parrainage" }).click();
          await page.getByText(/Choisissez votre avantage/).waitFor(); assert.equal(await use.isChecked(), true);
          assert.equal(await page.getByLabel("Montant souhaité en euros").inputValue(), "10,00");
          assert.equal(await page.evaluate(() => Reflect.get(window, "__sent").length), 0);
          if (keepReferral) {
            await page.getByRole("button", { name: "Continuer avec le parrainage sans utiliser ma cagnotte" }).click(); await page.getByRole("button", { name: "Appliquer les 5 €" }).waitFor();
            assert.equal(await use.isChecked(), false);
            const inputs = await page.evaluate(() => Reflect.get(window, "__quotes")); assert.deepEqual(inputs.at(-1).cagnotteUse, { requestedCents: 0 });
            assert.equal(inputs.at(-1).referralUse.requested, true); await page.getByRole("button", { name: "Appliquer les 5 €" }).click();
          } else {
            await page.getByRole("button", { name: "Conserver ma cagnotte" }).click(); assert.equal(await use.isChecked(), true);
            await page.getByRole("button", { name: /Accepter — 40,00/ }).click();
          }
          await page.getByRole("checkbox", { name: /Je confirme être majeur/ }).check(); await page.getByRole("button", { name: new RegExp("Valider la commande — "+(keepReferral?"45,00":"40,00")) }).click();
          await page.waitForFunction(() => Reflect.get(window, "__sent").length === 1); const request = await page.evaluate(() => Reflect.get(window, "__sent")[0]);
          assert.equal(Boolean(request.referralUse), keepReferral); assert.equal(Boolean(request.cagnotteUse), !keepReferral);
        });
      }
    }
    console.log(`PASS Referral UI flags ${enabled ? "ON synthetic only" : "OFF"}`);
  }
} finally { await browser.close(); }
console.log(`Referral client UI: ${passed} rendered scenarios, no external network.`);
