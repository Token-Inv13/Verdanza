import { Link, useParams } from "react-router-dom";
import { ShoppingBag } from "lucide-react";
import { useEffect } from "react";
import { Seo } from "../components/Seo";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { JsonLd } from "../components/JsonLd";
import { useCart } from "../context/CartContext";
import { useProducts } from "../hooks/useProducts";
import { trackEvent } from "../lib/analytics";
import { FavoriteButton } from "../components/FavoriteButton";
import {
  buildProductJsonLd,
  productCategoryLabel,
  productPath,
} from "../lib/structuredData";

function productImageAlt(product: { name: string; category: string }) {
  return `${product.name} - ${
    product.category === "flowers" ? "Fleur CBD" : "Résine CBD"
  } Verdanza`;
}

export function ProductPage() {
  const { slug } = useParams();
  const { products, isLoading } = useProducts();
  const product = slug ? products.find((entry) => entry.slug === slug) : undefined;
  const { addItem } = useCart();

  useEffect(() => {
    if (!product) return;
    trackEvent("view_product", {
      productId: product.id,
      productName: product.name,
      price: product.price,
    });
  }, [product]);

  if (isLoading) {
    return (
      <main className="container-page py-16">
        <p className="text-forest/70">Chargement du produit...</p>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="container-page py-16">
        <Seo
          title="Produit introuvable - Verdanza CBD"
          description="Ce produit Verdanza n'est pas disponible."
          noindex
        />
        <Breadcrumbs
          structuredData={false}
          items={[
            { name: "Accueil", path: "/" },
            { name: "Boutique", path: "/boutique" },
            { name: "Produit introuvable", path: slug ? `/produits/${slug}` : "/produits", current: true },
          ]}
        />
        <h1 className="font-display text-4xl text-forest">Produit introuvable</h1>
        <Link to="/boutique" className="mt-6 inline-flex text-forest underline">
          Retour boutique
        </Link>
      </main>
    );
  }

  const isComingSoon = product.comingSoon || product.stockStatus === "coming_soon";
  const path = productPath(product);
  const categoryName = productCategoryLabel(product);
  const categoryPath = product.category === "flowers" ? "/fleurs-cbd" : "/resines-cbd";
  const isPremiumHydroponic =
    product.productTier === "Premium" &&
    product.cultureType === "Hydroponique";
  const keyFacts = isPremiumHydroponic
    ? [
        ["Type", "Fleur CBD"],
        ["Gamme", "Premium"],
        ["THC", product.thcRate],
        ["Origine", product.origin],
        ["Culture", product.cultureType],
        ["Statut", product.stockLabel || "En arrivage chez Verdanza"],
      ]
    : [
        ["CBD", product.cbdRate],
        ["CBG", product.cbgRate],
        ["THC", product.thcRate],
        ["Origine", product.origin],
        ["Culture", product.cultureType],
        ["Stock", product.stock > 0 ? "Disponible" : "Stock à confirmer"],
      ];

  return (
    <main className="container-page py-12">
      <Seo
        title={product.seoTitle}
        description={product.seoDescription}
        path={path}
        ogType="product"
        image={product.image}
      />
      <JsonLd id="product" data={buildProductJsonLd(product)} />
      <Breadcrumbs
        items={[
          { name: "Accueil", path: "/" },
          { name: categoryName, path: categoryPath },
          { name: product.name, path, current: true },
        ]}
      />
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <div className="rounded-lg border border-champagne/30 bg-cream p-8">
            <img
              src={product.image}
              alt={productImageAlt(product)}
              className="mx-auto max-h-[520px] object-contain"
            />
          </div>
          {isPremiumHydroponic && (
            <aside className="rounded-md border border-forest/10 bg-ivory p-5">
              <p className="font-display text-2xl text-forest">
                Fleur CBD Premium
              </p>
              <p className="mt-1 text-sm font-semibold text-forest/80">
                Hydroponique · Sélection Verdanza
              </p>
              <p className="mt-3 text-sm leading-6 text-ink/60">
                THC inférieur au seuil légal selon analyse producteur
              </p>
            </aside>
          )}
        </div>
        <section>
          <p className="text-sm uppercase tracking-[0.18em] text-champagne">
            {product.category === "flowers" ? "Fleur CBD" : "Résine CBD"}
          </p>
          <div className="mt-3 flex items-start justify-between gap-4">
            <h1 className="font-display text-5xl text-forest">{product.name}</h1>
            <FavoriteButton product={product} className="shrink-0" />
          </div>
          <p className="mt-5 text-lg leading-8 text-ink/70">{product.longDescription}</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {keyFacts.map(([label, value]) => (
              <div key={label} className="rounded-md border border-forest/10 bg-ivory p-4">
                <dt className="text-xs uppercase tracking-[0.14em] text-ink/45">
                  {label}
                </dt>
                <dd className="mt-1 text-forest">{value}</dd>
              </div>
            ))}
          </div>
          <div className="mt-6">
            <h2 className="font-display text-2xl text-forest">Arômes</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {product.aromas.map((aroma) => (
                <span key={aroma} className="tag">
                  {aroma}
                </span>
              ))}
            </div>
          </div>
          {product.whyChooseDescription && (
            <div className="mt-7">
              <h2 className="font-display text-2xl text-forest">
                Pourquoi choisir cette fleur ?
              </h2>
              <p className="mt-2 leading-7 text-ink/70">
                {product.whyChooseDescription}
              </p>
            </div>
          )}
          {product.advisedProfile && (
            <div className="mt-5 rounded-md border border-forest/10 bg-cream p-5">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-champagne">
                Profil conseillé
              </h2>
              <p className="mt-2 leading-7 text-forest">
                {product.advisedProfile}
              </p>
            </div>
          )}
          {isPremiumHydroponic && (
            <div className="mt-7">
              <h2 className="font-display text-2xl text-forest">
                Qualité & culture
              </h2>
              <p className="mt-2 leading-7 text-ink/70">
                Cette fleur est issue d'une culture hydroponique, une méthode qui
                permet de mieux contrôler l'environnement de production. Elle est
                sélectionnée pour sa structure, son profil aromatique et sa qualité
                visuelle. Chaque lot est proposé selon les garanties et analyses du
                producteur.
              </p>
            </div>
          )}
          {product.experienceDescription && (
            <div className="mt-7 border-l-2 border-champagne pl-5">
              <h2 className="font-display text-2xl text-forest">
                Expérience Verdanza
              </h2>
              <p className="mt-2 leading-7 text-ink/70">
                {product.experienceDescription}
              </p>
            </div>
          )}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <span className="font-display text-4xl text-forest">
              {product.price.toFixed(2).replace(".", ",")} EUR/g
            </span>
            {isComingSoon ? (
              <span className="rounded-md border border-champagne/40 bg-cream px-5 py-3 font-semibold text-forest">
                {product.stockLabel || "En arrivage chez Verdanza"}
              </span>
            ) : (
              <button
                className="btn-primary"
                onClick={() => {
                  addItem(product.id);
                  trackEvent("add_to_cart", {
                    productId: product.id,
                    productName: product.name,
                    price: product.price,
                  });
                }}
              >
                <ShoppingBag size={18} /> Ajouter 1 g au panier
              </button>
            )}
          </div>
          {isComingSoon && (
            <p className="mt-6 text-sm leading-6 text-ink/60">
              Produit réservé aux adultes. Vente interdite aux mineurs. Produit
              CBD conforme à la réglementation en vigueur selon analyse
              producteur. THC inférieur au seuil légal. Ne pas ingérer. Tenir
              hors de portée des enfants. Déconseillé aux femmes enceintes ou
              allaitantes. Consultez un professionnel de santé en cas de
              traitement médical.
            </p>
          )}
          {!isComingSoon && (
            <p className="mt-6 text-sm leading-6 text-ink/60">
              Produit réservé aux personnes majeures. Tenir hors de portée des
              enfants. Ce produit n'est pas destiné à remplacer un traitement
              médical.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
