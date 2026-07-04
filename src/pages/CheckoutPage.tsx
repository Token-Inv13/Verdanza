import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Seo } from "../components/Seo";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { deliveryZones, localDeliveryZones } from "../data/deliveryZones";
import type { DeliveryMethod } from "../types";
import { trackEvent } from "../lib/analytics";

export function CheckoutPage() {
  const { itemCount, subtotal, items, lines } = useCart();
  const { user, customerProfile } = useAuth();
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("postal");
  const [deliveryZone, setDeliveryZone] = useState(localDeliveryZones[0]?.id ?? "");
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
  const selectedZone = useMemo(
    () => localDeliveryZones.find((zone) => zone.id === deliveryZone),
    [deliveryZone],
  );
  const postalZone = useMemo(
    () => deliveryZones.find((zone) => zone.id === "postal-france"),
    [],
  );
  const isLocalDelivery = deliveryMethod === "local_express";
  const localDeliveryMinimum = selectedZone?.minimumOrder ?? 30;
  const isBelowLocalMinimum = isLocalDelivery && itemCount > 0 && subtotal < localDeliveryMinimum;
  const estimatedDeliveryFee = isLocalDelivery
    ? selectedZone?.fee ?? 0
    : postalZone?.fee ?? 0;
  const estimatedTotal = subtotal + estimatedDeliveryFee;

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
          `Livraison locale disponible a partir de ${localDeliveryMinimum} EUR d'achat.`,
        );
      }
      const authToken = user ? await user.getIdToken() : undefined;
      trackEvent("begin_checkout", {
        itemCount,
        subtotal,
        deliveryMethod,
      });
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items,
          authToken,
          deliveryMethod,
          deliveryZone: deliveryMethod === "local_express" ? deliveryZone : "postal-france",
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
      const payload = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || "Checkout indisponible.");
      }
      window.location.assign(payload.url);
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Impossible de demarrer le paiement.",
      );
      setIsSubmitting(false);
    }
  }

  return (
    <main className="container-page py-12">
      <Seo
        title="Finaliser ma commande - Verdanza CBD"
        description="Finalisation de commande Verdanza CBD avec paiement securise."
      />
      <div className="page-intro">
        <h1>Finaliser ma commande</h1>
        <p>
          Finalisez votre commande Verdanza. Verifiez vos informations,
          choisissez votre mode de livraison, puis procedez au paiement securise.
        </p>
      </div>
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
              Creer un compte
            </Link>
          </div>
        </section>
      )}
      {user && itemCount > 0 && (
        <section className="mt-8 rounded-lg border border-forest/10 bg-cream p-5 text-sm text-forest">
          Votre commande sera rattachee au compte {user.email}.
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
                <CheckoutInput label="Prénom" value={customer.firstName} onChange={(firstName) => setCustomer({ ...customer, firstName })} />
                <CheckoutInput label="Nom" value={customer.lastName} onChange={(lastName) => setCustomer({ ...customer, lastName })} />
                <CheckoutInput label="Email" type="email" value={customer.email} onChange={(email) => setCustomer({ ...customer, email })} />
                <CheckoutInput label="Téléphone" value={customer.phone} onChange={(phone) => setCustomer({ ...customer, phone })} />
              </div>
            </div>

            <div className="rounded-lg border border-forest/10 bg-ivory p-6">
              <h2 className="font-display text-3xl text-forest">Livraison</h2>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <DeliveryChoice
                  checked={deliveryMethod === "postal"}
                  title="Livraison postale en France"
                  text="Livraison postale disponible en France. Les frais et delais sont indiques avant validation de la commande."
                  onChange={() => setDeliveryMethod("postal")}
                />
                <DeliveryChoice
                  checked={deliveryMethod === "local_express"}
                  title="Livraison locale Aix-en-Provence"
                  text="Livraison locale disponible a Aix-en-Provence et alentours, 7j/7 de 11h a 01h, a partir de 30 EUR d'achat."
                  onChange={() => setDeliveryMethod("local_express")}
                />
              </div>
              {isLocalDelivery && (
                <label className="mt-5 block text-sm font-medium text-forest">
                  Zone locale
                  <select
                    className="input-field mt-2"
                    value={deliveryZone}
                    onChange={(event) => setDeliveryZone(event.target.value)}
                  >
                    {localDeliveryZones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name}
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
                  Livraison postale disponible en France. Les delais dependent du
                  transporteur et seront confirmes avec le suivi de commande.
                </p>
              )}
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <CheckoutInput label="Adresse" value={customer.line1} onChange={(line1) => setCustomer({ ...customer, line1 })} />
                <CheckoutInput label="Complément" required={false} value={customer.line2} onChange={(line2) => setCustomer({ ...customer, line2 })} />
                <CheckoutInput label="Code postal" value={customer.postalCode} onChange={(postalCode) => setCustomer({ ...customer, postalCode })} />
                <CheckoutInput label="Ville" value={customer.city} onChange={(city) => setCustomer({ ...customer, city })} />
                {!isLocalDelivery && (
                  <CheckoutInput label="Pays" value={customer.country} onChange={(country) => setCustomer({ ...customer, country })} />
                )}
              </div>
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
              <p className="flex justify-between text-lg font-semibold text-forest">
                <span>Total estimé</span>
                <span>{estimatedTotal.toFixed(2).replace(".", ",")} EUR</span>
              </p>
            </div>
            <label className="mt-6 flex items-start gap-3 text-sm text-ink/70">
              <input type="checkbox" className="mt-1" required />
              Je confirme être majeur et avoir pris connaissance des informations
              de conformité.
            </label>
            {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
            <button className="btn-primary mt-6 w-full" disabled={isSubmitting}>
              {isSubmitting ? "Redirection..." : "Payer ma commande"}
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
  onChange,
}: {
  checked: boolean;
  title: string;
  text: string;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-md border border-forest/10 bg-cream p-4 text-sm leading-6 text-forest has-[:checked]:border-champagne">
      <input
        type="radio"
        name="deliveryMethod"
        className="mt-1"
        checked={checked}
        onChange={onChange}
      />
      <span>
        <strong className="block">{title}</strong>
        <span className="text-ink/65">{text}</span>
      </span>
    </label>
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
