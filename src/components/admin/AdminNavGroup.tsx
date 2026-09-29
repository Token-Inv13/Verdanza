import { useEffect, useId, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, type LucideIcon } from "lucide-react";

export type AdminNavItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  accountingTab?: string;
};

function isActive(item: AdminNavItem, pathname: string, search: string) {
  if (item.accountingTab && pathname === "/admin/comptabilite") {
    return new URLSearchParams(search).get("tab") === item.accountingTab;
  }
  if (item.to === "/admin/comptabilite") {
    const tab = new URLSearchParams(search).get("tab");
    return pathname === item.to && !["achats", "couts", "factures", "facturation"].includes(tab || "");
  }
  return pathname === item.to.split("?")[0];
}

export function AdminNavGroup({ title, items, collapsible = false, onNavigate }: {
  title: string;
  items: AdminNavItem[];
  collapsible?: boolean;
  onNavigate: () => void;
}) {
  const { pathname, search } = useLocation();
  const hasActive = items.some((item) => isActive(item, pathname, search));
  const [expanded, setExpanded] = useState(hasActive);
  const id = useId();
  useEffect(() => {
    if (hasActive) setExpanded(true);
  }, [hasActive, pathname, search]);

  return <section>
    {collapsible ? <button type="button" aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded((value) => !value)}
      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[0.65rem] font-bold uppercase tracking-[0.14em] text-champagne hover:text-ivory focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne">
      {title}<ChevronDown size={15} aria-hidden="true" className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
    </button> : <h2 className="px-3 py-2 text-[0.65rem] font-bold uppercase tracking-[0.14em] text-champagne">{title}</h2>}
    <div id={id} hidden={collapsible && !expanded} className="space-y-1">
      {items.map((item) => {
        const active = isActive(item, pathname, search);
        return <Link key={item.to} to={item.to} onClick={onNavigate}
          aria-current={active ? "page" : false}
          className={`flex items-center gap-3 rounded-md border border-transparent px-3 py-2 text-sm font-medium transition ${active
            ? "border-champagne/40 bg-ivory text-forest shadow-sm"
            : "text-ivory/80 hover:bg-ivory/10 hover:text-ivory"}`}>
          <item.icon size={17} aria-hidden="true" />{item.label}
        </Link>;
      })}
    </div>
  </section>;
}
