import { Link } from "react-router-dom";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Seo } from "../components/Seo";
import { useCart } from "../context/CartContext";

export function CartPage() {
  const { lines, subtotal, addItem, decrementItem, removeItem } = useCart();
  const deliveryEstimate = 0;
  const total = subtotal + (lines.length ? deliveryEstimate : 0);
  const localDeliveryMinimum = 30;
  const isBelowLocalMinimum = lines.length > 0 && subtotal < localDeliveryMinimum;

  return (
    <main className="container-page py-12">
      <Seo title="Panier - Verdanza CBD" description="Panier local Verdanza CBD." />
      <div className="page-intro">
        <h1>Panier</h1>
        <p>Panier conserve dans ce navigateur. Le paiement est securise par Stripe Checkout.</p>
        <p className="mt-3 text-sm text-forest/70">
          Livraison express Aix-en-Provence et alentours, 7j/7 de 11h a 01h,
          a partir de 30 EUR d'achat.
        </p>
      </div>
      {lines.length === 0 ? (
        <section className="mt-10 rounded-lg border border-forest/10 bg-cream p-8">
          <p>Votre panier est vide.</p>
          <Link to="/boutique" className="btn-primary mt-6 inline-flex">
            Voir la boutique
          </Link>
        </section>
      ) : (
        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_360px]">
          <div className="grid gap-4">
            {lines.map((line) => (
              <article
                key={line.productId}
                className="grid gap-4 rounded-lg border border-forest/10 bg-ivory p-4 sm:grid-cols-[120px_1fr_auto]"
              >
                <img
                  src={line.product.image}
                  alt=""
                  className="h-28 w-full rounded-md bg-cream object-contain"
                />
                <div>
                  <h2 className="font-display text-2xl text-forest">
                    {line.product.name}
                  </h2>
                  <p className="text-sm text-ink/60">{line.product.shortDescription}</p>
                  <div className="mt-4 flex items-center gap-2">
                    <button className="icon-button" onClick={() => decrementItem(line.productId)}>
                      <Minus size={16} />
                    </button>
                    <span className="w-12 text-center">{line.quantity} g</span>
                    <button className="icon-button" onClick={() => addItem(line.productId)}>
                      <Plus size={16} />
                    </button>
                    <button className="icon-button" onClick={() => removeItem(line.productId)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <strong className="text-forest">
                  {line.lineTotal.toFixed(2).replace(".", ",")} EUR
                </strong>
              </article>
            ))}
          </div>
          <aside className="h-fit rounded-lg border border-champagne/30 bg-cream p-6">
            <h2 className="font-display text-3xl text-forest">Resume</h2>
            <div className="mt-6 grid gap-3 text-sm">
              <p className="flex justify-between">
                <span>Sous-total</span>
                <span>{subtotal.toFixed(2).replace(".", ",")} EUR</span>
              </p>
              <p className="flex justify-between">
                <span>Livraison express locale</span>
                <span>{deliveryEstimate.toFixed(2).replace(".", ",")} EUR</span>
              </p>
              <p className="flex justify-between border-t border-forest/10 pt-3 text-lg font-semibold text-forest">
                <span>Total</span>
                <span>{total.toFixed(2).replace(".", ",")} EUR</span>
              </p>
            </div>
            {isBelowLocalMinimum && (
              <p className="mt-4 rounded-md border border-champagne/40 bg-ivory p-3 text-sm leading-6 text-forest">
                Minimum livraison locale : {localDeliveryMinimum} EUR. Ajoutez{" "}
                {(localDeliveryMinimum - subtotal).toFixed(2).replace(".", ",")} EUR
                pour continuer.
              </p>
            )}
            {isBelowLocalMinimum ? (
              <button className="btn-primary mt-6 w-full justify-center opacity-60" disabled>
                Minimum 30 EUR requis
              </button>
            ) : (
              <Link to="/checkout" className="btn-primary mt-6 w-full justify-center">
                Continuer
              </Link>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
