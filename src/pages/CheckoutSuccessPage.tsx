import { Link, useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import { Seo } from "../components/Seo";
import { useCart } from "../context/CartContext";
import { trackContactClick } from "../lib/analytics";

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
  }, [clearCart]);

  return (
    <main className="container-page py-16">
      <Seo
        title="Commande reçue - Verdanza CBD"
        description="Confirmation de commande Verdanza."
        path="/checkout/success"
        noindex
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
            {summary?.deliveryMethod === "postal"
              ? "Les frais Colissimo et le total ci-dessous sont déterminés. Nous vérifions les disponibilités avant expédition. Si vous souhaitez régler par carte bancaire, un lien de paiement vous sera envoyé par email et/ou message."
              : "Nous allons vérifier les disponibilités, le mode de livraison et le règlement. Si vous souhaitez régler par carte bancaire, un lien de paiement vous sera envoyé par email et/ou message après confirmation de votre commande."}
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
                  {item.name} x {item.displayQuantity || `${item.quantity} g`} - {formatMoney(item.total)}
                </p>
              ))}
              <p>Mode de livraison : {summary.delivery}</p>
              <p>{summary.deliveryNote}</p>
              <p>Sous-total produits : {formatMoney(summary.subtotal)}</p>
              <p>
                Frais de livraison :{" "}
                {summary.deliveryFee === 0 ? "Offerte" : formatMoney(summary.deliveryFee)}
              </p>
              <p>
                Mode de règlement souhaité :{" "}
                {summary.preferredPaymentMethod ||
                  "Carte bancaire via lien de paiement après confirmation"}
              </p>
              <p>Total de la commande : {formatMoney(summary.total)}</p>
            </div>
          )}
          <p>
            Email :{" "}
            <a
              className="underline decoration-champagne"
              href={`mailto:${contactEmail}`}
              onClick={() => trackContactClick("email", "checkout_success")}
            >
              {contactEmail}
            </a>
          </p>
          {!summary && (
            <p>Total de la commande : indiqué dans le récapitulatif email et dans votre compte.</p>
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
      items?: { name: string; quantity: number; displayQuantity?: string; total: number }[];
      delivery?: string;
      deliveryMethod?: "postal" | "local_express";
      deliveryNote?: string;
      subtotal?: number;
      deliveryFee?: number;
      preferredPaymentMethod?: string;
      total?: number;
    };
    if (parsed.orderId !== orderId || !Array.isArray(parsed.items)) return null;
    return {
      items: parsed.items,
      delivery: parsed.delivery || "Livraison sélectionnée",
      deliveryMethod: parsed.deliveryMethod,
      deliveryNote: parsed.deliveryNote || "",
      subtotal: Number(parsed.subtotal || 0),
      deliveryFee: Number(parsed.deliveryFee || 0),
      preferredPaymentMethod:
        parsed.preferredPaymentMethod ||
        "Carte bancaire via lien de paiement après confirmation",
      total: Number(parsed.total || 0),
    };
  } catch {
    return null;
  }
}

function formatMoney(value: number) {
  return `${value.toFixed(2).replace(".", ",")} EUR`;
}
