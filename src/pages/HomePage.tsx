import { Link } from "react-router-dom";
import { ArrowRight, Leaf, MapPin, ShieldCheck, Truck } from "lucide-react";
import { ProductCard } from "../components/ProductCard";
import { Seo } from "../components/Seo";
import { useProducts } from "../hooks/useProducts";

export function HomePage() {
  const { products } = useProducts();
  const featuredProducts = products.filter((product) => product.isFeatured);
  const startingPrice = products.length
    ? Math.min(...products.map((product) => product.price))
    : 0;

  return (
    <>
      <Seo
        title="Verdanza CBD - CBD premium livre a Aix-en-Provence"
        description="Verdanza selectionne des fleurs et resines CBD premium au gramme avec livraison express locale a Aix-en-Provence et alentours."
      />
      <main>
        <section className="hero-section relative overflow-hidden">
          <img
            src="/Fiche produit/Golden static/DSC02266copie.webp"
            alt="Golden Static Verdanza"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-forest/95 via-forest/78 to-forest/25" />
          <div className="container-page relative flex min-h-[calc(100svh-5rem)] items-center py-14 md:min-h-[680px]">
            <div className="max-w-3xl text-ivory">
              <p className="inline-flex items-center gap-2 rounded-full border border-ivory/25 bg-ivory/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-champagne">
                <Leaf size={14} /> Verdanza CBD
              </p>
              <h1 className="mt-5 font-display text-4xl leading-tight sm:text-5xl md:text-7xl">
                Fleurs et resines CBD premium a Aix-en-Provence
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-ivory/82 md:mt-6 md:text-lg md:leading-8">
                Une selection courte, au gramme, livree en express local a
                Aix-en-Provence et alentours de 11h a 01h.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row md:mt-8">
                <Link to="/boutique" className="btn-primary bg-champagne text-forest hover:bg-[#d7b66e]">
                  Voir la boutique <ArrowRight size={18} />
                </Link>
                <Link to="/livraison-express-aix" className="btn-secondary border-ivory/35 bg-ivory/10 text-ivory hover:bg-ivory hover:text-forest">
                  Livraison express Aix
                </Link>
              </div>
              <dl className="mt-7 grid max-w-2xl gap-2 sm:grid-cols-3 md:mt-10 md:gap-3">
                <div className="border-l border-champagne/70 pl-4">
                  <dt className="text-xs uppercase tracking-[0.14em] text-ivory/60">
                    Selection
                  </dt>
                  <dd className="mt-1 font-display text-2xl md:text-3xl">{products.length}</dd>
                </div>
                <div className="border-l border-champagne/70 pl-4">
                  <dt className="text-xs uppercase tracking-[0.14em] text-ivory/60">
                    Prix dès
                  </dt>
                  <dd className="mt-1 font-display text-2xl md:text-3xl">
                    {startingPrice.toFixed(2).replace(".", ",")} EUR/g
                  </dd>
                </div>
                <div className="border-l border-champagne/70 pl-4">
                  <dt className="text-xs uppercase tracking-[0.14em] text-ivory/60">
                    Livraison
                  </dt>
                  <dd className="mt-1 font-display text-2xl md:text-3xl">30 EUR min.</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        <section className="bg-forest py-4 text-ivory">
          <div className="container-page grid gap-3 text-sm font-medium md:grid-cols-3">
            <span>Golden Static - 5,50 EUR/g</span>
            <span>Suprême Purple - 5,00 EUR/g</span>
            <span>Cookie Kush, OG Kush, Harlequin dès 4,00 EUR/g</span>
          </div>
        </section>

        <section className="container-page grid gap-4 py-12 md:grid-cols-3">
          {[
            {
              icon: ShieldCheck,
              title: "Conformite",
              text: "Produits reserves aux adultes, THC conforme selon analyse fournisseur.",
            },
            {
              icon: Truck,
              title: "Livraison 7j/7",
              text: "Express locale de 11h a 01h, a partir de 30 EUR d'achat.",
            },
            {
              icon: MapPin,
              title: "Express Aix",
              text: "Aix-en-Provence et communes proches selon zone selectionnee.",
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
            <h2>Selection Verdanza</h2>
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
