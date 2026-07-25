import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Minus, Plus, Trash2 } from "lucide-react";
import { ProductImage } from "../components/ProductImage";
import { PromoBannerSlot } from "../components/PromoBannerSlot";
import { Seo } from "../components/Seo";
import { useCart } from "../context/CartContext";
import {
  availableProductStock,
  getCartLineStockIssue,
  getCartStockIssues,
  publicProductStockLabel,
} from "../lib/cartStock";
import { calculateCartPromotions } from "../lib/cartPromotions";
import { formatEuro, quoteOrder, type OrderQuote } from "../services/quoteService";
import { trackAddToCart, trackCtaClick, trackRemoveFromCart, trackViewCart } from "../lib/analytics";
import { fixedPriceOptionLabel } from "../lib/fixedPriceOptions";

const promoStorageKey = "verdanza-coupon-code";

export function CartPage() {
  const {
    items,
    lines,
    cartWarnings,
    hasBlockingCartIssues,
    subtotal,
    incrementLine,
    decrementLine,
    setLineQuantity,
    removeLine,
  } = useCart();
  const trackedCartSignature = useRef("");
  const deliveryEstimate = 0;
  const [couponCode, setCouponCode] = useState(() =>
    window.localStorage.getItem(promoStorageKey) || "",
  );
  const [appliedCouponCode, setAppliedCouponCode] = useState(() =>
    window.localStorage.getItem(promoStorageKey) || "",
  );
  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [automaticQuote, setAutomaticQuote] = useState<OrderQuote | null>(null);
  const [promoMessage, setPromoMessage] = useState("");
  const [isCheckingPromo, setIsCheckingPromo] = useState(false);
  const automaticPromotions = calculateCartPromotions({
    lines: lines.map((line) => ({
      productId: line.productId,
      name: line.product.name,
      category: line.product.category,
      quantity: line.quantityGrams,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
    })),
  });
  const normalizedCouponCode = couponCode.trim().toUpperCase();
  const normalizedAppliedCouponCode = appliedCouponCode.trim().toUpperCase();
  const hasManualPromo = Boolean(
    quote?.promoApplied &&
      normalizedAppliedCouponCode &&
      quote.couponCode?.toUpperCase() === normalizedAppliedCouponCode,
  );
  const automaticAppliedPromotions = hasManualPromo
    ? []
    : automaticQuote
      ? automaticQuote.appliedPromotions || []
      : automaticPromotions.appliedPromotions;
  const automaticDiscountAmount = hasManualPromo
    ? 0
    : Number(
        automaticQuote
          ? automaticQuote.promotionDiscountTotal || automaticQuote.discountAmount || 0
          : automaticPromotions.promotionDiscountTotal,
      );
  const automaticProgressMessages = automaticQuote
    ? automaticQuote.promotionProgressMessages || []
    : automaticPromotions.progressMessages;
  const discountAmount = hasManualPromo
    ? Number(quote?.discountAmount || 0)
    : automaticDiscountAmount;
  const total = Math.max(0, subtotal + (lines.length ? deliveryEstimate : 0) - discountAmount);
  const stockIssues = getCartStockIssues(lines);
  const hasStockIssues = stockIssues.length > 0;
  const hasCartIssues = hasStockIssues || hasBlockingCartIssues;

  useEffect(() => {
    if (!couponCode.trim()) {
      window.localStorage.removeItem(promoStorageKey);
      setAppliedCouponCode("");
      setQuote(null);
      setPromoMessage("");
    }
  }, [couponCode]);

  useEffect(() => {
    if (!lines.length || hasManualPromo || hasBlockingCartIssues) {
      setAutomaticQuote(null);
      return;
    }
    let cancelled = false;
    quoteOrder({
      items,
      deliveryMethod: "postal",
      deliveryZone: "postal-france",
    })
      .then((nextQuote) => {
        if (!cancelled) setAutomaticQuote(nextQuote);
      })
      .catch(() => {
        if (!cancelled) setAutomaticQuote(null);
      });
    return () => {
      cancelled = true;
    };
  }, [hasBlockingCartIssues, hasManualPromo, items, lines.length, subtotal]);

  useEffect(() => {
    const code = appliedCouponCode.trim().toUpperCase();
    if (!lines.length || !code || hasBlockingCartIssues) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    quoteOrder({
      items,
      deliveryMethod: "postal",
      deliveryZone: "postal-france",
      couponCode: code,
    })
      .then((nextQuote) => {
        if (cancelled) return;
        setQuote(nextQuote);
        setCouponCode(nextQuote.couponCode || code);
      })
      .catch(() => {
        if (cancelled) return;
        setAppliedCouponCode("");
        setQuote(null);
        window.localStorage.removeItem(promoStorageKey);
      });
    return () => {
      cancelled = true;
    };
  }, [appliedCouponCode, hasBlockingCartIssues, items, lines.length, subtotal]);

  useEffect(() => {
    const signature = lines.map((line) => `${line.lineKey}:${line.quantity}`).join("|");
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
      setAppliedCouponCode(nextQuote.couponCode || code);
      window.localStorage.setItem(promoStorageKey, code);
      setPromoMessage("Code promo appliqué.");
    } catch (error) {
      setAppliedCouponCode("");
      window.localStorage.removeItem(promoStorageKey);
      setPromoMessage(
        error instanceof Error ? error.message : "Ce code promo n'est pas valide.",
      );
    } finally {
      setIsCheckingPromo(false);
    }
  }

  function handleCouponInputChange(value: string) {
    const nextCode = value.toUpperCase();
    setCouponCode(nextCode);
    if (nextCode.trim().toUpperCase() !== normalizedAppliedCouponCode) {
      setAppliedCouponCode("");
      setQuote(null);
      window.localStorage.removeItem(promoStorageKey);
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
      <PromoBannerSlot placement="cart" type="checkout_notice" className="mt-6 grid gap-3" />
      {cartWarnings.length > 0 && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">
          <p>Certains formats prix fixe de votre panier ne sont plus disponibles.</p>
          <ul className="mt-1 list-disc pl-5">
            {cartWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
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
            {lines.map((line) => {
              const availableStock = availableProductStock(line.product);
              const stockIssue = getCartLineStockIssue(line);
              const nextQuantityGrams =
                line.purchaseMode === "fixed_price"
                  ? line.quantityGrams + Number(line.fixedPriceOption?.quantityGrams || 0)
                  : line.quantityGrams + 1;
              const canIncrease = !stockIssue && nextQuantityGrams <= availableStock;
              const stockLabel = publicProductStockLabel(line.product);
              const lineQuantityLabel =
                line.purchaseMode === "fixed_price"
                  ? `${line.quantity} ${line.quantity > 1 ? "formats" : "format"}`
                  : `${line.quantity} g`;

              return (
                <article
                  key={line.lineKey}
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
                    <p className="mt-2 text-xs font-semibold text-forest/70">
                      {stockLabel}
                    </p>
                    {line.fixedPriceOption && (
                      <p className="mt-2 text-xs text-forest/70">
                        {fixedPriceOptionLabel(line.fixedPriceOption)} - {line.quantityGrams} g au total
                      </p>
                    )}
                    {stockIssue && (
                      <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                        <p>{stockIssue.message}</p>
                        {availableStock > 0 && line.quantityGrams > availableStock && (
                          <button
                            type="button"
                            className="mt-2 underline"
                            onClick={() =>
                              setLineQuantity(
                                line.lineKey,
                                line.fixedPriceOption
                                  ? Math.floor(availableStock / line.fixedPriceOption.quantityGrams)
                                  : availableStock,
                              )
                            }
                          >
                            Ajuster la quantité
                          </button>
                        )}
                      </div>
                    )}
                    <div className="mt-4 flex items-center gap-2">
                      <button
                        className="icon-button"
                        onClick={() => {
                          decrementLine(line.lineKey);
                          trackRemoveFromCart(
                            line.product,
                            line.fixedPriceOption?.quantityGrams || 1,
                          );
                        }}
                      >
                        <Minus size={16} />
                      </button>
                      <span className="min-w-16 text-center">{lineQuantityLabel}</span>
                      <button
                        className="icon-button disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={!canIncrease}
                        onClick={() => {
                          incrementLine(line.lineKey);
                          trackAddToCart(
                            line.product,
                            line.fixedPriceOption?.quantityGrams || 1,
                          );
                        }}
                        title={canIncrease ? "Ajouter" : "Stock maximum atteint"}
                      >
                        <Plus size={16} />
                      </button>
                      <button
                        className="icon-button"
                        onClick={() => {
                          removeLine(line.lineKey);
                          trackRemoveFromCart(line.product, line.quantityGrams);
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <strong className="text-forest">{formatEuro(line.lineTotal)}</strong>
                </article>
              );
            })}
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
                    onChange={(event) => handleCouponInputChange(event.target.value)}
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
              {normalizedCouponCode &&
                normalizedCouponCode !== normalizedAppliedCouponCode && (
                  <p className="text-xs leading-5 text-ink/55">
                    Cliquez sur Appliquer pour utiliser ce code. Les offres
                    automatiques restent actives tant qu'aucun code n'est applique.
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
              {!hasManualPromo &&
                automaticAppliedPromotions.map((promotion) => (
                  <p key={promotion.id} className="flex justify-between text-forest">
                    <span>{promotion.label}</span>
                    <span>-{formatEuro(promotion.discountAmount)}</span>
                  </p>
                ))}
              {!hasManualPromo &&
                !automaticAppliedPromotions.length &&
                automaticProgressMessages.map((message) => (
                  <p key={message} className="text-xs leading-5 text-forest/70">
                    {message}
                  </p>
                ))}
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
              {hasCartIssues && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">
                  <p>Ajustez votre panier avant de continuer.</p>
                  <ul className="mt-1 list-disc pl-5">
                    {cartWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                    {stockIssues.map((issue) => (
                      <li key={issue.lineKey || issue.productId}>{issue.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {hasCartIssues ? (
              <button className="btn-primary mt-6 w-full justify-center opacity-60" disabled>
                Continuer
              </button>
            ) : (
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
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
