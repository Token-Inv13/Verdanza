import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Seo } from "../components/Seo";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { deliveryZones as fallbackDeliveryZones } from "../data/deliveryZones";
import { getDeliveryZonesWithFallback } from "../services/deliveryZonesService";
import type { DeliveryMethod, DeliveryZone } from "../types";
import { trackEvent } from "../lib/analytics";
import { isPreorderActive } from "../lib/preorder";

const contactPhone =
  (import.meta.env.VITE_CONTACT_PHONE as string | undefined) || "07 80 81 41 37";
const contactEmail =
  (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) ||
  "contact@verdanza.fr";
const checkoutErrorMessage =
  "Impossible de valider la commande pour le moment. Veuillez réessayer ou contacter Verdanza au 07 80 81 41 37.";

export function CheckoutPage() {
  const { itemCount, subtotal, items, lines } = useCart();
  const { user, customerProfile } = useAuth();
  const navigate = useNavigate();
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>(fallbackDeliveryZones);
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("postal");
  const [deliveryZone, setDeliveryZone] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
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
  const localDeliveryMinimum =
    selectedZone?.minimumOrderAmount ?? selectedZone?.minimumOrder ?? 30;
  const isBelowLocalMinimum =
    isLocalDelivery && itemCount > 0 && subtotal < localDeliveryMinimum;
  const estimatedDeliveryFee = isLocalDelivery
    ? selectedZone?.fee ?? 0
    : postalZone?.fee ?? 0;
  const estimatedTotal = subtotal + estimatedDeliveryFee;
  const preorderActive = isPreorderActive();

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      if (isBelowLocalMinimum) {
        throw new Error(
          `Livraison locale disponible à partir de ${localDeliveryMinimum} EUR d'achat.`,
        );
      }
      if (deliveryMethod === "local_express" && !selectedZone) {
        throw new Error(
          "La zone de livraison sélectionnée n’est actuellement pas disponible. Veuillez choisir une autre zone ou contacter Verdanza.",
        );
      }

      const authToken = user ? await user.getIdToken() : undefined;
      trackEvent("begin_checkout", {
        itemCount,
        subtotal,
        deliveryMethod,
      });

      const response = await fetch("/api/create-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items,
          authToken,
          deliveryMethod,
          deliveryZone:
            deliveryMethod === "local_express" ? deliveryZone : "postal-france",
          couponCode: couponCode.trim() || undefined,
          customerMessage: customerMessage.trim() || undefined,
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
      };

      if (!response.ok || !payload.orderId) {
        throw new Error(checkoutErrorMessage);
      }

      window.sessionStorage.setItem(
        "verdanza:lastOrderSummary",
        JSON.stringify({
          orderId: payload.orderId,
          orderType: preorderActive ? "preorder" : "order",
          items: lines.map((line) => ({
            name: line.product.name,
            quantity: line.quantity,
            total: line.lineTotal,
          })),
          delivery:
            deliveryMethod === "local_express"
              ? selectedZone?.name || "Livraison locale"
              : "Livraison postale en France",
          total: estimatedTotal,
        }),
      );

      navigate(
        `/checkout/success?order_id=${encodeURIComponent(payload.orderId)}${
          preorderActive ? "&type=preorder" : ""
        }`,
      );
    } catch (checkoutError) {
      console.error("Checkout submission failed", checkoutError);
      const message =
        checkoutError instanceof Error &&
        (checkoutError.message.includes("Livraison locale disponible") ||
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
        title={
          preorderActive
            ? "Finaliser ma précommande - Verdanza CBD"
            : "Finaliser ma commande - Verdanza CBD"
        }
        description="Finalisation de commande Verdanza CBD avec vérification des disponibilités."
      />
      <div className="page-intro">
        <h1>{preorderActive ? "Finaliser ma précommande" : "Finaliser ma commande"}</h1>
        <p>
          {preorderActive
            ? "Votre précommande sera transmise à Verdanza. Nous vous contacterons rapidement pour confirmer les disponibilités, la livraison et le règlement."
            : "Votre commande sera transmise à Verdanza. Nous vous contacterons rapidement par téléphone ou par email pour confirmer les disponibilités, la livraison et le règlement."}
        </p>
      </div>

      {preorderActive && (
        <section className="mt-8 rounded-lg border border-champagne/40 bg-cream p-5 text-sm leading-6 text-forest">
          <strong className="block text-base">Précommande</strong>
          <span>
            L'ouverture officielle est prévue le jeudi 16 juillet. Votre panier
            peut être validé dès maintenant, sans paiement en ligne.
          </span>
        </section>
      )}

      <section className="mt-8 rounded-lg border border-champagne/30 bg-cream p-5 text-sm leading-6 text-forest">
        <p>Contact direct : {contactPhone}</p>
        <p>
          Email :{" "}
          <a className="underline decoration-champagne" href={`mailto:${contactEmail}`}>
            {contactEmail}
          </a>
        </p>
      </section>

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
                  text="Livraison postale disponible en France. Les frais et délais sont indiqués avant validation de la commande."
                  onChange={() => setDeliveryMethod("postal")}
                />
                <DeliveryChoice
                  checked={deliveryMethod === "local_express"}
                  title="Livraison locale Aix-en-Provence"
                  text={
                    localDeliveryUnavailable
                      ? "Livraison locale temporairement indisponible. Vous pouvez choisir la livraison postale."
                      : "Livraison locale disponible à Aix-en-Provence et alentours selon les zones ouvertes."
                  }
                  disabled={localDeliveryUnavailable}
                  onChange={() => setDeliveryMethod("local_express")}
                />
              </div>

              {localDeliveryUnavailable && (
                <p className="mt-4 rounded-md border border-champagne/40 bg-cream p-3 text-sm leading-6 text-forest">
                  Livraison locale temporairement indisponible. Vous pouvez choisir
                  la livraison postale ou contacter Verdanza au 07 80 81 41 37.
                </p>
              )}

              {isLocalDelivery && (
                <label className="mt-5 block text-sm font-medium text-forest">
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
              )}

              {isBelowLocalMinimum && (
                <p className="mt-4 rounded-md border border-champagne/40 bg-cream p-3 text-sm leading-6 text-forest">
                  Minimum livraison locale : {localDeliveryMinimum} EUR. Il manque{" "}
                  {(localDeliveryMinimum - subtotal).toFixed(2).replace(".", ",")} EUR.
                </p>
              )}

              {!isLocalDelivery && (
                <p className="mt-4 rounded-md border border-champagne/30 bg-cream p-3 text-sm leading-6 text-forest">
                  Livraison postale disponible en France. Les délais dépendent du
                  transporteur. Le règlement et les frais de livraison sont
                  confirmés directement avec vous après validation.
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
                Le règlement est confirmé directement avec vous après validation
                de la commande. Aucun paiement en ligne n'est demandé sur le site
                pour le moment.
              </p>
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
                  <span>{line.lineTotal.toFixed(2).replace(".", ",")} EUR</span>
                </p>
              ))}
              <p className="flex justify-between border-t border-forest/10 pt-3">
                <span>Sous-total estimé</span>
                <span>{subtotal.toFixed(2).replace(".", ",")} EUR</span>
              </p>
              <p className="flex justify-between">
                <span>Livraison estimée</span>
                <span>{estimatedDeliveryFee.toFixed(2).replace(".", ",")} EUR</span>
              </p>
              <label className="grid gap-2 border-t border-forest/10 pt-3 text-sm font-medium text-forest">
                Code promo
                <input
                  className="input-field"
                  value={couponCode}
                  onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
                  placeholder="WELCOME10"
                />
              </label>
              <p className="flex justify-between text-lg font-semibold text-forest">
                <span>Total estimé</span>
                <span>{estimatedTotal.toFixed(2).replace(".", ",")} EUR</span>
              </p>
              {couponCode.trim() && (
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
            <button className="btn-primary mt-6 w-full" disabled={isSubmitting}>
              {isSubmitting
                ? "Validation..."
                : preorderActive
                  ? "Valider ma précommande"
                  : "Valider ma commande"}
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
