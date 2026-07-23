import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PromoBannerSlot } from "../components/PromoBannerSlot";
import { Seo } from "../components/Seo";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { deliveryZones as fallbackDeliveryZones } from "../data/deliveryZones";
import { getDeliveryZonesWithFallback } from "../services/deliveryZonesService";
import type { DeliveryMethod, DeliveryZone, PreferredPaymentMethod } from "../types";
import {
  trackAddShippingInfo,
  trackContactClick,
  trackBeginCheckout,
  getGa4MeasurementContext,
  trackLocalDeliveryZoneSelected,
  trackOrderSubmitted,
  trackPaymentMethodSelected,
} from "../lib/analytics";
import { rememberPendingOrderAnalyticsRevocation } from "../lib/orderAnalyticsRevocation";
import { getCartStockIssues } from "../lib/cartStock";
import { calculateCartPromotions } from "../lib/cartPromotions";
import { formatEuro, quoteOrder, type OrderQuote } from "../services/quoteService";
import {
  effectiveLocalDeliveryMinimum,
  effectivePostalDeliveryMinimum,
  isPostalShippingFree,
  POSTAL_FREE_SHIPPING_THRESHOLD,
} from "../config/deliveryRules";

const contactEmail =
  (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) ||
  "contact@verdanza.fr";
const checkoutErrorMessage =
  "Impossible de valider la commande pour le moment. Veuillez réessayer ou contacter Verdanza par email.";
const promoStorageKey = "verdanza-coupon-code";

const paymentMethodLabels: Record<PreferredPaymentMethod, string> = {
  card_payment_link: "Carte bancaire via lien de paiement après confirmation",
  cash_on_delivery: "Espèces à la livraison locale",
  bank_transfer: "Virement bancaire (bientôt disponible)",
  local_delivery_payment: "Paiement à la livraison locale",
  confirm_with_verdanza: "À confirmer avec Verdanza",
};

