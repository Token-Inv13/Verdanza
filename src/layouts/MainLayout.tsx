import { NavLink, Outlet } from "react-router-dom";
import { Menu, ShoppingBag, UserRound } from "lucide-react";
import { useState } from "react";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { AgeGate } from "../components/AgeGate";
import { ComplianceNote } from "../components/ComplianceNote";
import { CookieConsentBanner } from "../components/CookieConsentBanner";
import { FloatingContactButton } from "../components/FloatingContactButton";
import { PromoBannersProvider, PromoBannerSlot } from "../components/PromoBannerSlot";
import { useConsent } from "../context/ConsentContext";
import { staticImageVariants } from "../lib/generatedImageVariants";
import { BRAND_LOGO, BRAND_LOGO_ALT } from "../lib/brandAssets";
import { trackContactClick, trackCtaClick } from "../lib/analytics";
import { getActiveSocialLinks } from "../lib/socialLinks";

const navItems = [
  { label: "Accueil", to: "/" },
  { label: "Boutique", to: "/boutique" },
  { label: "Fleurs CBD", to: "/fleurs-cbd" },
  { label: "Résines CBD", to: "/resines-cbd" },
  { label: "Guides", to: "/blog" },
  { label: "Livraison", to: "/livraison" },
  { label: "Qualité", to: "/qualite-conformite" },
];

function ctaCategoryForPath(path: string) {
  if (path.startsWith("/blog")) return "content";
  if (path.startsWith("/livraison")) return "delivery";
  if (path === "/boutique") return "shop_navigation";
  if (path === "/fleurs-cbd" || path === "/resines-cbd") return "category_navigation";
  if (path === "/qualite-conformite") return "quality";
  if (path === "/faq") return "support";
  if (path === "/contact") return "contact";
  return "navigation";
}

function ctaIdForPath(prefix: string, path: string) {
  return `${prefix}_${path.replace(/^\/+/, "").replace(/[^a-z0-9]+/gi, "_") || "home"}`;
}

