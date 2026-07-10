import { Link } from "react-router-dom";
import { ArrowRight, Leaf, PackageCheck, ShieldCheck, Truck } from "lucide-react";
import { ProductCard } from "../components/ProductCard";
import { Seo } from "../components/Seo";
import { useProducts } from "../hooks/useProducts";

export function HomePage() {
  const { products } = useProducts();
  const featuredProducts = products.filter((product) => product.isFeatured);

  return (
    <>
      <Seo
        title="Verdanza CBD - Fleurs et résines CBD premium en ligne"
        description="Boutique en ligne de fleurs et résines CBD premium, avec livraison postale en France et livraison locale selon zone disponible."
        path="/"
        image="/images/verdanza-hero-premium.webp"
      />
      <main>
        <section className="hero-section relative overflow-hidden">
          <img
            src="/images/verdanza-hero-premium.webp"
            alt="Sélection CBD premium Verdanza"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-forest/95 via-forest/78 to-forest/25" />
          <div className="container-page relative flex min-h-[620px] items-center py-12 md:min-h-[680px] md:py-14">
            <div className="max-w-3xl text-ivory">
              <p className="inline-flex items-center gap-2 rounded-full border border-ivory/25 bg-ivory/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-champagne">
                <Leaf size={14} /> Verdanza CBD
              </p>
              <h1 className="mt-5 font-display text-4xl leading-tight sm:text-5xl md:text-7xl">
                CBD premium, sélectionné avec exigence
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-ivory/82 md:mt-6 md:text-lg md:leading-8">
                Fleurs et résines CBD sélectionnées avec soin, disponibles en
                livraison postale en France et en livraison locale selon les
                zones ouvertes.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row md:mt-8">
                <Link to="/boutique" className="btn-primary bg-champagne text-forest hover:bg-[#d7b66e]">
                  Voir la boutique <ArrowRight size={18} />
                </Link>
                <Link to="/livraison-postale" className="btn-secondary border-ivory/35 bg-ivory/10 text-ivory hover:bg-ivory hover:text-forest">
                  Livraison en France
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="container-page grid gap-4 py-12 md:grid-cols-3">
          {[
            {
              icon: ShieldCheck,
              title: "Conformité",
              text: "Produits réservés aux adultes, THC conforme selon analyse producteur.",
            },
            {
              icon: Truck,
              title: "Livraison France",
              text: "Expédition postale nationale, avec suivi selon le mode choisi.",
            },
            {
              icon: PackageCheck,
              title: "Express local",
              text: "Livraison rapide sur Aix-en-Provence et zones ouvertes, en complément du postal.",
            },
          ].map((item) => (
            <article key={item.title} className="feature-panel">
              <item.icon className="text-champagne" size={24} />
              <h2>{item.title}</h2>
              <p>{item.text}</p>
            </article>
          ))}
        </section>

        <section className="container-page py-14">
          <div className="section-heading">
            <h2>Sélection Verdanza</h2>
            <Link to="/boutique">Tout voir</Link>
          </div>
          <div className="product-grid">
            {featuredProducts.slice(0, 4).map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
