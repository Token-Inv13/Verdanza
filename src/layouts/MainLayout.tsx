import { NavLink, Outlet } from "react-router-dom";
import { Menu, ShoppingBag, UserRound } from "lucide-react";
import { useState } from "react";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { AgeGate } from "../components/AgeGate";
import { ComplianceNote } from "../components/ComplianceNote";
import { staticImageVariants } from "../lib/generatedImageVariants";

const navItems = [
  { label: "Accueil", to: "/" },
  { label: "Boutique", to: "/boutique" },
  { label: "Fleurs CBD", to: "/fleurs-cbd" },
  { label: "Résines CBD", to: "/resines-cbd" },
  { label: "Livraison", to: "/livraison-postale" },
  { label: "Qualité", to: "/qualite-conformite" },
];

export function MainLayout() {
  const [open, setOpen] = useState(false);
  const { itemCount } = useCart();
  const { user } = useAuth();
  const logoImage = staticImageVariants["/verdanza-logo.png"];
  const contactEmail =
    (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) ||
    "contact@verdanza.fr";

  return (
    <div className="min-h-screen bg-ivory text-ink">
      <AgeGate />
      <header className="sticky top-0 z-40 border-b border-forest/10 bg-ivory/95 backdrop-blur">
        <div className="container-page flex min-h-20 items-center justify-between gap-4">
          <NavLink to="/" className="flex items-center gap-3">
            <img
              src={logoImage?.src || "/verdanza-logo.png"}
              srcSet={logoImage?.srcSet}
              sizes={logoImage?.sizes || "180px"}
              alt="Verdanza"
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
              <NavLink key={item.to} to={item.to} onClick={() => setOpen(false)}>
                {item.label}
              </NavLink>
            ))}
            <NavLink to={user ? "/compte" : "/connexion"} onClick={() => setOpen(false)}>
              {user ? "Mon compte" : "Connexion"}
            </NavLink>
          </nav>
        )}
      </header>
      <Outlet />
      <ComplianceNote />
      <footer className="bg-cream py-12">
        <div className="container-page grid gap-8 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <img
              src={logoImage?.src || "/verdanza-logo.png"}
              srcSet={logoImage?.srcSet}
              sizes={logoImage?.sizes || "180px"}
              alt="Verdanza"
              width={logoImage?.width || 180}
              height={logoImage?.height || 82}
              loading="lazy"
              decoding="async"
              className="h-16 w-auto"
            />
            <p className="mt-4 max-w-md text-sm leading-6 text-ink/70">
              Verdanza sélectionne des produits CBD premium, conformes et
              contrôlés, avec livraison postale en France et livraison locale
              selon zone disponible.
            </p>
          </div>
          <div className="grid gap-2 text-sm text-forest/80">
            <strong className="text-forest">Informations</strong>
            <NavLink to="/livraison-postale">Livraison en France</NavLink>
            <NavLink to="/livraison-express-aix">Express local Aix</NavLink>
            <NavLink to="/faq">FAQ</NavLink>
            <NavLink to="/contact">Contact</NavLink>
            {contactEmail && <a href={`mailto:${contactEmail}`}>{contactEmail}</a>}
          </div>
          <div className="grid gap-2 text-sm text-forest/80">
            <strong className="text-forest">Légal</strong>
            <NavLink to="/mentions-legales">Mentions légales</NavLink>
            <NavLink to="/cgv">CGV</NavLink>
            <NavLink to="/confidentialite">Confidentialité</NavLink>
            <NavLink to="/retours">Retours</NavLink>
          </div>
        </div>
      </footer>
    </div>
  );
}