export function MainLayout() {
  const [open, setOpen] = useState(false);
  const { itemCount } = useCart();
  const { user } = useAuth();
  const consent = useConsent();
  const logoImage = staticImageVariants[BRAND_LOGO];
  const contactEmail =
    (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) ||
    "contact@verdanza.fr";
  const socialLinks = getActiveSocialLinks();

  return (
    <div className="min-h-screen bg-ivory text-ink">
      <PromoBannersProvider>
        <AgeGate />
        <header className="sticky top-0 z-40 border-b border-forest/10 bg-ivory/95 backdrop-blur">
        <div className="container-page flex min-h-20 items-center justify-between gap-4">
          <NavLink to="/" className="flex items-center gap-3">
            <img
              src={logoImage?.src || BRAND_LOGO}
              srcSet={logoImage?.srcSet}
              sizes={logoImage?.sizes || "180px"}
              alt={BRAND_LOGO_ALT}
              width={logoImage?.width || 180}
              height={logoImage?.height || 82}
              decoding="async"
              className="h-14 w-auto"
            />
          </NavLink>
          <nav className="hidden items-center gap-6 text-sm text-forest/80 lg:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() =>
                  trackCtaClick({
                    ctaId: ctaIdForPath("header_nav", item.to),
                    ctaLocation: "header",
                    destinationPath: item.to,
                    ctaCategory: ctaCategoryForPath(item.to),
                  })
                }
                className={({ isActive }) =>
                  isActive ? "text-forest underline decoration-champagne" : ""
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <NavLink
              to={user ? "/compte" : "/connexion"}
              className="icon-button"
              aria-label={user ? "Mon compte" : "Connexion"}
            >
              <UserRound size={18} />
              <span className="hidden text-xs sm:inline">
                {user ? "Mon compte" : "Connexion"}
              </span>
            </NavLink>
            <NavLink to="/panier" className="icon-button" aria-label="Panier">
              <ShoppingBag size={18} />
              {itemCount > 0 && <span className="ml-1 text-xs">{itemCount}</span>}
            </NavLink>
            <button
              className="icon-button lg:hidden"
              onClick={() => setOpen((value) => !value)}
              aria-label="Menu"
            >
              <Menu size={18} />
            </button>
          </div>
        </div>
        {open && (
          <nav className="container-page grid gap-3 border-t border-forest/10 pb-5 pt-2 text-sm text-forest lg:hidden">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => {
                  setOpen(false);
                  trackCtaClick({
                    ctaId: ctaIdForPath("mobile_nav", item.to),
                    ctaLocation: "mobile_menu",
                    destinationPath: item.to,
                    ctaCategory: ctaCategoryForPath(item.to),
                  });
                }}
              >
                {item.label}
              </NavLink>
            ))}
            <NavLink to={user ? "/compte" : "/connexion"} onClick={() => setOpen(false)}>
              {user ? "Mon compte" : "Connexion"}
            </NavLink>
          </nav>
        )}
        </header>
        <PromoBannerSlot type="top_bar" />
        <Outlet />
        <ComplianceNote />
      </PromoBannersProvider>
      <footer className="bg-cream py-12">
        <div className="container-page grid gap-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <img
              src={logoImage?.src || BRAND_LOGO}
              srcSet={logoImage?.srcSet}
              sizes={logoImage?.sizes || "180px"}
              alt={BRAND_LOGO_ALT}
              width={logoImage?.width || 180}
              height={logoImage?.height || 82}
              loading="lazy"
              decoding="async"
              className="h-16 w-auto"
            />
            <p className="mt-4 max-w-md text-sm leading-6 text-ink/70">
              Verdanza sélectionne des produits CBD conformes et
              contrôlés, avec livraison postale en France et livraison locale
              selon zone disponible.
            </p>
            <p className="mt-4 max-w-md text-xs leading-5 text-ink/55">
              <strong className="font-semibold text-forest/75">
                Connexion Google.
              </strong>{" "}
              Verdanza CBD est une boutique en ligne de fleurs et résines CBD.
              La connexion Google permet uniquement de créer ou retrouver votre
              compte client à partir du nom et de l’adresse e-mail associés à
              votre compte Google.{" "}
              <NavLink
                to="/confidentialite"
                className="font-semibold text-forest/75 underline decoration-champagne underline-offset-4"
              >
                Confidentialité
              </NavLink>
            </p>
          </div>
          <div className="grid gap-2 text-sm text-forest/80">
            <strong className="text-forest">Informations</strong>
            {[
              { to: "/livraison", label: "Livraison" },
              { to: "/livraison-postale", label: "Livraison en France" },
              { to: "/livraison-locale", label: "Express local Aix" },
              { to: "/blog", label: "Guides CBD" },
              { to: "/a-propos", label: "À propos" },
              { to: "/faq", label: "FAQ" },
              { to: "/contact", label: "Contact" },
            ].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() =>
                  trackCtaClick({
                    ctaId: ctaIdForPath("footer_info", item.to),
                    ctaLocation: "footer_information",
                    destinationPath: item.to,
                    ctaCategory: ctaCategoryForPath(item.to),
                  })
                }
              >
                {item.label}
              </NavLink>
            ))}
            {contactEmail && (
              <a
                href={`mailto:${contactEmail}`}
                onClick={() => trackContactClick("email", "footer")}
              >
                {contactEmail}
              </a>
            )}
            <button
              type="button"
              className="text-left underline decoration-champagne underline-offset-4"
              onClick={consent.openPreferences}
            >
              Gérer mes cookies
            </button>
          </div>
          <div className="grid gap-2 text-sm text-forest/80">
            <strong className="text-forest">Légal</strong>
            <NavLink to="/mentions-legales">Mentions légales</NavLink>
            <NavLink to="/cgv">CGV</NavLink>
            <NavLink to="/confidentialite">Confidentialité</NavLink>
            <NavLink to="/retours">Retours</NavLink>
          </div>
          {socialLinks.length > 0 && (
            <div className="grid content-start gap-2 text-sm text-forest/80">
              <strong className="text-forest">Réseaux</strong>
              {socialLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={link.ariaLabel}
                  className="transition-colors hover:text-forest"
                >
                  {link.label}
                </a>
              ))}
            </div>
          )}
        </div>
      </footer>
      <FloatingContactButton />
      <CookieConsentBanner />
    </div>
  );
}
