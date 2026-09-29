import { Outlet } from "react-router-dom";
import { useState } from "react";
import {
  Archive,
  BarChart3,
  BadgePercent,
  Boxes,
  Calculator,
  FileText,
  Settings,
  Wallet,
  LineChart,
  LogOut,
  Heart,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Menu,
  Package,
  ScanSearch,
  ShoppingCart,
  Truck,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Seo } from "../components/Seo";
import { BrandLogo } from "../components/BrandLogo";
import { AdminNavGroup, type AdminNavItem } from "../components/admin/AdminNavGroup";

const adminNav: Array<{ title: string; items: AdminNavItem[] }> = [
  { title: "Tableau de bord", items: [
    { label: "Tableau de bord", to: "/admin", icon: BarChart3 },
    { label: "Analytics", to: "/admin/analytics", icon: LineChart },
  ] },
  { title: "Catalogue", items: [
    { label: "Sélection", to: "/admin/selection", icon: ScanSearch },
    { label: "Produits", to: "/admin/produits", icon: Package },
    { label: "Stocks", to: "/admin/stocks", icon: Boxes },
  ] },
  { title: "Commandes", items: [
    { label: "Commandes", to: "/admin/commandes", icon: ShoppingCart },
    { label: "Clients", to: "/admin/clients", icon: Users },
    { label: "Livraisons", to: "/admin/livraisons", icon: Truck },
  ] },
  { title: "Marketing", items: [
    { label: "Vue d'ensemble", to: "/admin/marketing", icon: BarChart3 },
    { label: "Bannières", to: "/admin/bannieres", icon: Megaphone },
    { label: "Promotions", to: "/admin/coupons", icon: BadgePercent },
    { label: "Concours", to: "/admin/concours", icon: Trophy },
  ] },
  { title: "Communauté", items: [
    { label: "Avis clients", to: "/admin/avis", icon: MessageSquare },
    { label: "Commentaires", to: "/admin/commentaires-blog", icon: MessagesSquare },
    { label: "Favoris", to: "/admin/favoris", icon: Heart },
  ] },
  { title: "Contenu", items: [
    { label: "Archives", to: "/admin/archives", icon: Archive },
  ] },
  { title: "Gestion", items: [
    { label: "Comptabilité", to: "/admin/comptabilite", icon: Calculator },
    { label: "Achats fournisseurs", to: "/admin/comptabilite?tab=achats", icon: ShoppingCart, accountingTab: "achats" },
    { label: "Coûts manuels", to: "/admin/comptabilite?tab=couts", icon: Wallet, accountingTab: "couts" },
    { label: "Factures", to: "/admin/factures", icon: FileText, accountingTab: "factures" },
    { label: "Facturation", to: "/admin/facturation", icon: FileText, accountingTab: "facturation" },
  ] },
  { title: "Paramètres", items: [
    { label: "Paramètres", to: "/admin/parametres", icon: Settings },
  ] },
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
        <BrandLogo variant="horizontal" className="h-auto w-[160px]" />
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
          isMenuOpen ? "visible translate-x-0" : "invisible -translate-x-full lg:visible"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <BrandLogo
            variant="horizontal"
            tone="gold"
            className="h-auto w-full max-w-[205px]"
          />
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
        <nav aria-label="Navigation administration" className="scrollbar-hidden my-5 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain">
          {adminNav.map((group) => (
            <AdminNavGroup key={group.title} {...group} collapsible onNavigate={() => setIsMenuOpen(false)} />
          ))}
        </nav>
        <button
          className="mt-auto inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-ivory/20 px-3 py-2 text-sm font-medium text-ivory/80 hover:bg-ivory/10"
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
