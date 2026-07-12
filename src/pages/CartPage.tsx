import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Minus, Plus, Trash2 } from "lucide-react";
import { ProductImage } from "../components/ProductImage";
import { Seo } from "../components/Seo";
import { useCart } from "../context/CartContext";
import { formatEuro, quoteOrder, type OrderQuote } from "../services/quoteService";
import { trackAddToCart, trackCtaClick, trackRemoveFromCart, trackViewCart } from "../lib/analytics";

const promoStorageKey = "verdanza-coupon-code";

export function CartPage() {
  const { items, lines, subtotal, addItem, decrementItem, removeItem } = useCart();
  const trackedCartSignature = useRef("");
  const deliveryEstimate = 0;
  const [couponCode, setCouponCode] = useState(() =>
    window.localStorage.getItem(promoStorageKey) || "",
  );
  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [promoMessage, setPromoMessage] = useState("");
  const [isCheckingPromo, setIsCheckingPromo] = useState(false);
  const discountAmount = quote?.promoApplied ? quote.discountAmount : 0;
  const total = Math.max(0, subtotal + (lines.length ? deliveryEstimate : 0) - discountAmount);

  useEffect(() => {
    if (!couponCode.trim()) {
      window.localStorage.removeItem(promoStorageKey);
      setQuote(null);
      setPromoMessage("");
    }
  }, [couponCode]);

  useEffect(() => {
    const signature = lines.map((line) => `${line.productId}:${line.quantity}`).join("|");
    if (!signature || trackedCartSignature.current === signature) return;
    trackedCartSignature.current = signature;
    trackViewCart(lines, subtotal);
  }, [lines, subtotal]);

  async function handleApplyPromo() {
    const code = couponCode.trim().toUpperCase();
    setCouponCode(code);
    setPromoMessage("");
    setQuote(null);
    if (!code) return;
    setIsCheckingPromo(true);
    try {
      const nextQuote = await quoteOrder({
        items,
        deliveryMethod: "postal",
        deliveryZone: "postal-france",
        couponCode: code,
      });
      setQuote(nextQuote);
      window.localStorage.setItem(promoStorageKey, code);
      setPromoMessage("Code promo appliqué.");
    } catch (error) {
      window.localStorage.removeItem(promoStorageKey);
      setPromoMessage(
        error instanceof Error ? error.message : "Ce code promo n'est pas valide.",
      );
    } finally {
      setIsCheckingPromo(false);
    }
  }

  return (
    <main className="container-page py-12">
      <Seo
        title="Panier - Verdanza CBD"
        description="Panier local Verdanza CBD."
        path="/panier"
        noindex
      />
      <div className="page-intro">
        <h1>Panier</h1>
        <p>
          Vérifiez vos produits avant de choisir votre mode de livraison et de
          valider votre commande.
        </p>
        <p className="mt-3 text-sm text-forest/70">
          Livraison postale en France ou livraison locale sur Aix-en-Provence et
          alentours selon disponibilité.
        </p>
      </div>
      {lines.length === 0 ? (
        <section className="mt-10 rounded-lg border border-forest/10 bg-cream p-8">
          <p>Votre panier est vide.</p>
          <Link
            to="/boutique"
            className="btn-primary mt-6 inline-flex"
            onClick={() =>
              trackCtaClick({
                ctaId: "empty_cart_shop",
                ctaLocation: "cart_empty",
                destinationPath: "/boutique",
                ctaCategory: "shop_navigation",
              })
            }
          >
            Voir la boutique
          </Link>
        </section>
      ) : (
        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_380px]">
          <div className="grid gap-4">
            {lines.map((line) => (
              <article
                key={line.productId}
                className="grid gap-4 rounded-lg border border-forest/10 bg-ivory p-4 sm:grid-cols-[120px_1fr_auto]"
              >
                <ProductImage
                  variant="card"
                  src={line.product.image}
                  alt=""
                  loading="lazy"
                  className="h-28 w-full rounded-md bg-cream object-contain"
                />
                <div>
                  <h2 className="font-display text-2xl text-forest">
                    {line.product.name}
                  </h2>
                  <p className="text-sm text-ink/60">{line.product.shortDescription}</p>
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      className="icon-button"
                      onClick={() => {
                        decrementItem(line.productId);
                        trackRemoveFromCart(line.product);
                      }}
                    >
                      <Minus size={16} />
                    </button>
                    <span className="w-12 text-center">{line.quantity} g</span>
                    <button
                      className="icon-button"
                      onClick={() => {
                        addItem(line.productId);
                        trackAddToCart(line.product);
                      }}
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => {
                        removeItem(line.productId);
                        trackRemoveFromCart(line.product, line.quantity);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <strong className="text-forest">{formatEuro(line.lineTotal)}</strong>
              </article>
            ))}
          </div>
          <aside className="h-fit rounded-lg border border-champagne/30 bg-cream p-6">
            <h2 className="font-display text-3xl text-forest">Résumé</h2>
            <div className="mt-6 grid gap-3 text-sm">
              <p className="flex justify-between">
                <span>Sous-total</span>
                <span>{formatEuro(subtotal)}</span>
              </p>
              <label className="grid gap-2 border-t border-forest/10 pt-3 text-sm font-medium text-forest">
                Code promo
                <div className="flex gap-2">
                  <input
                    className="input-field"
                    value={couponCode}
                    onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                    placeholder="WELCOME10"
                  />
                  <button
                    className="btn-secondary min-h-11 px-3 py-2"
                    type="button"
                    disabled={isCheckingPromo}
                    onClick={() => void handleApplyPromo()}
                  >
                    {isCheckingPromo ? "..." : "Appliquer"}
                  </button>
                </div>
              </label>
              {promoMessage && (
                <p
                  className={`text-xs leading-5 ${
                    quote?.promoApplied ? "text-forest" : "text-red-700"
                  }`}
                >
                  {promoMessage}
                </p>
              )}
              {quote?.promoApplied && (
                <p className="flex justify-between text-forest">
                  <span>
                    Code promo {quote.couponCode}
                    {quote.discountType === "free_shipping" ? " livraison offerte" : ""}
                  </span>
                  <span>
                    {quote.discountAmount > 0
                      ? `-${formatEuro(quote.discountAmount)}`
                      : "Appliqué"}
                  </span>
                </p>
              )}
              <p className="flex justify-between">
                <span>Livraison estimée</span>
                <span>
                  {deliveryEstimate > 0
                    ? formatEuro(deliveryEstimate)
                    : "Calculée à l'étape suivante"}
                </span>
              </p>
              <p className="flex justify-between border-t border-forest/10 pt-3 text-lg font-semibold text-forest">
                <span>Total</span>
                <span>{formatEuro(total)}</span>
              </p>
            </div>
            <Link
              to="/checkout"
              className="btn-primary mt-6 w-full justify-center"
              onClick={() =>
                trackCtaClick({
                  ctaId: "cart_continue_checkout",
                  ctaLocation: "cart_summary",
                  destinationPath: "/checkout",
                  ctaCategory: "checkout",
                })
              }
            >
              Continuer
            </Link>
          </aside>
        </div>
      )}
    </main>
  );
}
