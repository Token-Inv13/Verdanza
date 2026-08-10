import { Link } from "react-router-dom";
import { ArrowRight, Leaf, PackageCheck, ShieldCheck, Truck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ProductCard } from "../components/ProductCard";
import { PromoBannerSlot } from "../components/PromoBannerSlot";
import { JsonLd } from "../components/JsonLd";
import { Seo } from "../components/Seo";
import { blogArticlePath, publishedBlogArticles } from "../data/blogArticles";
import { useProducts } from "../hooks/useProducts";
import { staticImageVariants } from "../lib/generatedImageVariants";
import { buildHomeJsonLd } from "../lib/structuredData";
import { trackCtaClick, trackViewItemList } from "../lib/analytics";
import { DEFAULT_LOCAL_DELIVERY_ESTIMATE_LABEL } from "../lib/deliveryEstimate";
import {
  AGE_GATE_CONFIRMED_EVENT,
  AGE_GATE_PENDING_CLASS,
  isAgeConfirmedLocally,
} from "../lib/ageGate";
import type { BlogArticle } from "../types/blog";

export function HomePage() {
  const { products } = useProducts();
  const featuredProducts = products.filter((product) => product.isFeatured);
  const trackedListSignature = useRef("");
  const [isAgeConfirmed, setIsAgeConfirmed] = useState(isAgeConfirmedLocally);
  const heroImage = staticImageVariants["/images/verdanza-hero-premium.webp"];
  const contactEmail =
    (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) ||
    "contact@verdanza.fr";

  useEffect(() => {
    const visibleProducts = featuredProducts.slice(0, 4);
    const signature = visibleProducts.map((product) => product.id).join("|");
    if (!signature || trackedListSignature.current === signature) return;
    trackedListSignature.current = signature;
    trackViewItemList("home_featured", "Sélection Verdanza", visibleProducts);
  }, [featuredProducts]);

  useEffect(() => {
    if (isAgeConfirmed) return undefined;
    const markConfirmed = () => setIsAgeConfirmed(true);
    window.addEventListener(AGE_GATE_CONFIRMED_EVENT, markConfirmed);
    return () => window.removeEventListener(AGE_GATE_CONFIRMED_EVENT, markConfirmed);
  }, [isAgeConfirmed]);

  useEffect(() => {
    document.documentElement.classList.toggle(AGE_GATE_PENDING_CLASS, !isAgeConfirmed);
    return () => document.documentElement.classList.remove(AGE_GATE_PENDING_CLASS);
  }, [isAgeConfirmed]);

  return (
    <>
      <Seo
        title="Verdanza CBD - Fleurs et résines CBD en ligne"
        description="Boutique en ligne de fleurs et résines CBD sélectionnées, avec livraison postale en France et livraison locale selon zone disponible."
        path="/"
        image="/images/verdanza-hero-premium.webp"
      />
      <JsonLd id="site-identity" data={buildHomeJsonLd(contactEmail)} />
      <main>
        <section className="hero-section relative overflow-hidden bg-forest">
          {isAgeConfirmed && (
            <img
              src={heroImage?.src || "/images/verdanza-hero-premium.webp"}
              srcSet={heroImage?.srcSet}
              sizes={heroImage?.sizes || "100vw"}
              alt="Sélection CBD Verdanza"
              width={heroImage?.width || 1672}
              height={heroImage?.height || 941}
              fetchPriority="high"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-forest/95 via-forest/78 to-forest/25" />
          <div className="container-page relative flex min-h-[620px] items-center py-12 md:min-h-[680px] md:py-14">
            <div className="max-w-3xl text-ivory">
              <p className="inline-flex items-center gap-2 rounded-full border border-ivory/25 bg-ivory/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-champagne">
                <Leaf size={14} /> Verdanza CBD
              </p>
              <h1
                className="mt-5 text-4xl leading-tight sm:text-5xl md:text-6xl"
                style={{
                  fontFamily: isAgeConfirmed
                    ? '"Playfair Display", Georgia, serif'
                    : "Georgia, serif",
                }}
              >
                Verdanza, boutique en ligne de CBD
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-ivory/82 md:mt-6 md:text-lg md:leading-8">
                Verdanza propose une boutique en ligne de fleurs et résines CBD
                sélectionnées avec soin, avec livraison postale en France et
                livraison locale selon votre zone.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap md:mt-8">
                <Link
                  to="/boutique"
                  className="btn-primary bg-champagne text-forest hover:bg-[#d7b66e]"
                  onClick={() =>
                    trackCtaClick({
                      ctaId: "home_hero_shop",
                      ctaLocation: "home_hero",
                      destinationPath: "/boutique",
                      ctaCategory: "shop_navigation",
                    })
                  }
                >
                  Voir la boutique <ArrowRight size={18} />
                </Link>
                <Link
                  to="/livraison-postale"
                  className="btn-secondary border-ivory/35 bg-ivory/10 text-ivory hover:bg-ivory hover:text-forest"
                  onClick={() =>
                    trackCtaClick({
                      ctaId: "home_hero_postal_delivery",
                      ctaLocation: "home_hero",
                      destinationPath: "/livraison-postale",
                      ctaCategory: "delivery",
                    })
                  }
                >
                  Livraison en France
                </Link>
                <Link
                  to="/livraison-locale#zone-livraison"
                  className="btn-secondary border-ivory/35 bg-ivory/10 text-ivory hover:bg-ivory hover:text-forest"
                  onClick={() =>
                    trackCtaClick({
                      ctaId: "home_hero_local_delivery",
                      ctaLocation: "home_hero",
                      destinationPath: "/livraison-locale#zone-livraison",
                      ctaCategory: "delivery",
                    })
                  }
                >
                  Livraison CBD Aix
                </Link>
              </div>
            </div>
          </div>
        </section>

        <PromoBannerSlot
          placement="home"
          type="shop_card"
          className="container-page mt-8 grid gap-3"
        />

        <section className="container-page grid gap-4 py-12 md:grid-cols-3">
          {[
            {
              icon: ShieldCheck,
              title: "Conformité",
              text: "Produits réservés aux adultes, THC inférieur au seuil légal.",
            },
            {
              icon: Truck,
              title: "Livraison France",
              text: "Expédition postale nationale, avec suivi selon le mode choisi.",
            },
            {
              icon: PackageCheck,
              title: "Express local",
              text: DEFAULT_LOCAL_DELIVERY_ESTIMATE_LABEL,
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
            <Link
              to="/boutique"
              onClick={() =>
                trackCtaClick({
                  ctaId: "home_featured_shop",
                  ctaLocation: "home_featured_products",
                  destinationPath: "/boutique",
                  ctaCategory: "shop_navigation",
                })
              }
            >
              Tout voir
            </Link>
          </div>
          <div className="product-grid">
            {featuredProducts.slice(0, 4).map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                itemListId="home_featured"
                itemListName="Sélection Verdanza"
              />
            ))}
          </div>
        </section>

        <section className="container-page mt-2 border-t border-forest/10 pb-16 pt-12 md:mt-6 md:pt-14">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-display text-3xl leading-tight text-forest md:text-4xl">
                Guides CBD
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/65">
                Des repères simples pour mieux comprendre les produits.
              </p>
            </div>
            <Link
              to="/blog"
              className="text-sm font-semibold text-forest underline decoration-champagne underline-offset-4"
              onClick={() =>
                trackCtaClick({
                  ctaId: "home_blog_guides",
                  ctaLocation: "home_blog",
                  destinationPath: "/blog",
                  ctaCategory: "content",
                })
              }
            >
              Tous les guides
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {publishedBlogArticles.slice(0, 2).map((article) => (
              <HomeGuideCard key={article.slug} article={article} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

function HomeGuideCard({ article }: { article: BlogArticle }) {
  const image = staticImageVariants[article.images.landscape];
  const path = blogArticlePath(article);

  return (
    <article className="grid overflow-hidden rounded-md border border-forest/10 bg-ivory shadow-sm sm:grid-cols-[170px_1fr]">
      <Link
        to={path}
        className="block bg-cream"
        aria-label={`Lire le guide ${article.title}`}
        onClick={() =>
          trackCtaClick({
            ctaId: `home_blog_article_${article.slug}`,
            ctaLocation: "home_blog",
            destinationPath: path,
            ctaCategory: "content",
          })
        }
      >
        <img
          src={image?.src || article.images.landscape}
          srcSet={image?.srcSet}
          sizes="(min-width: 768px) 170px, 92vw"
          alt=""
          width={image?.width || 1200}
          height={image?.height || 900}
          loading="lazy"
          decoding="async"
          className="h-32 w-full object-cover sm:h-full"
        />
      </Link>
      <div className="flex min-w-0 flex-col p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-champagne">
          {article.category}
        </p>
        <h3 className="mt-2 font-display text-2xl leading-tight text-forest">
          <Link to={path}>{article.title}</Link>
        </h3>
        <p className="mt-2 max-h-12 overflow-hidden text-sm leading-6 text-ink/65">
          {article.excerpt}
        </p>
        <Link
          to={path}
          className="mt-3 inline-flex text-sm font-semibold text-forest underline decoration-champagne underline-offset-4"
          onClick={() =>
            trackCtaClick({
              ctaId: `home_blog_article_read_${article.slug}`,
              ctaLocation: "home_blog",
              destinationPath: path,
              ctaCategory: "content",
            })
          }
        >
          Lire le guide
        </Link>
      </div>
    </article>
  );
}
