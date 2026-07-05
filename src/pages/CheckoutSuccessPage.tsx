import { Link, useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import { Seo } from "../components/Seo";
import { useCart } from "../context/CartContext";
import { trackEvent } from "../lib/analytics";

export function CheckoutSuccessPage() {
  const [params] = useSearchParams();
  const { clearCart } = useCart();
  const orderId = params.get("order_id");
  const payment = params.get("payment");

  useEffect(() => {
    clearCart();
    trackEvent("purchase", {
      hasOrderId: Boolean(orderId),
      paymentProvider: payment || "manual",
    });
  }, [clearCart, orderId, payment]);

  const instructions =
    payment === "bank_transfer"
      ? "Votre commande est enregistree. Les informations de virement vous ont ete envoyees par email. La commande sera preparee apres confirmation du paiement."
      : payment === "cash_on_delivery"
        ? "Votre commande est enregistree. Le paiement sera effectue lors de la livraison locale."
        : "Votre commande est enregistree. Verdanza vous recontactera pour confirmer les prochaines etapes.";

  return (
    <main className="container-page py-16">
      <Seo
        title="Commande recue - Verdanza CBD"
        description="Confirmation de commande Verdanza."
      />
      <section className="max-w-2xl rounded-lg border border-champagne/30 bg-cream p-8">
        <h1 className="font-display text-5xl text-forest">Commande recue</h1>
        <p className="mt-5 leading-7 text-ink/70">
          {instructions}
        </p>
        {orderId && (
          <p className="mt-5 rounded-md border border-forest/10 bg-ivory p-4 text-sm text-forest">
            Numero de commande : <strong>{orderId.slice(0, 8).toUpperCase()}</strong>
          </p>
        )}
        <Link to="/boutique" className="btn-primary mt-8 inline-flex">
          Retour boutique
        </Link>
      </section>
    </main>
  );
}
