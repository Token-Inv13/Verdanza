import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { CheckoutPage } from "../pages/CheckoutPage";
import { createLocalTestCheckoutConfiguration, type TestOrderStatus } from "./checkoutConfiguration";
import { testCheckoutCart } from "./testCart";
import { cartItemKey, fixedPriceCartLineLabel, normalizeCartItems, resolveFixedPriceOptions } from "../lib/fixedPriceOptions";
import { formatEuro } from "../lib/formatEuro";
import type { CartItem, Product, PromotionSelection } from "../types";

type Configuration = ReturnType<typeof createLocalTestCheckoutConfiguration>;

export function StripeTestApp() {
  const [config] = useState(createLocalTestCheckoutConfiguration);
  const [products, setProducts] = useState<Product[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<CartItem[]>(() => {
    try { return normalizeCartItems(JSON.parse(config.cartStorage.read() || "[]")); } catch { return []; }
  });
  useEffect(() => { config.cartStorage.write(items); }, [config, items]);
  useEffect(() => {
    let active = true;
    config.loadCatalog().then((catalog) => { if (active) { setProducts(catalog); setLoaded(true); } })
      .catch(() => { if (active) setError("Catalogue émulateur indisponible."); });
    return () => { active = false; };
  }, [config]);
  const [promotionSelections, setPromotionSelections] = useState<PromotionSelection[]>([]);
  const setPromotionSelection = useCallback((promotionId: string, giftProductId?: string) => {
    setPromotionSelections((current) => current.find((entry) => entry.promotionId === promotionId)?.giftProductId === giftProductId
      ? current : [...current.filter((entry) => entry.promotionId !== promotionId), ...(giftProductId ? [{ promotionId, giftProductId }] : [])]);
  }, []);
  const cart = useMemo(() => testCheckoutCart(items, products, promotionSelections, setPromotionSelection), [items, products, promotionSelections, setPromotionSelection]);
  function setQuantity(productId: string, quantity: number, fixedPriceOptionId?: string) {
    const next: CartItem = { productId, quantity: Math.max(0, Math.floor(quantity)),
      purchaseMode: fixedPriceOptionId ? "fixed_price" : "gram", ...(fixedPriceOptionId ? { fixedPriceOptionId } : {}) };
    setItems((current) => [...current.filter((item) => cartItemKey(item) !== cartItemKey(next)), ...(next.quantity ? [next] : [])]);
  }
  const shop = <section className="mx-auto max-w-5xl space-y-6 p-6">
    <h1 className="font-display text-3xl">Votre panier test</h1>
    <p>Copies locales du catalogue. Choisissez des grammes ou des formats fixes. Toutes les adresses et coordonnées saisies doivent être fictives.</p>
    <div className="grid gap-4 sm:grid-cols-2">{products.map((product) => <article className="rounded-2xl border border-brand-green/20 bg-white p-5" key={product.id}>
      <h2 className="text-xl font-semibold">{product.name}</h2>
      <p>{formatEuro(product.price)} / g · stock test : {product.stock} g</p>
      <label className="mt-3 flex items-center justify-between gap-3">Grammes
        <input className="input w-24" aria-label={`${product.name} grammes`} type="number" min="0" max={product.stock} value={items.find((i) => i.productId === product.id && i.purchaseMode !== "fixed_price")?.quantity || 0}
          onChange={(event) => setQuantity(product.id, Number(event.target.value))} />
      </label>
      {resolveFixedPriceOptions(product).map((option) => <label className="mt-3 flex items-center justify-between gap-3" key={option.id}>
        {fixedPriceCartLineLabel(option, 1)}
        <input className="input w-24" aria-label={`${product.name} format ${option.id}`} type="number" min="0" max={Math.floor(product.stock / option.quantityGrams)}
          value={items.find((i) => i.productId === product.id && i.fixedPriceOptionId === option.id)?.quantity || 0}
          onChange={(event) => setQuantity(product.id, Number(event.target.value), option.id)} />
      </label>)}
    </article>)}</div>
    <div className="rounded-2xl bg-white p-6">
      {cart.lines.map((line) => <p key={line.lineKey}>{line.product.name} · {line.fixedPriceOption ? fixedPriceCartLineLabel(line.fixedPriceOption, line.quantity) : `${line.quantity} g`} : {formatEuro(line.lineTotal)}</p>)}
      <p className="my-4 text-xl font-semibold">Sous-total : {formatEuro(cart.subtotal)}</p>
      {cart.cartWarnings.map((warning, index) => <p role="alert" key={index}>{warning}</p>)}
      {cart.lines.length > 0 && !cart.hasBlockingCartIssues && <Link className="btn-primary inline-flex" to="/stripe-test/checkout">Passer au checkout test</Link>}
      <button className="btn-secondary ml-3" onClick={() => { setItems([]); config.newAttempt(); }}>Vider le panier test</button>
    </div>
  </section>;
  return <>
    <div className="sticky top-0 z-50 bg-amber-200 p-3 text-center font-bold text-gray-900">MODE TEST — aucun paiement réel</div>
    <nav className="mx-auto flex max-w-5xl gap-5 p-4"><Link to="/stripe-test">Verdanza · panier test</Link><span>Invité fictif · émulateur local</span></nav>
    {error ? <p role="alert">{error}</p> : !loaded ? <p>Chargement du catalogue test…</p> : <Routes>
      <Route path="/stripe-test/checkout" element={<CheckoutPage cart={cart} identity={config.identity} dependencies={config.dependencies} />} />
      <Route path="/stripe-test/success" element={<TestReturn config={config} />} />
      <Route path="/stripe-test/cancel" element={<TestReturn config={config} />} />
      <Route path="*" element={shop} />
    </Routes>}
  </>;
}

function TestReturn({ config }: { config: Configuration }) {
  const [params] = useSearchParams();
  const location = useLocation();
  const id = params.get("order_id") || "";
  const cancelled = location.pathname.endsWith("/cancel");
  const [status, setStatus] = useState<TestOrderStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setStatus(null);
    setError("");
    async function poll() {
      try {
        const next = await config.readStatus(id);
        if (!active) return;
        setStatus(next);
        if (next.paymentStatus !== "paid" && next.paymentStatus !== "cancelled") timer = setTimeout(() => void poll(), 1500);
      } catch { if (active) setError("Commande test introuvable ou accès non autorisé."); }
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [config, id]);
  const paid = status?.paymentStatus === "paid";
  return <section className="mx-auto max-w-3xl space-y-5 p-8">
    <h1 className="font-display text-3xl">{paid ? "Paiement test confirmé" : cancelled ? "Paiement test interrompu" : "Confirmation du paiement test"}</h1>
    <p role="status">{error || (paid ? "Le webhook signé a confirmé le paiement. Aucune commande réelle ne sera exécutée." : cancelled ? "Votre panier test est conservé. Ce retour ne confirme aucun paiement." : "En attente de la confirmation du webhook Stripe…")}</p>
    {status && <div className="rounded-2xl bg-white p-5"><p>Commande test : {status.orderId}</p><p>Montant serveur : {formatEuro(status.amountCents / 100)}</p><p>Statut serveur : <strong>{status.paymentStatus}</strong></p><p>Transitions vers paid : {status.paidTransitions}</p></div>}
    {cancelled && status && !paid && status.paymentStatus !== "cancelled" && <button className="btn-primary" disabled={busy} onClick={() => {
      setBusy(true); config.resume(id).catch(() => { setError("Cette session ne peut plus être reprise. Vous pouvez recommencer depuis le panier test."); setBusy(false); });
    }}>Reprendre le paiement test</button>}
    <Link className="btn-secondary inline-flex" to="/stripe-test">Retrouver le panier test</Link>
    <Link className="btn-secondary ml-3 inline-flex" to="/stripe-test/checkout" onClick={() => config.newAttempt()}>Nouvel essai test</Link>
  </section>;
}
