import { Link } from "react-router-dom";
import { ArrowRight, Leaf, PackageCheck, ShieldCheck, Truck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ProductCard } from "../components/ProductCard";
import { HomeProductFinder } from "../components/home/HomeProductFinder";
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

const homeAssurances = [
  {
    icon: ShieldCheck,
    title: "Produits sélectionnés",
    text: "Une sélection suivie, avec des informations de conformité accessibles.",
    to: "/qualite-conformite",
    ctaId: "home_reassurance_quality",
    ctaLocation: "home_reassurance",
  },
  {
    icon: Truck,
    title: "Livraison France",
    text: "Expédition postale nationale, avec suivi selon le mode choisi.",
    to: "/livraison-postale",
    ctaId: "home_reassurance_postal_delivery",
    ctaLocation: "home_reassurance",
  },
  {
    icon: PackageCheck,
    title: "Express local",
    text: DEFAULT_LOCAL_DELIVERY_ESTIMATE_LABEL,
    to: "/livraison-locale#zone-livraison",
    ctaId: "home_hero_local_delivery",
    ctaLocation: "home_hero",
  },
] as const;

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
    const visibleProducts = featuredProducts.slice(0, 3);
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
      <main className="home-page-v2" data-home-page-v2>
        <div className="home-hero-flow">
          <section
            className="hero-section home-hero-v2 relative overflow-hidden"
            aria-labelledby="home-hero-title"
            data-home-hero-v2
          >
            <div className="container-page home-hero-v2__layout">
              <div className="home-hero-v2__content">
                <p className="home-hero-v2__eyebrow">
                  <Leaf size={14} aria-hidden="true" /> Verdanza CBD
                </p>
                <h1
                  id="home-hero-title"
                  className="home-hero-v2__title"
                  style={{
                    fontFamily: isAgeConfirmed
                      ? '"Playfair Display", Georgia, serif'
                      : "Georgia, serif",
                  }}
                >
                  Une sélection CBD pensée pour vous.
                </h1>
                <p className="home-hero-v2__intro">
                  Fleurs et résines choisies avec soin, à découvrir selon vos
                  préférences et votre rythme.
                </p>
                <div className="home-hero-v2__actions">
                  <Link
                    to="/boutique"
                    className="btn-primary"
                    data-home-hero-primary
                    onClick={() =>
                      trackCtaClick({
                        ctaId: "home_hero_shop",
                        ctaLocation: "home_hero",
                        destinationPath: "/boutique",
                        ctaCategory: "shop_navigation",
                      })
                    }
                  >
                    Découvrir la boutique <ArrowRight size={18} aria-hidden="true" />
                  </Link>
                  <Link
                    to="/livraison-postale"
                    className="btn-secondary home-hero-v2__secondary"
                    data-home-hero-secondary
                    onClick={() =>
                      trackCtaClick({
                        ctaId: "home_hero_postal_delivery",
                        ctaLocation: "home_hero",
                        destinationPath: "/livraison-postale",
                        ctaCategory: "delivery",
                      })
                    }
                  >
                    Livraison
                  </Link>
                </div>
              </div>

              <div className="home-hero-v2__media" aria-hidden={!isAgeConfirmed}>
                {isAgeConfirmed && (
                  <img
                    src={heroImage?.src || "/images/verdanza-hero-premium.webp"}
                    srcSet={heroImage?.srcSet}
                    sizes="(min-width: 1024px) 52vw, 100vw"
                    alt="Fleur et résine CBD de la sélection Verdanza"
                    width={heroImage?.width || 1672}
                    height={heroImage?.height || 941}
                    fetchPriority="high"
                    decoding="async"
                    className="home-hero-v2__image"
                  />
                )}
              </div>
            </div>
          </section>

          <HomeProductFinder products={products} />
        </div>

        <PromoBannerSlot
          placement="home"
          type="shop_card"
          className="container-page mt-5 grid gap-3 md:mt-6"
        />

        <section
          className="container-page home-reassurance-v2"
          aria-label="Les engagements Verdanza"
          data-home-reassurance
        >
          {homeAssurances.map((item) => (
            <Link
              key={item.title}
              to={item.to}
              className="home-reassurance-v2__item"
              data-home-reassurance-item
              onClick={() =>
                trackCtaClick({
                  ctaId: item.ctaId,
                  ctaLocation: item.ctaLocation,
                  destinationPath: item.to,
                  ctaCategory: item.ctaId.includes("quality")
                    ? "quality"
                    : "delivery",
                })
              }
            >
              <item.icon className="home-reassurance-v2__icon" size={21} aria-hidden="true" />
              <span>
                <strong>{item.title}</strong>
                <small>{item.text}</small>
              </span>
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          ))}
        </section>

        <section className="home-selection-v2" data-home-selection>
          <div className="container-page py-14 md:py-20">
            <div className="home-section-heading-v2">
              <div>
                <p className="home-section-eyebrow">Sélection du moment</p>
                <h2>Sélection Verdanza</h2>
                <p className="home-section-intro">
                  Trois profils à découvrir, choisis parmi la collection actuelle.
                </p>
              </div>
            <Link
              to="/boutique"
              className="home-section-link-v2"
              onClick={() =>
                trackCtaClick({
                  ctaId: "home_featured_shop",
                  ctaLocation: "home_featured_products",
                  destinationPath: "/boutique",
                  ctaCategory: "shop_navigation",
                })
              }
            >
                Tout voir <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
            <div className="product-grid home-selection-v2__grid">
            {featuredProducts.slice(0, 3).map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                itemListId="home_featured"
                itemListName="Sélection Verdanza"
              />
            ))}
            </div>
          </div>
        </section>

        <section className="home-guides-v2" data-home-guides>
          <div className="container-page py-14 md:py-16">
          <div className="home-section-heading-v2 mb-7">
            <div>
                <p className="home-section-eyebrow">Pour aller plus loin</p>
                <h2>Guides CBD</h2>
                <p className="home-section-intro">
                Des repères simples pour mieux comprendre les produits.
              </p>
            </div>
            <Link
              to="/blog"
                className="home-section-link-v2"
              onClick={() =>
                trackCtaClick({
                  ctaId: "home_blog_guides",
                  ctaLocation: "home_blog",
                  destinationPath: "/blog",
                  ctaCategory: "content",
                })
              }
            >
                Tous les guides <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
            <div className="grid gap-4 md:grid-cols-2" data-home-guide-list>
            {publishedBlogArticles.slice(0, 2).map((article) => (
              <HomeGuideCard key={article.slug} article={article} />
            ))}
            </div>
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
    <article
      className="home-guide-card-v2"
      data-home-guide-card
    >
      <Link
        to={path}
        className="home-guide-card-v2__media"
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
          sizes="(min-width: 768px) 150px, 92vw"
          alt=""
          width={image?.width || 1200}
          height={image?.height || 900}
          loading="lazy"
          decoding="async"
          className="home-guide-card-v2__image"
        />
      </Link>
      <div className="home-guide-card-v2__content">
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
