import { NavLink, Outlet } from "react-router-dom";
import { useState } from "react";
import {
  BarChart3,
  BadgePercent,
  Boxes,
  FileText,
  LogOut,
  Heart,
  Megaphone,
  MessageSquare,
  Menu,
  Package,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Seo } from "../components/Seo";
import { BRAND_LOGO, BRAND_LOGO_ALT } from "../lib/brandAssets";

const adminNav = [
  { label: "Dashboard", to: "/admin", icon: BarChart3 },
  { label: "Produits", to: "/admin/produits", icon: Package },
  { label: "Stocks", to: "/admin/stocks", icon: Boxes },
  { label: "Commandes", to: "/admin/commandes", icon: ShoppingCart },
  { label: "Livraisons", to: "/admin/livraisons", icon: Truck },
  { label: "Promos", to: "/admin/coupons", icon: BadgePercent },
  { label: "Bannieres", to: "/admin/bannieres", icon: Megaphone },
  { label: "Factures", to: "/admin/factures", icon: FileText },
  { label: "Facturation", to: "/admin/facturation", icon: Settings },
  { label: "Clients", to: "/admin/clients", icon: Users },
  { label: "Favoris", to: "/admin/favoris", icon: Heart },
  { label: "Avis clients", to: "/admin/avis", icon: MessageSquare },
];

export function AdminLayout() {
  const { adminUser, signOut } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#f6f3ec] text-ink lg:grid lg:grid-cols-[260px_1fr]">
      <Seo
        title="Administration - Verdanza CBD"
        description="Espace administration Verdanza."
        path="/admin"
        noindex
      />
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-forest/10 bg-ivory/95 px-4 py-3 backdrop-blur lg:hidden">
        <img src={BRAND_LOGO} alt={BRAND_LOGO_ALT} className="h-12 rounded bg-ivory p-1" />
        <button
          className="icon-button"
          type="button"
          aria-label={isMenuOpen ? "Fermer le menu admin" : "Ouvrir le menu admin"}
          onClick={() => setIsMenuOpen((value) => !value)}
        >
          {isMenuOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
      </div>
      {isMenuOpen && (
        <button
          className="fixed inset-0 z-30 bg-ink/30 lg:hidden"
          aria-label="Fermer le menu admin"
          type="button"
          onClick={() => setIsMenuOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-forest/10 bg-forest p-5 text-ivory transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-auto lg:translate-x-0 ${
          isMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <img src={BRAND_LOGO} alt={BRAND_LOGO_ALT} className="h-16 rounded bg-ivory p-2" />
          <button
            className="icon-button border-ivory/20 bg-forest text-ivory hover:bg-ivory/10 lg:hidden"
            type="button"
            aria-label="Fermer le menu admin"
            onClick={() => setIsMenuOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="mt-5 border-b border-ivory/10 pb-4">
          <p className="text-xs uppercase tracking-[0.18em] text-champagne">
            Admin cockpit
          </p>
          <p className="mt-2 break-all text-xs text-ivory/65">{adminUser?.email}</p>
        </div>
        <nav className="mt-5 grid gap-1">
          {adminNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/admin"}
              onClick={() => setIsMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? "border-champagne/40 bg-ivory text-forest shadow-sm"
                    : "text-ivory/80 hover:bg-ivory/10 hover:text-ivory"
                }`
              }
            >
              <item.icon size={17} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          className="mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-ivory/20 px-3 py-2 text-sm font-medium text-ivory/80 hover:bg-ivory/10"
          onClick={() => void signOut()}
        >
          <LogOut size={16} />
          Deconnexion
        </button>
      </aside>
      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