export function CheckoutPage() {
  const { itemCount, subtotal, items, lines } = useCart();
  const beginCheckoutSignature = useRef("");
  const shippingSignature = useRef("");
  const paymentSignature = useRef("");
  const { user, customerProfile } = useAuth();
  const navigate = useNavigate();
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>(fallbackDeliveryZones);
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("postal");
  const [deliveryZone, setDeliveryZone] = useState("");
  const [couponCode, setCouponCode] = useState(() =>
    window.localStorage.getItem(promoStorageKey) || "",
  );
  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [automaticQuote, setAutomaticQuote] = useState<OrderQuote | null>(null);
  const [promoMessage, setPromoMessage] = useState("");
  const [isCheckingPromo, setIsCheckingPromo] = useState(false);
  const [customerMessage, setCustomerMessage] = useState("");
  const [preferredPaymentMethod, setPreferredPaymentMethod] =
    useState<PreferredPaymentMethod>("card_payment_link");
  const [complianceAccepted, setComplianceAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [customer, setCustomer] = useState({
    email: "",
    phone: "",
    firstName: "",
    lastName: "",
    line1: "",
    line2: "",
    postalCode: "",
    city: "",
    country: "France",
  });

  const openLocalDeliveryZones = useMemo(
    () =>
      deliveryZones
        .filter((zone) => zone.method === "local_express")
        .filter(isZoneAvailableForCheckout)
        .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0)),
    [deliveryZones],
  );
  const selectedZone = useMemo(
    () => openLocalDeliveryZones.find((zone) => zone.id === deliveryZone),
    [deliveryZone, openLocalDeliveryZones],
  );
  const postalZone = useMemo(
    () => deliveryZones.find((zone) => zone.id === "postal-france" && zone.isActive !== false),
    [deliveryZones],
  );
  const isLocalDelivery = deliveryMethod === "local_express";
  const localDeliveryUnavailable = openLocalDeliveryZones.length === 0;
  const localDeliveryMinimum = effectiveLocalDeliveryMinimum(
    selectedZone?.minimumOrderAmount ?? selectedZone?.minimumOrder,
  );
  const postalDeliveryMinimum = effectivePostalDeliveryMinimum(
    postalZone?.minimumOrderAmount ?? postalZone?.minimumOrder,
  );
  const isBelowLocalMinimum =
    isLocalDelivery && itemCount > 0 && subtotal < localDeliveryMinimum;
  const isBelowPostalMinimum =
    !isLocalDelivery && itemCount > 0 && subtotal < postalDeliveryMinimum;
  const postalShippingFree = isPostalShippingFree(subtotal);
  const amountUntilPostalMinimum = Math.max(0, postalDeliveryMinimum - subtotal);
  const amountUntilFreePostalShipping = Math.max(
    0,
    POSTAL_FREE_SHIPPING_THRESHOLD - subtotal,
  );
  const estimatedDeliveryFee = isLocalDelivery
    ? selectedZone?.fee ?? 0
    : postalZone?.fee ?? 0;
  const automaticPromotions = calculateCartPromotions({
    lines: lines.map((line) => ({
      productId: line.productId,
      name: line.product.name,
      category: line.product.category,
      quantity: line.quantity,
      unitPrice: line.product.price,
    })),
  });
  const hasCouponInput = Boolean(couponCode.trim());
  const hasManualPromo = Boolean(quote?.promoApplied && hasCouponInput);
  const automaticAppliedPromotions = hasCouponInput
    ? []
    : automaticQuote?.appliedPromotions?.length
      ? automaticQuote.appliedPromotions
      : automaticPromotions.appliedPromotions;
  const automaticDiscountAmount = hasCouponInput
    ? 0
    : Number(
        automaticQuote?.promoApplied
          ? automaticQuote.discountAmount
          : automaticPromotions.promotionDiscountTotal,
      );
  const discountAmount = hasManualPromo
    ? Number(quote?.discountAmount || 0)
    : automaticDiscountAmount;
  const estimatedTotal = Math.max(0, subtotal + estimatedDeliveryFee - discountAmount);
  const stockIssues = useMemo(() => getCartStockIssues(lines), [lines]);
  const hasStockIssues = stockIssues.length > 0;

  useEffect(() => {
    const signature = lines.map((line) => `${line.productId}:${line.quantity}`).join("|");
    if (!signature || beginCheckoutSignature.current === signature) return;
    beginCheckoutSignature.current = signature;
    trackBeginCheckout(lines, estimatedTotal);
  }, [estimatedTotal, lines]);

  useEffect(() => {
    if (!lines.length) return;
    const zonePart = isLocalDelivery ? selectedZone?.id || "none" : "postal-france";
    const signature = `${deliveryMethod}:${zonePart}:${lines.map((line) => `${line.productId}:${line.quantity}`).join("|")}`;
    if (shippingSignature.current === signature) return;
    shippingSignature.current = signature;
    trackAddShippingInfo(lines, estimatedTotal, deliveryMethod);
    if (isLocalDelivery && selectedZone) {
      trackLocalDeliveryZoneSelected(selectedZone.id, selectedZone.name);
    }
  }, [deliveryMethod, estimatedTotal, isLocalDelivery, lines, selectedZone]);

  useEffect(() => {
    if (!lines.length) return;
    const signature = `${deliveryMethod}:${preferredPaymentMethod}:${lines.map((line) => `${line.productId}:${line.quantity}`).join("|")}`;
    if (paymentSignature.current === signature) return;
    paymentSignature.current = signature;
    trackPaymentMethodSelected(lines, estimatedTotal, preferredPaymentMethod, deliveryMethod);
  }, [deliveryMethod, estimatedTotal, lines, preferredPaymentMethod]);

  useEffect(() => {
    let cancelled = false;
    getDeliveryZonesWithFallback().then((result) => {
      if (!cancelled) setDeliveryZones(result.zones);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!openLocalDeliveryZones.length) {
      if (deliveryMethod === "local_express") setDeliveryMethod("postal");
      setDeliveryZone("");
      return;
    }
    if (!deliveryZone || !openLocalDeliveryZones.some((zone) => zone.id === deliveryZone)) {
      setDeliveryZone(openLocalDeliveryZones[0].id);
    }
  }, [deliveryMethod, deliveryZone, openLocalDeliveryZones]);

  useEffect(() => {
    if (
      deliveryMethod === "postal" &&
      (preferredPaymentMethod === "local_delivery_payment" ||
        preferredPaymentMethod === "cash_on_delivery")
    ) {
      setPreferredPaymentMethod("card_payment_link");
    }
  }, [deliveryMethod, preferredPaymentMethod]);

  useEffect(() => {
    if (!couponCode.trim()) {
      window.localStorage.removeItem(promoStorageKey);
      setQuote(null);
      setPromoMessage("");
    }
  }, [couponCode]);

  useEffect(() => {
    if (!lines.length || couponCode.trim()) {
      setAutomaticQuote(null);
      return;
    }
    let cancelled = false;
    quoteOrder({
      items,
      deliveryMethod,
      deliveryZone: deliveryMethod === "local_express" ? deliveryZone : "postal-france",
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
  }, [couponCode, deliveryMethod, deliveryZone, items, lines.length, subtotal]);

  useEffect(() => {
    if (!quote?.promoApplied || !couponCode.trim()) return;
    void handleApplyPromo(false).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryMethod, deliveryZone, subtotal]);

  useEffect(() => {
    if (!user) return;
    setCustomer((current) => ({
      ...current,
      email: current.email || user.email || "",
      phone: current.phone || customerProfile?.phone || "",
      firstName:
        current.firstName ||
        (customerProfile?.displayName || user.displayName || "").split(" ")[0] ||
        "",
      lastName:
        current.lastName ||
        (customerProfile?.displayName || user.displayName || "")
          .split(" ")
          .slice(1)
          .join(" "),
    }));
  }, [customerProfile, user]);

  async function handleApplyPromo(showSuccess = true) {
    const code = couponCode.trim().toUpperCase();
    setCouponCode(code);
    setPromoMessage("");
    setQuote(null);
    if (!code) return null;
    setIsCheckingPromo(true);
    try {
      const nextQuote = await quoteOrder({
        items,
        deliveryMethod,
        deliveryZone: deliveryMethod === "local_express" ? deliveryZone : "postal-france",
        couponCode: code,
      });
      setQuote(nextQuote);
      window.localStorage.setItem(promoStorageKey, code);
      if (showSuccess) setPromoMessage("Code promo appliqué.");
      return nextQuote;
    } catch (error) {
      window.localStorage.removeItem(promoStorageKey);
      const message =
        error instanceof Error ? error.message : "Ce code promo n'est pas valide.";
      setPromoMessage(message);
      throw new Error(message);
    } finally {
      setIsCheckingPromo(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      if (hasStockIssues) {
        throw new Error(
          "Certains produits dépassent le stock disponible. Veuillez ajuster votre panier avant de continuer.",
        );
      }
      if (isBelowLocalMinimum) {
        throw new Error("Le minimum de commande pour la livraison locale est de 20 €.");
      }
      if (isBelowPostalMinimum) {
        throw new Error("Le minimum de commande pour la livraison postale est de 15 €.");
      }
      if (deliveryMethod === "local_express" && !selectedZone) {
        throw new Error(
          "La zone de livraison sélectionnée n’est actuellement pas disponible. Veuillez choisir une autre zone ou contacter Verdanza.",
        );
      }
      if (deliveryMethod === "postal" && preferredPaymentMethod === "cash_on_delivery") {
        throw new Error("Le paiement en espèces est réservé à la livraison locale.");
      }
      if (preferredPaymentMethod === "bank_transfer") {
        throw new Error("Le virement bancaire n'est pas encore disponible.");
      }
      const finalQuote = couponCode.trim() ? await handleApplyPromo(false) : quote;

      const authToken = user ? await user.getIdToken() : undefined;
      const analyticsContext = await getGa4MeasurementContext().catch(() => null);
      const response = await fetch("/api/create-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items,
          authToken,
          analyticsContext,
          deliveryMethod,
          deliveryZone:
            deliveryMethod === "local_express" ? deliveryZone : "postal-france",
          couponCode: couponCode.trim() || undefined,
          customerMessage: customerMessage.trim() || undefined,
          preferredPaymentMethod,
          complianceAccepted,
          customer: {
            email: customer.email,
            phone: customer.phone,
            firstName: customer.firstName,
            lastName: customer.lastName,
            address: {
              firstName: customer.firstName,
              lastName: customer.lastName,
              line1: customer.line1,
              line2: customer.line2,
              postalCode: customer.postalCode,
              city: customer.city,
              country: customer.country,
            },
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        orderId?: string;
        analyticsRevocationToken?: string;
        error?: string;
      };

      if (!response.ok || !payload.orderId) {
        throw new Error(payload.error || checkoutErrorMessage);
      }

      rememberPendingOrderAnalyticsRevocation(
        payload.orderId,
        payload.analyticsRevocationToken,
      );

      trackOrderSubmitted({
        transactionId: payload.orderId,
        lines,
        value: finalQuote?.total ?? estimatedTotal,
        coupon: finalQuote?.couponCode || undefined,
        shippingTier: deliveryMethod,
        paymentMethod: preferredPaymentMethod,
      });

      window.sessionStorage.setItem(
        "verdanza:lastOrderSummary",
        JSON.stringify({
          orderId: payload.orderId,
          orderType: "order",
          items: lines.map((line) => ({
            name: line.product.name,
            quantity: line.quantity,
            total: line.lineTotal,
          })),
          delivery:
            deliveryMethod === "local_express"
              ? selectedZone?.name || "Livraison locale"
              : "Livraison postale en France",
          deliveryNote:
            deliveryMethod === "local_express"
              ? "Livraison locale à partir de 20 € d'achat."
              : postalShippingFree
                ? "Livraison postale offerte."
                : "Frais postaux confirmés avec vous après validation de la commande.",
          preferredPaymentMethod: paymentMethodLabels[preferredPaymentMethod],
          couponCode: finalQuote?.couponCode || undefined,
          discountAmount: finalQuote?.discountAmount || automaticDiscountAmount || 0,
          appliedPromotions: finalQuote?.appliedPromotions?.length
            ? finalQuote.appliedPromotions
            : automaticAppliedPromotions,
          total: finalQuote?.total ?? estimatedTotal,
        }),
      );

      navigate(`/checkout/success?order_id=${encodeURIComponent(payload.orderId)}`);
    } catch (checkoutError) {
      console.error("Checkout submission failed", checkoutError);
      const message =
        checkoutError instanceof Error &&
        (checkoutError.message.includes("minimum de commande") ||
          checkoutError.message.includes("Code promo") ||
          checkoutError.message.includes("code promo") ||
          checkoutError.message.includes("promo") ||
          checkoutError.message.includes("stock disponible") ||
          checkoutError.message.includes("Stock insuffisant") ||
          checkoutError.message.includes("produit indisponible") ||
          checkoutError.message.includes("Produit indisponible") ||
          checkoutError.message.includes("produits dépassent le stock") ||
          checkoutError.message.includes("Livraison locale disponible") ||
          checkoutError.message.includes("zone de livraison"))
          ? checkoutError.message
          : checkoutErrorMessage;
      setError(message);
      setIsSubmitting(false);
    }
  }

  return (
    <main className="container-page py-12">
      <Seo
        title="Finaliser ma commande - Verdanza CBD"
        description="Finalisation de commande Verdanza CBD avec vérification des disponibilités."
        path="/checkout"
        noindex
      />
      <div className="page-intro">
        <h1>Finaliser ma commande</h1>
        <p>
          Votre commande sera transmise à Verdanza. Nous vous contacterons
          rapidement si nécessaire pour confirmer les disponibilités, la
          livraison et le règlement.
        </p>
      </div>

      <section className="mt-8 rounded-lg border border-champagne/30 bg-cream p-5 text-sm leading-6 text-forest">
        <p>
          Contact :{" "}
          <a
            className="underline decoration-champagne"
            href={`mailto:${contactEmail}`}
            onClick={() => trackContactClick("email", "checkout")}
          >
            {contactEmail}
          </a>
        </p>
      </section>

      <PromoBannerSlot placement="checkout" type="checkout_notice" className="mt-6 grid gap-3" />

      {!user && itemCount > 0 && (
        <section className="mt-8 rounded-lg border border-champagne/30 bg-cream p-5">
          <p className="text-sm leading-6 text-forest">
            Connectez-vous pour suivre votre commande et retrouver votre historique.
            La commande sans compte reste disponible.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to="/connexion" state={{ from: "/checkout" }} className="btn-primary">
              Se connecter
            </Link>
            <Link to="/inscription" state={{ from: "/checkout" }} className="btn-secondary">
              Créer un compte
            </Link>
          </div>
        </section>
      )}

      {user && itemCount > 0 && (
        <section className="mt-8 rounded-lg border border-forest/10 bg-cream p-5 text-sm text-forest">
          Votre commande sera rattachée au compte {user.email}.
        </section>
      )}

      {itemCount === 0 ? (
        <section className="mt-10 rounded-lg border border-forest/10 bg-cream p-8">
          <p>Votre panier est vide.</p>
          <Link to="/boutique" className="btn-primary mt-6 inline-flex">
            Voir la boutique
          </Link>
        </section>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="mt-10 grid gap-8 lg:grid-cols-[1fr_380px]"
        >
          <section className="grid gap-6">
            <div className="rounded-lg border border-forest/10 bg-ivory p-6">
              <h2 className="font-display text-3xl text-forest">Contact</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <CheckoutInput
                  label="Prénom"
                  value={customer.firstName}
                  onChange={(firstName) => setCustomer({ ...customer, firstName })}
                />
                <CheckoutInput
                  label="Nom"
                  value={customer.lastName}
                  onChange={(lastName) => setCustomer({ ...customer, lastName })}
                />
                <CheckoutInput
                  label="Email"
                  type="email"
                  value={customer.email}
                  onChange={(email) => setCustomer({ ...customer, email })}
                />
                <CheckoutInput
                  label="Téléphone"
                  value={customer.phone}
                  onChange={(phone) => setCustomer({ ...customer, phone })}
                />
              </div>
            </div>

            <div className="rounded-lg border border-forest/10 bg-ivory p-6">
              <h2 className="font-display text-3xl text-forest">Livraison</h2>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <DeliveryChoice
                  checked={deliveryMethod === "postal"}
                  title="Livraison postale en France"
                  text="Livraison postale disponible en France à partir de 15 € d'achat. Livraison postale offerte à partir de 60 €."
                  onChange={() => setDeliveryMethod("postal")}
                />
                <DeliveryChoice
                  checked={deliveryMethod === "local_express"}
                  title="Livraison locale Aix-en-Provence"
                  text={
                    localDeliveryUnavailable
                      ? "Livraison locale temporairement indisponible. Vous pouvez choisir la livraison postale."
                      : "Livraison locale Aix-en-Provence et alentours, 7j/7 de 11h à 01h, à partir de 20 € d'achat."
                  }
                  disabled={localDeliveryUnavailable}
                  onChange={() => setDeliveryMethod("local_express")}
                />
              </div>

              {localDeliveryUnavailable && (
                <p className="mt-4 rounded-md border border-champagne/40 bg-cream p-3 text-sm leading-6 text-forest">
                  Livraison locale temporairement indisponible. Vous pouvez choisir
                  la livraison postale ou contacter Verdanza par email à{" "}
                  <a
                    className="underline decoration-champagne"
                    href={`mailto:${contactEmail}`}
                    onClick={() => trackContactClick("email", "checkout")}
                  >
                    {contactEmail}
                  </a>
                  .
                </p>
              )}

              {isLocalDelivery && (
                <div className="mt-5">
                  <label className="block text-sm font-medium text-forest">
                    Zone locale
                    <select
                      className="input-field mt-2"
                      value={deliveryZone}
                      onChange={(event) => setDeliveryZone(event.target.value)}
                    >
                      {openLocalDeliveryZones.map((zone) => (
                        <option key={zone.id} value={zone.id}>
                          {zone.name}
                          {zone.customerMessage ? ` - ${zone.customerMessage}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Link
                    to="/livraison-locale"
                    className="mt-2 inline-flex text-sm font-medium text-forest underline decoration-champagne underline-offset-4"
                  >
                    Voir les zones de livraison locale
                  </Link>
                </div>
              )}

              {isBelowLocalMinimum && (
                <p className="mt-4 rounded-md border border-champagne/40 bg-cream p-3 text-sm leading-6 text-forest">
                  Le minimum de commande pour la livraison locale est de 20 €. Il manque{" "}
                  {(localDeliveryMinimum - subtotal).toFixed(2).replace(".", ",")} EUR.
                </p>
              )}

              {!isLocalDelivery && (
                <p className="mt-4 rounded-md border border-champagne/30 bg-cream p-3 text-sm leading-6 text-forest">
                  Livraison postale disponible en France à partir de 15 € d'achat.
                  Livraison postale offerte à partir de 60 €.
                  <br />
                  {isBelowPostalMinimum
                    ? `Ajoutez ${amountUntilPostalMinimum.toFixed(2).replace(".", ",")} € pour atteindre le minimum de commande postale.`
                    : postalShippingFree
                      ? "Livraison postale offerte."
                      : `Commande postale possible. Ajoutez ${amountUntilFreePostalShipping.toFixed(2).replace(".", ",")} € pour bénéficier de la livraison postale offerte. Frais postaux confirmés avec vous après validation de la commande.`}
                </p>
              )}

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <CheckoutInput
                  label="Adresse"
                  value={customer.line1}
                  onChange={(line1) => setCustomer({ ...customer, line1 })}
                />
                <CheckoutInput
                  label="Complément"
                  required={false}
                  value={customer.line2}
                  onChange={(line2) => setCustomer({ ...customer, line2 })}
                />
                <CheckoutInput
                  label="Code postal"
                  value={customer.postalCode}
                  onChange={(postalCode) => setCustomer({ ...customer, postalCode })}
                />
                <CheckoutInput
                  label="Ville"
                  value={customer.city}
                  onChange={(city) => setCustomer({ ...customer, city })}
                />
                {!isLocalDelivery && (
                  <CheckoutInput
                    label="Pays"
                    value={customer.country}
                    onChange={(country) => setCustomer({ ...customer, country })}
                  />
                )}
              </div>
            </div>

            <div className="rounded-lg border border-forest/10 bg-ivory p-6">
              <h2 className="font-display text-3xl text-forest">Règlement</h2>
              <p className="mt-4 text-sm leading-6 text-ink/70">
                Le règlement est confirmé après validation de votre commande. Si
                vous souhaitez payer par carte bancaire, un lien de paiement
                sécurisé pourra vous être envoyé par email et/ou par message après
                confirmation de votre commande par l'équipe Verdanza.
              </p>
              <p className="mt-3 rounded-md border border-champagne/30 bg-cream p-3 text-sm leading-6 text-forest">
                {isLocalDelivery
                  ? "Pour la livraison locale, le règlement sera confirmé avec vous après validation de la commande. Vous pourrez régler selon les modalités proposées par Verdanza. Si vous souhaitez payer par carte bancaire, un lien de paiement pourra vous être envoyé."
                  : "Pour la livraison postale, la commande sera confirmée par Verdanza avant expédition. Si vous souhaitez payer par carte bancaire, un lien de paiement vous sera envoyé par email et/ou message après confirmation du montant final."}
              </p>
              <label className="mt-5 block text-sm font-medium text-forest">
                Mode de règlement souhaité
                <select
                  className="input-field mt-2"
                  value={preferredPaymentMethod}
                  onChange={(event) =>
                    setPreferredPaymentMethod(event.target.value as PreferredPaymentMethod)
                  }
                >
                  <option value="card_payment_link">
                    {paymentMethodLabels.card_payment_link}
                  </option>
                  <option value="bank_transfer" disabled>
                    {paymentMethodLabels.bank_transfer}
                  </option>
                  {isLocalDelivery && (
                    <option value="cash_on_delivery">
                      {paymentMethodLabels.cash_on_delivery}
                    </option>
                  )}
                  <option value="confirm_with_verdanza">
                    {paymentMethodLabels.confirm_with_verdanza}
                  </option>
                </select>
              </label>
              <label className="mt-5 block text-sm font-medium text-forest">
                Message optionnel
                <textarea
                  className="input-field mt-2 min-h-32 resize-y"
                  value={customerMessage}
                  onChange={(event) => setCustomerMessage(event.target.value)}
                  maxLength={1000}
                  placeholder="Précision sur votre commande, vos disponibilités ou la livraison."
                />
              </label>
            </div>
          </section>

          <aside className="h-fit rounded-lg border border-champagne/30 bg-cream p-6">
            <h2 className="font-display text-3xl text-forest">Résumé</h2>
            <div className="mt-5 grid gap-3 text-sm">
              {lines.map((line) => (
                <p key={line.productId} className="flex justify-between gap-4">
                  <span>
                    {line.product.name} x {line.quantity} g
                  </span>
                  <span>{formatEuro(line.lineTotal)}</span>
                </p>
              ))}
              <p className="flex justify-between border-t border-forest/10 pt-3">
                <span>Sous-total estimé</span>
                <span>{formatEuro(subtotal)}</span>
              </p>
              <p className="flex justify-between">
                <span>Livraison estimée</span>
                <span>
                  {!isLocalDelivery && postalShippingFree
                    ? "Offerte"
                    : !isLocalDelivery
                      ? "À confirmer"
                      : formatEuro(estimatedDeliveryFee)}
                </span>
              </p>
              {!isLocalDelivery && (
                <p className="text-xs leading-5 text-ink/55">
                  {postalShippingFree
                    ? "Livraison postale offerte."
                    : "Frais postaux confirmés avec vous après validation de la commande."}
                </p>
              )}
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
                    onClick={() => void handleApplyPromo().catch(() => undefined)}
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
              {!hasManualPromo &&
                automaticAppliedPromotions.map((promotion) => (
                  <p key={promotion.id} className="flex justify-between text-forest">
                    <span>{promotion.label}</span>
                    <span>-{formatEuro(promotion.discountAmount)}</span>
                  </p>
                ))}
              {!hasManualPromo &&
                !automaticAppliedPromotions.length &&
                automaticPromotions.progressMessages.map((message) => (
                  <p key={message} className="text-xs leading-5 text-forest/70">
                    {message}
                  </p>
                ))}
              <p className="flex justify-between text-lg font-semibold text-forest">
                <span>Total estimé</span>
                <span>{formatEuro(estimatedTotal)}</span>
              </p>
              {hasStockIssues && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">
                  <p>Ajustez votre panier avant de valider.</p>
                  <ul className="mt-1 list-disc pl-5">
                    {stockIssues.map((issue) => (
                      <li key={issue.productId}>{issue.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="rounded-md border border-forest/10 bg-ivory p-3 text-xs leading-5 text-forest">
                Paiement : lien envoyé après confirmation si paiement CB souhaité.
                <br />
                Souhait indiqué : {paymentMethodLabels[preferredPaymentMethod]}.
              </p>
              {couponCode.trim() && !quote?.promoApplied && (
                <p className="text-xs leading-5 text-ink/55">
                  La remise sera vérifiée et appliquée avant validation de la commande.
                </p>
              )}
            </div>
            <label className="mt-6 flex items-start gap-3 text-sm text-ink/70">
              <input
                type="checkbox"
                className="mt-1"
                checked={complianceAccepted}
                onChange={(event) => setComplianceAccepted(event.target.checked)}
                required
              />
              Je confirme être majeur et avoir pris connaissance des informations
              de conformité.
            </label>
            {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
            <button className="btn-primary mt-6 w-full" disabled={isSubmitting || hasStockIssues}>
              {isSubmitting ? "Validation..." : "Valider ma commande"}
            </button>
          </aside>
        </form>
      )}
    </main>
  );
}

function DeliveryChoice({
  checked,
  title,
  text,
  disabled = false,
  onChange,
}: {
  checked: boolean;
  title: string;
  text: string;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex gap-3 rounded-md border border-forest/10 bg-cream p-4 text-sm leading-6 text-forest has-[:checked]:border-champagne ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      }`}
    >
      <input
        type="radio"
        name="deliveryMethod"
        className="mt-1"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span>
        <strong className="block">{title}</strong>
        <span className="text-ink/65">{text}</span>
      </span>
    </label>
  );
}

function isZoneAvailableForCheckout(zone: DeliveryZone) {
  return (
    zone.isActive !== false &&
    zone.isOpen !== false &&
    (zone.status || "open") === "open" &&
    zone.isArchived !== true
  );
}

function CheckoutInput({
  label,
  value,
  onChange,
  type = "text",
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="text-sm font-medium text-forest">
      {label}
      <input
        className="input-field mt-2"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
    </label>
  );
}
