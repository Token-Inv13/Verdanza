import { Link } from "react-router-dom";
import { ArrowRight, BookOpenText, Leaf, PackageCheck, ShieldCheck, Truck } from "lucide-react";
import type { ReactNode } from "react";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { Seo } from "../components/Seo";
import { staticImageVariants } from "../lib/generatedImageVariants";
import { trackCtaClick } from "../lib/analytics";

const pagePath = "/decouvrir-verdanza";
const heroImagePath = "/images/verdanza-hero-premium.webp";
const flowerImagePath = "/images/products/mandarine-cbd-detail.webp";
const resinImagePath = "/Fiche%20produit/Creamy%20Piatella/piatella.webp";

const categoryCards = [
  {
    eyebrow: "01",
    title: "Fleurs CBD",
    text: "Des profils aromatiques variés, sélectionnés avec soin.",
    cta: "Découvrir les fleurs",
    to: "/fleurs-cbd",
    image: flowerImagePath,
    alt: "Fleurs CBD présentées sur fond clair",
    ctaId: "flyer_landing_flowers",
    category: "category_navigation",
  },
  {
    eyebrow: "02",
    title: "Résines CBD",
    text: "Des textures et profils différents à découvrir.",
    cta: "Découvrir les résines",
    to: "/resines-cbd",
    image: resinImagePath,
    alt: "Résine CBD claire présentée sur fond clair",
    ctaId: "flyer_landing_resins",
    category: "category_navigation",
  },
  {
    eyebrow: "03",
    title: "Guides CBD",
    text: "Des contenus simples pour mieux comprendre les produits.",
    cta: "Consulter les guides",
    to: "/blog",
    image: "/images/blog/fleur-cbd-ou-resine-cbd-4x3.webp",
    alt: "Guide CBD illustré par des fleurs et résines sur fond naturel",
    ctaId: "flyer_landing_guides",
    category: "content",
  },
] as const;

const trustItems = [
  {
    icon: Leaf,
    title: "Sélection soignée",
    text: "Une gamme courte de fleurs et résines CBD, présentée avec des informations claires.",
  },
  {
    icon: Truck,
    title: "Livraison en France",
    text: "Des informations de livraison accessibles avant de parcourir la sélection.",
  },
  {
    icon: ShieldCheck,
    title: "Qualité & conformité",
    text: "Une démarche sobre : traçabilité, conformité et absence de promesse médicale.",
  },
] as const;

