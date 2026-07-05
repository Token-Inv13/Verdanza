import { NavLink, Outlet } from "react-router-dom";
import {
  BarChart3,
  BadgePercent,
  Boxes,
  FileText,
  Package,
  Settings,
  ShoppingCart,
  Truck,
  Users,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Seo } from "../components/Seo";

const adminNav = [
  { label: "Dashboard", to: "/admin", icon: BarChart3 },
  { label: "Produits", to: "/admin/produits", icon: Package },
  { label: "Stocks", to: "/admin/stocks", icon: Boxes },
  { label: "Commandes", to: "/admin/commandes", icon: ShoppingCart },
  { label: "Livraisons", to: "/admin/livraisons", icon: Truck },
  { label: "Promos", to: "/admin/coupons", icon: BadgePercent },
  { label: "Factures", to: "/admin/factures", icon: FileText },
  { label: "Facturation", to: "/admin/facturation", icon: Settings },
  { label: "Clients", to: "/admin/clients", icon: Users },
];

export function AdminLayout() {
  const { adminUser, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-[#f6f3ec] text-ink lg:grid lg:grid-cols-[260px_1fr]">
      <Seo
        title="Administration - Verdanza CBD"
        description="Espace administration Verdanza."
        noindex
      />
      <aside className="border-r border-forest/10 bg-forest p-5 text-ivory">
        <img src="/verdanza-logo.png" alt="Verdanza" className="h-16 rounded bg-ivory p-2" />
        <p className="mt-6 text-xs uppercase tracking-[0.18em] text-champagne">
          Admin cockpit
        </p>
        <p className="mt-2 text-xs text-ivory/65">{adminUser?.email}</p>
        <nav className="mt-5 grid gap-2">
          {adminNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/admin"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                  isActive
                    ? "bg-ivory text-forest"
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
          className="mt-8 w-full rounded-md border border-ivory/20 px-3 py-2 text-sm text-ivory/80 hover:bg-ivory/10"
          onClick={() => void signOut()}
        >
          Deconnexion
        </button>
      </aside>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
