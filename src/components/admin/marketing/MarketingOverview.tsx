import { Link } from "react-router-dom";
import type { MarketingContext } from "../../../types/marketing";
import { bannerState, promotionState } from "../../../lib/marketingBusinessStatus";

export function MarketingOverview({ context }: { context: MarketingContext }) {
  const rows = [
    { type: "Promotions", active: context.coupons.filter((p) => p.source !== "contest" && promotionState(p) === "Active").length, scheduled: context.coupons.filter((p) => p.source !== "contest" && promotionState(p) === "Programmée").length, drafts: context.coupons.filter((p) => p.source !== "contest" && ["Inactive", "Modèle"].includes(promotionState(p))).length, draftLabel: ["inactive ou modèle", "inactives ou modèles"], finished: context.coupons.filter((p) => p.source !== "contest" && ["Archivée", "Terminée", "Limite atteinte"].includes(promotionState(p))).length },
    { type: "Bannières", active: context.banners.filter((b) => bannerState(b, context.coupons) === "Active").length, scheduled: context.banners.filter((b) => bannerState(b, context.coupons) === "Programmée").length, drafts: context.banners.filter((b) => !["Active", "Programmée", "Archivée", "Expirée"].includes(bannerState(b, context.coupons))).length, draftLabel: ["inactive, modèle ou bloquée", "inactives, modèles ou bloquées"], finished: context.banners.filter((b) => ["Archivée", "Expirée"].includes(bannerState(b, context.coupons))).length },
    { type: "Concours", active: context.contests.filter((c) => c.status === "active").length, scheduled: context.contests.filter((c) => c.status === "scheduled").length, drafts: context.contests.filter((c) => c.status === "draft").length, draftLabel: ["brouillon", "brouillons"], finished: context.contests.filter((c) => !["active", "scheduled", "draft"].includes(c.status)).length },
  ];
  return <section className="admin-card"><h2 className="font-display text-3xl text-forest">Campagnes</h2>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{rows.map((row) => <article key={row.type} className="min-w-0 rounded-xl border border-forest/10 p-4 text-sm">
      <h3 className="font-semibold text-forest">{row.type}</h3><p className="mt-2"><strong>{row.active}</strong> en cours · <strong>{row.scheduled}</strong> à venir</p>
      <p className="text-ink/60">{row.drafts} {row.draftLabel[row.drafts === 1 ? 0 : 1]}</p>
    </article>)}</div>
    <details className="mt-4 text-sm"><summary className="cursor-pointer font-semibold text-forest">Voir les états terminés et les précisions</summary>
      <ul className="mt-2 grid gap-1 text-ink/65">{rows.map((row) => <li key={row.type}>{row.type} : {row.finished} terminée(s) ou archivée(s)</li>)}</ul>
      <p className="mt-2">Les bannières liées à une promotion sont détaillées dans Bannières. Les tirages et gagnants restent dans Concours.</p>
      <Link className="btn-secondary mt-3 min-h-9 px-3 py-1" to="/admin/concours">Ouvrir les concours</Link>
    </details>
  </section>;
}
