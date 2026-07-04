import { Link } from "react-router-dom";
import { Seo } from "../components/Seo";

export function CheckoutCancelPage() {
  return (
    <main className="container-page py-16">
      <Seo
        title="Paiement annule - Verdanza CBD"
        description="Paiement annule, panier conserve."
      />
      <section className="max-w-2xl rounded-lg border border-forest/10 bg-cream p-8">
        <h1 className="font-display text-5xl text-forest">Paiement annule</h1>
        <p className="mt-5 leading-7 text-ink/70">
          Le paiement n'a pas ete finalise. Votre panier est conserve, vous
          pouvez le verifier puis relancer la commande.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link to="/panier" className="btn-primary">
            Retour au panier
          </Link>
          <Link to="/boutique" className="btn-secondary">
            Continuer mes achats
          </Link>
        </div>
      </section>
    </main>
  );
}
