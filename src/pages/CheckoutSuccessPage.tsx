import { Link, useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import { Seo } from "../components/Seo";
import { useCart } from "../context/CartContext";
import { trackEvent } from "../lib/analytics";

const contactEmail =
  (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) ||
  "contact@verdanza.fr";

export function CheckoutSuccessPage() {
  const [params] = useSearchParams();
  const { clearCart } = useCart();
  const orderId = params.get("order_id");
  const summary = readLastOrderSummary(orderId);

  useEffect(() => {
    clearCart();
    trackEvent("purchase", {
      hasOrderId: Boolean(orderId),
      orderType: "order",
    });
  }, [clearCart, orderId]);

  return (
    <main className="container-page py-16">
      <Seo
        title="Commande reçue - Verdanza CBD"
        description="Confirmation de commande Verdanza."
      />
      <section className="max-w-2xl rounded-lg border border-champagne/30 bg-cream p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-champagne">
          Commande
        </p>
        <h1 className="mt-3 font-display text-5xl text-forest">
          Commande envoyée
        </h1>
        <p className="mt-5 leading-7 text-ink/70">
          Votre commande a bien été transmise à Verdanza.
        </p>
        <div className="mt-5 rounded-md border border-champagne/30 bg-ivory p-4 text-sm leading-6 text-forest">
          <strong className="block text-base">
            Prochaine étape : confirmation et règlement
          </strong>
          <p className="mt-2">
            Nous allons vérifier les disponibilités, le mode de livraison et le
            montant final. Si vous souhaitez régler par carte bancaire, un lien
            de paiement vous sera envoyé par email et/ou message après
            confirmation de votre commande.
          </p>
        </div>
        {orderId && (
          <p className="mt-5 rounded-md border border-forest/10 bg-ivory p-4 text-sm text-forest">
            Numéro de commande : <strong>{orderId.slice(0, 8).toUpperCase()}</strong>
          </p>
        )}
        <div className="mt-5 rounded-md border border-forest/10 bg-ivory p-4 text-sm leading-6 text-forest">
          {summary && (
            <div className="mb-4 border-b border-forest/10 pb-4">
              <strong className="block">Résumé de commande</strong>
              {summary.items.map((item) => (
                <p key={`${item.name}-${item.quantity}`}>
                  {item.name} x {item.quantity} g - {formatMoney(item.total)}
                </p>
              ))}
              <p>Mode de livraison : {summary.delivery}</p>
              <p>{summary.deliveryNote}</p>
              <p>
                Mode de règlement souhaité :{" "}
                {summary.preferredPaymentMethod || "À confirmer avec Verdanza"}
              </p>
              <p>Total estimé : {formatMoney(summary.total)}</p>
            </div>
          )}
          <p>
            Email :{" "}
            <a className="underline decoration-champagne" href={`mailto:${contactEmail}`}>
              {contactEmail}
            </a>
          </p>
          {!summary && (
            <p>Total estimé : indiqué dans le récapitulatif email et dans votre compte.</p>
          )}
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
      deliveryNote?: string;
      preferredPaymentMethod?: string;
      total?: number;
    };
    if (parsed.orderId !== orderId || !Array.isArray(parsed.items)) return null;
    return {
      items: parsed.items,
      delivery: parsed.delivery || "À confirmer",
      deliveryNote: parsed.deliveryNote || "",
      preferredPaymentMethod: parsed.preferredPaymentMethod || "À confirmer avec Verdanza",
      total: Number(parsed.total || 0),
    };
  } catch {
    return null;
  }
}

function formatMoney(value: number) {
  return `${value.toFixed(2).replace(".", ",")} EUR`;
}
