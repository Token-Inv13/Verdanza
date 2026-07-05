import { Link, useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import { Seo } from "../components/Seo";
import { useCart } from "../context/CartContext";
import { trackEvent } from "../lib/analytics";

const contactPhone = (import.meta.env.VITE_CONTACT_PHONE as string | undefined) || "07 80 81 41 37";
const contactEmail = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) || "contact@verdanza.fr";

export function CheckoutSuccessPage() {
  const [params] = useSearchParams();
  const { clearCart } = useCart();
  const orderId = params.get("order_id");
  const summary = readLastOrderSummary(orderId);

  useEffect(() => {
    clearCart();
    trackEvent("purchase", {
      hasOrderId: Boolean(orderId),
    });
  }, [clearCart, orderId]);

  return (
    <main className="container-page py-16">
      <Seo
        title="Commande recue - Verdanza CBD"
        description="Confirmation de commande Verdanza."
      />
      <section className="max-w-2xl rounded-lg border border-champagne/30 bg-cream p-8">
        <h1 className="font-display text-5xl text-forest">Commande envoyee</h1>
        <p className="mt-5 leading-7 text-ink/70">
          Votre commande a bien ete transmise a Verdanza. Nous vous contacterons
          rapidement au numero indique pour confirmer les disponibilites, la
          livraison et le reglement.
        </p>
        {orderId && (
          <p className="mt-5 rounded-md border border-forest/10 bg-ivory p-4 text-sm text-forest">
            Numero de commande : <strong>{orderId.slice(0, 8).toUpperCase()}</strong>
          </p>
        )}
        <div className="mt-5 rounded-md border border-forest/10 bg-ivory p-4 text-sm leading-6 text-forest">
          {summary && (
            <div className="mb-4 border-b border-forest/10 pb-4">
              <strong className="block">Resume de commande</strong>
              {summary.items.map((item) => (
                <p key={`${item.name}-${item.quantity}`}>
                  {item.name} x {item.quantity} g - {formatMoney(item.total)}
                </p>
              ))}
              <p>Mode de livraison : {summary.delivery}</p>
              <p>Total estime : {formatMoney(summary.total)}</p>
            </div>
          )}
          <p>Telephone Verdanza : {contactPhone}</p>
          <p>
            Email :{" "}
            <a className="underline decoration-champagne" href={`mailto:${contactEmail}`}>
              {contactEmail}
            </a>
          </p>
          {!summary && <p>Total estime : indique dans le recapitulatif email et dans votre compte.</p>}
        </div>
        <Link to="/boutique" className="btn-primary mt-8 inline-flex">
          Retour boutique
        </Link>
      </section>
    </main>
  );
}

function readLastOrderSummary(orderId: string | null) {
  if (typeof window === "undefined" || !orderId) return null;
  try {
    const raw = window.sessionStorage.getItem("verdanza:lastOrderSummary");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      orderId?: string;
      items?: { name: string; quantity: number; total: number }[];
      delivery?: string;
      total?: number;
    };
    if (parsed.orderId !== orderId || !Array.isArray(parsed.items)) return null;
    return {
      items: parsed.items,
      delivery: parsed.delivery || "A confirmer",
      total: Number(parsed.total || 0),
    };
  } catch {
    return null;
  }
}

function formatMoney(value: number) {
  return `${value.toFixed(2).replace(".", ",")} EUR`;
}
