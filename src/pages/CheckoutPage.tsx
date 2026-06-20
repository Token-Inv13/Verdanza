import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Seo } from "../components/Seo";
import { useCart } from "../context/CartContext";
import { localDeliveryZones } from "../data/deliveryZones";
import type { DeliveryMethod } from "../types";

export function CheckoutPage() {
  const { itemCount, subtotal, items, lines } = useCart();
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
  const estimatedDeliveryFee = useMemo(() => {
    if (deliveryMethod === "postal") return subtotal >= 60 ? 0 : 5.9;
    return localDeliveryZones.find((zone) => zone.id === deliveryZone)?.fee ?? 4.9;
  }, [deliveryMethod, deliveryZone, subtotal]);
  const estimatedTotal = subtotal + estimatedDeliveryFee;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items,
          deliveryMethod,
          deliveryZone: deliveryMethod === "local_express" ? deliveryZone : undefined,
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
        title="Checkout Stripe - Verdanza CBD"
        description="Paiement securise Stripe Checkout pour Verdanza CBD."
      />
      <div className="page-intro">
        <h1>Checkout</h1>
        <p>
          Le serveur relit les produits Firestore, verifie le stock et recalcule
          le total avant de creer la session Stripe.
        </p>
      </div>
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
                <CheckoutInput label="Prenom" value={customer.firstName} onChange={(firstName) => setCustomer({ ...customer, firstName })} />
                <CheckoutInput label="Nom" value={customer.lastName} onChange={(lastName) => setCustomer({ ...customer, lastName })} />
                <CheckoutInput label="Email" type="email" value={customer.email} onChange={(email) => setCustomer({ ...customer, email })} />
                <CheckoutInput label="Telephone" value={customer.phone} onChange={(phone) => setCustomer({ ...customer, phone })} />
              </div>
            </div>

            <div className="rounded-lg border border-forest/10 bg-ivory p-6">
              <h2 className="font-display text-3xl text-forest">Livraison</h2>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <label className="feature-panel cursor-pointer">
                  <input
                    type="radio"
                    name="delivery"
                    value="postal"
                    checked={deliveryMethod === "postal"}
                    onChange={() => setDeliveryMethod("postal")}
                  />
                  <h3 className="mt-2 font-display text-2xl text-forest">
                    Livraison postale
                  </h3>
                  <p>Expedition suivie et discrete.</p>
                </label>
                <label className="feature-panel cursor-pointer">
                  <input
                    type="radio"
                    name="delivery"
                    value="local_express"
                    checked={deliveryMethod === "local_express"}
                    onChange={() => setDeliveryMethod("local_express")}
                  />
                  <h3 className="mt-2 font-display text-2xl text-forest">
                    Express Aix
                  </h3>
                  <p>Zone locale selon disponibilite.</p>
                </label>
              </div>
              {deliveryMethod === "local_express" && (
                <label className="mt-5 block text-sm font-medium text-forest">
                  Zone locale
                  <select
                    className="input-field mt-2"
                    value={deliveryZone}
                    onChange={(event) => setDeliveryZone(event.target.value)}
                  >
                    {localDeliveryZones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name} - {zone.fee.toFixed(2).replace(".", ",")} EUR
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <CheckoutInput label="Adresse" value={customer.line1} onChange={(line1) => setCustomer({ ...customer, line1 })} />
                <CheckoutInput label="Complement" required={false} value={customer.line2} onChange={(line2) => setCustomer({ ...customer, line2 })} />
                <CheckoutInput label="Code postal" value={customer.postalCode} onChange={(postalCode) => setCustomer({ ...customer, postalCode })} />
                <CheckoutInput label="Ville" value={customer.city} onChange={(city) => setCustomer({ ...customer, city })} />
              </div>
            </div>
          </section>

          <aside className="h-fit rounded-lg border border-champagne/30 bg-cream p-6">
            <h2 className="font-display text-3xl text-forest">Resume</h2>
            <div className="mt-5 grid gap-3 text-sm">
              {lines.map((line) => (
                <p key={line.productId} className="flex justify-between gap-4">
                  <span>
                    {line.product.name} x {line.quantity}
                  </span>
                  <span>{line.lineTotal.toFixed(2).replace(".", ",")} EUR</span>
                </p>
              ))}
              <p className="flex justify-between border-t border-forest/10 pt-3">
                <span>Sous-total estime</span>
                <span>{subtotal.toFixed(2).replace(".", ",")} EUR</span>
              </p>
              <p className="flex justify-between">
                <span>Livraison estimee</span>
                <span>{estimatedDeliveryFee.toFixed(2).replace(".", ",")} EUR</span>
              </p>
              <p className="flex justify-between text-lg font-semibold text-forest">
                <span>Total estime</span>
                <span>{estimatedTotal.toFixed(2).replace(".", ",")} EUR</span>
              </p>
            </div>
            <label className="mt-6 flex items-start gap-3 text-sm text-ink/70">
              <input type="checkbox" className="mt-1" required />
              Je confirme etre majeur et avoir pris connaissance des informations
              de conformite.
            </label>
            {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
            <button className="btn-primary mt-6 w-full" disabled={isSubmitting}>
              {isSubmitting ? "Redirection..." : "Payer avec Stripe"}
            </button>
          </aside>
        </form>
      )}
    </main>
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