export function FlyerLandingPage() {
  const heroImage = staticImageVariants[heroImagePath];
  const guideImage = staticImageVariants["/images/blog/fleur-cbd-ou-resine-cbd-4x3.webp"];

  return (
    <>
      <Seo
        title="Découvrir Verdanza | Fleurs et résines CBD"
        description="Découvrez Verdanza, sa sélection de fleurs et résines CBD, ses informations de qualité et ses guides."
        path={pagePath}
        canonical={pagePath}
        image={heroImagePath}
      />
      <main>
        <section className="relative overflow-hidden bg-forest text-ivory">
          <img
            src={heroImage?.src || heroImagePath}
            srcSet={heroImage?.srcSet}
            sizes={heroImage?.sizes || "100vw"}
            alt=""
            width={heroImage?.width || 1672}
            height={heroImage?.height || 941}
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-forest/95 via-forest/78 to-forest/30" />
          <div className="container-page relative flex min-h-[480px] items-center py-12 sm:min-h-[520px] lg:min-h-[560px]">
            <div className="max-w-3xl">
              <p className="inline-flex items-center gap-2 rounded-full border border-ivory/25 bg-ivory/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-champagne">
                <Leaf size={14} aria-hidden="true" /> Découvrir Verdanza
              </p>
              <h1 className="mt-5 font-display text-4xl leading-tight sm:text-5xl lg:text-7xl">
                CBD sélectionné avec exigence
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-ivory/82 sm:text-lg sm:leading-8">
                Verdanza propose une sélection de fleurs et résines CBD,
                accompagnée d’informations claires pour découvrir les produits
                simplement.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <TrackedLink
                  to="/boutique"
                  ctaId="flyer_landing_hero_shop"
                  ctaLocation="flyer_landing_hero"
                  ctaCategory="shop_navigation"
                  className="btn-primary bg-champagne text-forest hover:bg-[#d7b66e]"
                >
                  Découvrir la sélection <ArrowRight size={18} aria-hidden="true" />
                </TrackedLink>
                <TrackedLink
                  to="/qualite-conformite"
                  ctaId="flyer_landing_hero_quality"
                  ctaLocation="flyer_landing_hero"
                  ctaCategory="quality"
                  className="btn-secondary border-ivory/35 bg-ivory/10 text-ivory hover:bg-ivory hover:text-forest"
                >
                  Voir notre démarche qualité
                </TrackedLink>
              </div>
            </div>
          </div>
        </section>

        <section className="container-page py-10 sm:py-12">
          <Breadcrumbs
            items={[
              { name: "Accueil", path: "/" },
              { name: "Découvrir Verdanza", path: pagePath, current: true },
            ]}
          />
          <div className="max-w-3xl">
            <h2 className="font-display text-4xl leading-tight text-forest sm:text-5xl">
              Une entrée simple vers l’univers Verdanza
            </h2>
            <p className="mt-4 text-base leading-7 text-ink/70">
              Cette page rassemble les accès utiles après la lecture du flyer :
              la boutique, les catégories principales, la livraison, les guides
              et les informations de qualité.
            </p>
          </div>
        </section>

        <section className="container-page pb-12">
          <div className="grid gap-5 lg:grid-cols-3">
            {categoryCards.map((card) => {
              const isGuide = card.to === "/blog";
              const image = isGuide ? guideImage : undefined;
              return (
                <article
                  key={card.title}
                  className="flex min-h-[380px] flex-col overflow-hidden rounded-lg border border-forest/10 bg-ivory shadow-sm"
                >
                  <div className="flex aspect-[4/3] items-center justify-center bg-cream">
                    <img
                      src={image?.src || card.image}
                      srcSet={image?.srcSet}
                      sizes={image?.sizes || "(min-width: 1024px) 30vw, 92vw"}
                      alt={card.alt}
                      width={image?.width || 713}
                      height={image?.height || 713}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-contain p-6"
                    />
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-champagne">
                      {card.eyebrow}
                    </p>
                    <h3 className="mt-2 font-display text-3xl leading-tight text-forest">
                      {card.title}
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-ink/70">{card.text}</p>
                    <TrackedLink
                      to={card.to}
                      ctaId={card.ctaId}
                      ctaLocation="flyer_landing_categories"
                      ctaCategory={card.category}
                      className="mt-auto inline-flex pt-5 text-sm font-semibold text-forest underline decoration-champagne underline-offset-4"
                    >
                      {card.cta}
                    </TrackedLink>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="bg-cream py-12">
          <div className="container-page">
            <div className="max-w-3xl">
              <h2 className="font-display text-4xl leading-tight text-forest sm:text-5xl">
                Des repères clairs avant de choisir
              </h2>
              <p className="mt-4 text-base leading-7 text-ink/70">
                Verdanza privilégie une présentation directe : comprendre les
                catégories, vérifier les informations utiles et avancer vers la
                boutique sans parcours compliqué.
              </p>
            </div>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {trustItems.map((item) => (
                <article key={item.title} className="feature-panel">
                  <item.icon className="text-champagne" size={24} aria-hidden="true" />
                  <h3 className="mt-3 font-display text-3xl leading-tight text-forest">
                    {item.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-ink/65">{item.text}</p>
                </article>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <TrackedLink
                to="/livraison"
                ctaId="flyer_landing_delivery"
                ctaLocation="flyer_landing_trust"
                ctaCategory="delivery"
                className="btn-secondary"
              >
                <Truck size={18} aria-hidden="true" /> Voir la livraison
              </TrackedLink>
              <TrackedLink
                to="/qualite-conformite"
                ctaId="flyer_landing_quality"
                ctaLocation="flyer_landing_trust"
                ctaCategory="quality"
                className="btn-secondary"
              >
                <ShieldCheck size={18} aria-hidden="true" /> Qualité & conformité
              </TrackedLink>
            </div>
          </div>
        </section>

        <section className="container-page py-12 sm:py-16">
          <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-champagne">
                Poursuivre la découverte
              </p>
              <h2 className="mt-3 font-display text-4xl leading-tight text-forest sm:text-5xl">
                Découvrez Verdanza à votre rythme
              </h2>
              <p className="mt-4 max-w-3xl text-base leading-7 text-ink/70">
                Parcourez la sélection, consultez les informations de qualité
                et retrouvez les guides CBD pour mieux comprendre les produits
                avant de choisir.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <TrackedLink
                  to="/boutique"
                  ctaId="flyer_landing_final_shop"
                  ctaLocation="flyer_landing_final"
                  ctaCategory="shop_navigation"
                  className="btn-primary"
                >
                  <PackageCheck size={18} aria-hidden="true" /> Voir toute la boutique
                </TrackedLink>
                <TrackedLink
                  to="/blog"
                  ctaId="flyer_landing_final_guides"
                  ctaLocation="flyer_landing_final"
                  ctaCategory="content"
                  className="btn-secondary"
                >
                  <BookOpenText size={18} aria-hidden="true" /> Consulter les guides CBD
                </TrackedLink>
              </div>
            </div>
            <aside className="rounded-lg border border-champagne/30 bg-cream p-5 text-sm leading-6 text-forest">
              <p className="font-semibold">Informations de prudence</p>
              <p className="mt-3 text-ink/70">
                Réservé aux personnes majeures. Tenir hors de portée des enfants.
                Les produits CBD proposés ne sont pas des médicaments et ne font
                l’objet d’aucune promesse médicale.
              </p>
            </aside>
          </div>
        </section>
      </main>
    </>
  );
}

function TrackedLink({
  to,
  ctaId,
  ctaLocation,
  ctaCategory,
  className,
  children,
}: {
  to: string;
  ctaId: string;
  ctaLocation: string;
  ctaCategory: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={className}
      onClick={() =>
        trackCtaClick({
          ctaId,
          ctaLocation,
          destinationPath: to,
          ctaCategory,
        })
      }
    >
      {children}
    </Link>
  );
}
