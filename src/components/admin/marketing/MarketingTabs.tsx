import { NavLink } from "react-router-dom";

export function MarketingTabs() {
  return <nav aria-label="Marketing" className="flex flex-wrap gap-2 rounded-xl border border-forest/10 bg-ivory p-3">
    {[["/admin/marketing", "Vue d'ensemble"], ["/admin/bannieres", "Bannières"], ["/admin/coupons", "Promotions"], ["/admin/concours", "Concours"]].map(([to, label]) =>
      <NavLink key={to} to={to} end className={({ isActive }) => `${isActive ? "btn-primary" : "btn-secondary"} min-h-10 px-4 py-2`}>{label}</NavLink>)}
  </nav>;
}
