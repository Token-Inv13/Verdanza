import { Link, useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import { Seo } from "../components/Seo";
import { useCart } from "../context/CartContext";

export function CheckoutSuccessPage() {
  const [params] = useSearchParams();
  const { clearCart } = useCart();

  useEffect(() => {
    clearCart();
  }, [clearCart]);

  return (
    <main className="container-page py-16">
      <Seo
        title="Paiement confirme - Verdanza CBD"
        description="Confirmation de commande Verdanza."
      />
      <section className="max-w-2xl rounded-lg border border-champagne/30 bg-cream p-8">
        <h1 className="font-display text-5xl text-forest">Commande recue</h1>
        <p className="mt-5 leading-7 text-ink/70">
          Votre paiement a ete confirme. La commande est recue et passe en
          preparation. Vous recevrez les informations utiles lorsque la commande
          avancera.
        </p>
        {params.get("session_id") && (
          <p className="mt-4 text-xs text-ink/50">
            Reference paiement Stripe recue. Aucune donnee sensible n'est affichee.
          </p>
        )}
        <Link to="/boutique" className="btn-primary mt-8 inline-flex">
          Retour boutique
        </Link>
      </section>
    </main>
  );
}
