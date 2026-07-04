import { Link } from "react-router-dom";
import { ArrowRight, MapPin, ShieldCheck, Truck } from "lucide-react";
import { ProductCard } from "../components/ProductCard";
import { Seo } from "../components/Seo";
import { useProducts } from "../hooks/useProducts";

export function HomePage() {
  const { products } = useProducts();
  const featuredProducts = products.filter((product) => product.isFeatured);

  return (
    <>
      <Seo
        title="Verdanza CBD - CBD premium livre a Aix-en-Provence"
        description="Verdanza selectionne des fleurs et resines CBD premium au gramme avec livraison express locale a Aix-en-Provence et alentours."
      />
      <main>
        <section className="hero-section">
          <div className="container-page grid items-center gap-12 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
            <div>
              <h1 className="max-w-3xl font-display text-5xl leading-tight text-forest md:text-7xl">
                CBD premium livre a Aix-en-Provence
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-ink/70">
                Verdanza selectionne des produits CBD de qualite, conformes et
                controles, disponibles en livraison express locale a
                Aix-en-Provence et alentours.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link to="/boutique" className="btn-primary">
                  Voir la boutique <ArrowRight size={18} />
                </Link>
                <Link to="/livraison-express-aix" className="btn-secondary">
                  Livraison express Aix
                </Link>
              </div>
            </div>
            <div className="relative">
              <div className="absolute -left-5 top-8 h-28 w-28 rounded-full border border-champagne/40" />
              <div className="rounded-lg border border-champagne/30 bg-ivory p-8 shadow-soft">
                <img
                  src="/verdanza-label.png"
                  alt="Etiquette produit Verdanza CBD"
                  className="mx-auto max-h-[420px] w-full object-contain"
                />
              </div>
            </div>
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
