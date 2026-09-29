import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getAdminDeliveryZones } from "../../services/deliveryZonesService";
import { getBillingSettings } from "../../services/invoicesService";
import { getMarketingAiStatus } from "../../services/marketingAiService";

type Status = "loading" | "ready" | "empty" | "degraded" | "error";
type State = { billing: Status; delivery: Status; ai: Status; billingValidated: boolean; zoneCount: number; aiLabel: string };
const initial: State = { billing: "loading", delivery: "loading", ai: "loading", billingValidated: false, zoneCount: 0, aiLabel: "" };

export default function AdminSettingsPage() {
  const [state, setState] = useState<State>(initial);
  const version = useRef(0);
  const invalidate = useCallback(() => { version.current++; }, []);
  const load = useCallback(async () => {
    const requestVersion = ++version.current;
    setState((previous) => ({ ...previous, billing: "loading", delivery: "loading", ai: "loading" }));
    const [billing, delivery, ai] = await Promise.allSettled([getBillingSettings(), getAdminDeliveryZones(), getMarketingAiStatus()]);
    if (requestVersion !== version.current) return;
    setState({
      billing: billing.status === "rejected" ? "error" : billing.value.source === "local" ? "degraded" : "ready",
      billingValidated: billing.status === "fulfilled" && billing.value.source === "firestore" && billing.value.settings.isManuallyValidated && billing.value.settings.vatMode !== "not_configured",
      delivery: delivery.status === "rejected" ? "error" : delivery.value.source === "empty" ? "empty" : "ready",
      zoneCount: delivery.status === "fulfilled" ? delivery.value.zones.length : 0,
      ai: ai.status === "rejected" ? "error" : "ready",
      aiLabel: ai.status === "fulfilled" ? { disabled: "Désactivée", missing_configuration: "Configuration incomplète", ready: "Prête" }[ai.value.state] : "",
    });
  }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);

  return <section className="grid min-w-0 gap-5" aria-label="Centre de configuration">
    <header className="admin-card flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-champagne">Admin V3</p><h1 className="font-display text-4xl text-forest">Paramètres</h1><p className="mt-1 text-sm text-ink/60">État des réglages existants et accès aux modules qui les gèrent.</p></div><button type="button" className="btn-secondary" onClick={() => void load()}>Recharger les états</button></header>
    <div className="grid gap-4 md:grid-cols-2">
      <article className="admin-card min-w-0"><h2 className="font-display text-2xl text-forest">Facturation</h2>
        <p role="status" className="mt-2 text-sm">{state.billing === "loading" ? "Lecture des paramètres…" : state.billing === "error" ? "Données indisponibles. Réessayez." : state.billing === "degraded" ? "Aucun réglage de facturation enregistré : modèle local non validé." : state.billingValidated ? "Informations de facturation validées." : "Vérification des informations de facturation nécessaire."}</p>
        <Link className="btn-secondary mt-4" to="/admin/comptabilite?tab=facturation">Ouvrir la facturation</Link></article>
      <article className="admin-card min-w-0"><h2 className="font-display text-2xl text-forest">Livraisons</h2>
        <p role="status" className="mt-2 text-sm">{state.delivery === "loading" ? "Lecture des zones…" : state.delivery === "error" ? "Données indisponibles. Réessayez." : state.delivery === "empty" ? "Aucune zone enregistrée en base." : `${state.zoneCount} zone(s) enregistrée(s) en base.`}</p>
        <Link className="btn-secondary mt-4" to="/admin/livraisons">Gérer les zones</Link></article>
      <article className="admin-card min-w-0"><h2 className="font-display text-2xl text-forest">Catalogue et sélection</h2><p className="mt-2 text-sm text-ink/70">Produits, stocks et politiques de prix se gèrent dans leurs écrans spécialisés.</p><div className="mt-4 flex flex-wrap gap-2"><Link className="btn-secondary" to="/admin/produits">Produits</Link><Link className="btn-secondary" to="/admin/stocks">Stocks</Link><Link className="btn-secondary" to="/admin/selection">Sélection et prix</Link></div></article>
      <article className="admin-card min-w-0"><h2 className="font-display text-2xl text-forest">Marketing</h2><p className="mt-2 text-sm text-ink/70">Campagnes, promotions et bannières se préparent dans Marketing.</p><Link className="btn-secondary mt-4" to="/admin/marketing">Ouvrir Marketing</Link></article>
      <article className="admin-card min-w-0 md:col-span-2"><h2 className="font-display text-2xl text-forest">Assistant Marketing IA</h2><p role="status" className="mt-2 text-sm">{state.ai === "loading" ? "Vérification de l’état serveur…" : state.ai === "error" ? "État serveur indisponible. Réessayez." : state.aiLabel}</p><p className="mt-1 text-xs text-ink/60">L’activation se gère côté serveur. Cette page ne modifie aucune configuration IA.</p><Link className="btn-secondary mt-4" to="/admin/marketing">Voir l’assistant</Link></article>
    </div>
  </section>;
}
