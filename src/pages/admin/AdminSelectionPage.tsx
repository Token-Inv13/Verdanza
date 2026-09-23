import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowDownToLine, ArrowUpRight, Check, ChevronDown, FileText, Pencil, Plus, Search, X } from "lucide-react";
import { Seo } from "../../components/Seo";
import { getFirestoreProducts } from "../../services/productsService";
import { catalogPublicationMissing } from "../../lib/selectionCatalog";
import {
  costPerGram, emptySelection, normalizeSelection, publicationMissing,
  selectionAromaFamilies, selectionCategories, selectionIntensities, selectionPriorities,
  selectionPublicName, selectionStatuses, type ProductSelection,
} from "../../types/selection";
import {
  downloadSelectionImage, downloadSelectionPdf, extractSelection, importSelections, listSelections,
  publishSelection, publishSelectionToCatalog, saveSelection, unpublishSelection, uploadSelectionImage,
} from "../../services/selectionService";

const money = (value: string | number) => {
  const amount = typeof value === "number" ? value : Number(value.replace(",", "."));
  return Number.isFinite(amount) && amount > 0
    ? amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + " €"
    : "—";
};
const dedupe = (item: ProductSelection) => item.url
  ? `url:${item.url.replace(/\/$/, "").toLowerCase()}`
  : `name:${item.name.toLowerCase()}:${item.supplier.toLowerCase()}`;
const selectionTabs = ["Tous", ...selectionStatuses] as const;
type SelectionTab = typeof selectionTabs[number];
type SelectionSort = "name" | "recent" | "priority";
type CatalogDraft = { id: string; price: string; stock: string; description: string };
const stageDescriptions: Record<SelectionTab, string> = {
  Tous: "Toutes vos références, du premier repérage à la boutique.",
  "À explorer": "Les pistes à examiner avant de passer commande.",
  "À commander": "Les références prévues pour une prochaine commande.",
  "À tester": "Les produits à découvrir et à évaluer.",
  Testé: "Vos essais réalisés, en attente d'une décision.",
  Retenu: "Les références qui ont gagné leur place dans votre sélection.",
  "En boutique": "Les produits sélectionnés pour votre boutique.",
  Écarté: "Les références mises de côté, conservées pour mémoire.",
};

export function AdminSelectionPage() {
  const [items, setItems] = useState<ProductSelection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SelectionTab>("Tous");
  const [category, setCategory] = useState("Tous");
  const [priorityFilter, setPriorityFilter] = useState("Tous");
  const [sort, setSort] = useState<SelectionSort>("name");
  const [showImportTools, setShowImportTools] = useState(false);
  const [link, setLink] = useState("");
  const [detailId, setDetailId] = useState("");
  const [draft, setDraft] = useState<ProductSelection | null>(null);
  const [catalogDraft, setCatalogDraft] = useState<CatalogDraft | null>(null);
  const [pendingImport, setPendingImport] = useState<ProductSelection[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<Array<{ id: string; name: string; slug: string; category: string; price: number; stock: number; isActive: boolean }>>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);

  const refresh = useCallback(async () => {
    try {
      const result = await listSelections();
      setItems(result.selections);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const refreshCatalog = useCallback(async () => {
    const products = await getFirestoreProducts(false);
    setCatalogProducts(products.map((product) => ({
      id: product.id, name: product.name, slug: product.slug, category: product.category,
      price: product.price, stock: product.stock, isActive: product.isActive !== false,
    })));
  }, []);
  useEffect(() => {
    void refreshCatalog().catch(() => { /* Selection remains usable if the commercial catalogue is unavailable. */ });
  }, [refreshCatalog]);

  const detail = items.find((item) => item.id === detailId) || null;
  const linkedCatalog = catalogProducts.find((product) => product.id === detail?.catalogProductId);
  const detailImage = useSelectionImage(detail?.id || "", detail?.imagePath || "");
  const draftImage = useSelectionImage(draft?.id || "", draft?.imagePath || "");
  const compared = compareIds.map((id) => items.find((item) => item.id === id)).filter((item): item is ProductSelection => Boolean(item));
  const stageCounts = useMemo(() => Object.fromEntries(selectionStatuses.map((stage) => [
    stage, items.filter((item) => item.status === stage).length,
  ])) as Record<ProductSelection["status"], number>, [items]);
  const filtered = useMemo(() => items.filter((item) => {
    const needle = query.trim().toLocaleLowerCase("fr");
    return (status === "Tous" || item.status === status)
      && (category === "Tous" || item.category === category)
      && (priorityFilter === "Tous" || item.priority === priorityFilter)
      && (!needle || [item.name, item.supplier, item.molecule, item.origin, item.aromas]
        .join(" ").toLocaleLowerCase("fr").includes(needle));
  }).sort((a, b) => {
    if (sort === "recent") return b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name, "fr");
    if (sort === "priority") return selectionPriorities.indexOf(a.priority) - selectionPriorities.indexOf(b.priority)
      || a.name.localeCompare(b.name, "fr");
    return a.name.localeCompare(b.name, "fr");
  }), [items, query, status, category, priorityFilter, sort]);
  const importDuplicates = useMemo(() => {
    const existing = new Set(items.map(dedupe));
    return pendingImport.filter((item) => existing.has(dedupe(item))).length;
  }, [items, pendingImport]);

  useEffect(() => {
    if (!detail && !draft) return;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setCatalogDraft(null); setDetailId(""); setDraft(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail, draft, catalogDraft]);

  const action = async (run: () => Promise<void>) => {
    setBusy(true); setError(""); setMessage("");
    try { await run(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Opération impossible."); }
    finally { setBusy(false); }
  };

  const handleExtract = (event: FormEvent) => {
    event.preventDefault();
    void action(async () => {
      const result = await extractSelection(link);
      setDraft(result.selection);
      setLink("");
      setMessage("Informations récupérées. Vérifiez les formats, le type et les prix avant d'enregistrer.");
    });
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const rows = Array.isArray(parsed) ? parsed :
        parsed && typeof parsed === "object" && "products" in parsed ? (parsed as { products: unknown }).products : null;
      if (!Array.isArray(rows) || !rows.length || rows.length > 100) throw new Error("Fichier JSON attendu : tableau de 1 à 100 produits.");
      setPendingImport(rows.map(normalizeSelection));
      setShowImportTools(true);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Fichier JSON invalide."); }
  };

  const saveDraft = (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    const previous = items.find((item) => item.id === draft.id);
    if (previous?.status === "En boutique" && draft.status !== "En boutique" &&
      !window.confirm("Quitter En boutique retirera la fiche publique et désactivera le produit marchand créé depuis cette sélection. Continuer ?")) return;
    void action(async () => {
      const result = await saveSelection(draft);
      setDraft(null);
      setDetailId(result.selection.id);
      setMessage("Sélection enregistrée.");
      await Promise.all([refresh(), refreshCatalog()]);
    });
  };

  const changeStatus = (item: ProductSelection, next: ProductSelection["status"]) => {
    if (item.status === "En boutique" && next !== "En boutique" &&
      !window.confirm("Quitter En boutique retirera la fiche publique et désactivera le produit marchand créé depuis cette sélection. Continuer ?")) return;
    void action(async () => {
      await saveSelection({ ...item, status: next });
      setMessage("Étape mise à jour.");
      await Promise.all([refresh(), refreshCatalog()]);
    });
  };

  const downloadPdf = (item: ProductSelection) => void action(async () => {
    const blob = await downloadSelectionPdf(item.id);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `verdanza-${selectionPublicName(item).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setMessage("PDF téléchargé pour vérification.");
  });

  const publish = (item: ProductSelection) => {
    const missing = publicationMissing(item);
    if (missing.length) { setError(`À compléter : ${missing.join(", ")}.`); return; }
    if (!window.confirm(`Publier la fiche de ${selectionPublicName(item)} sur verdanza.fr/fiches-produits ?`)) return;
    void action(async () => {
      await publishSelection(item.id);
      setMessage("Fiche publiée dans la bibliothèque publique.");
      await refresh();
    });
  };

  const unpublish = (item: ProductSelection) => {
    if (!window.confirm(`Retirer la fiche de ${selectionPublicName(item)} de la page publique ?`)) return;
    void action(async () => {
      await unpublishSelection(item.id);
      setMessage("Fiche retirée de la page publique.");
      await refresh();
    });
  };

  const submitCatalog = (event: FormEvent) => {
    event.preventDefault();
    if (!catalogDraft) return;
    const price = Number(catalogDraft.price.replace(",", "."));
    const stock = Number(catalogDraft.stock);
    void action(async () => {
      const result = await publishSelectionToCatalog(catalogDraft.id, {
        price, stock, description: catalogDraft.description.trim(),
      });
      setCatalogDraft(null);
      setMessage(`Produit mis en boutique dans ${result.category === "flowers" ? "Fleurs CBD" : "Résines CBD"}.`);
      await Promise.all([refresh(), refreshCatalog()]);
    });
  };

  const toggleCompare = (id: string) => setCompareIds((current) => current.includes(id)
    ? current.filter((entry) => entry !== id) : [...current.slice(-2), id]);

  const handleTabKey = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % selectionTabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + selectionTabs.length) % selectionTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = selectionTabs.length - 1;
    else return;
    event.preventDefault();
    setStatus(selectionTabs[next]);
    tabButtons.current[next]?.focus();
  };

  return (
    <div className="min-h-screen bg-[#f6f3ec] px-4 py-7 text-forest sm:px-7 lg:px-10">
      <Seo title="Atelier de sélection - Admin Verdanza" description="Sélections privées Verdanza." path="/admin/selection" noindex />
      <header className="relative overflow-hidden rounded-[1.75rem] bg-forest px-6 py-7 text-ivory shadow-sm sm:px-8 lg:px-10">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-40 h-80 w-80 rounded-full border border-champagne/20 sm:right-16" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-24 h-80 w-80 rounded-full border border-champagne/10 sm:right-28" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.22em] text-champagne">Produits & fournisseurs · espace privé</p>
            <h1 className="mt-2 font-display text-4xl leading-tight sm:text-5xl">Atelier de sélection</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ivory/75">Suivez chaque référence, comparez vos choix et préparez les fiches destinées à la boutique.</p>
          </div>
          <button type="button" className="relative inline-flex min-h-12 items-center gap-2 rounded-lg bg-ivory px-5 py-3 text-sm font-semibold text-forest shadow-sm transition hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne" onClick={() => setDraft(emptySelection())}>
            <Plus size={17} /> Ajouter un produit
          </button>
        </div>
        <div className="relative mt-6 flex flex-wrap gap-x-8 gap-y-3 border-t border-ivory/15 pt-5 text-sm">
          <span><strong className="mr-2 font-display text-2xl leading-none">{items.length}</strong><span className="text-ivory/70">produits suivis</span></span>
          <span><strong className="mr-2 font-display text-2xl leading-none">{stageCounts["À tester"]}</strong><span className="text-ivory/70">à tester</span></span>
          <span><strong className="mr-2 font-display text-2xl leading-none">{stageCounts.Retenu}</strong><span className="text-ivory/70">retenus</span></span>
          <span><strong className="mr-2 font-display text-2xl leading-none">{stageCounts["En boutique"]}</strong><span className="text-ivory/70">en boutique</span></span>
        </div>
      </header>

      <section className="mt-5 overflow-hidden rounded-2xl border border-forest/10 bg-ivory shadow-sm" aria-label="Importer et exporter des produits">
        <button type="button" className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-cream/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-champagne sm:px-6" aria-expanded={showImportTools} aria-controls="selection-import-tools" onClick={() => setShowImportTools((open) => !open)}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cream text-forest"><ArrowDownToLine size={19} /></span>
          <span className="min-w-0 flex-1"><span className="block font-semibold">Ajouter depuis un fournisseur</span><span className="mt-0.5 block text-xs text-ink/60">Importer un lien, reprendre un fichier JSON ou exporter une sauvegarde.</span></span>
          <ChevronDown size={18} className={`shrink-0 text-forest/60 transition-transform ${showImportTools ? "rotate-180" : ""}`} />
        </button>
        {showImportTools && <div id="selection-import-tools" className="border-t border-forest/10 px-5 pb-5 pt-4 sm:px-6">
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={handleExtract}>
            <label className="sr-only" htmlFor="selection-url">Lien de fiche fournisseur</label>
            <input id="selection-url" className="input-field min-w-0 flex-1" type="url" required placeholder="Collez le lien de la fiche fournisseur…" value={link} onChange={(event) => setLink(event.target.value)} />
            <button className="btn-primary" disabled={busy}>Importer le lien</button>
          </form>
          <p className="mt-2 text-xs text-ink/55">Les informations proposées par le fournisseur restent à vérifier avant enregistrement.</p>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-forest/10 pt-4">
            <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => fileInput.current?.click()}><ArrowDownToLine size={16} /> Importer JSON</button>
            <button type="button" className="btn-secondary" disabled={!items.length} onClick={() => downloadJson(items)}>Exporter JSON</button>
            <input ref={fileInput} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void handleFile(event)} />
          </div>
          {pendingImport.length > 0 && <div className="mt-4 rounded-lg border border-champagne/40 bg-cream p-4 text-sm">
            <strong>{pendingImport.length} références dans le fichier</strong> · {importDuplicates} doublon{importDuplicates > 1 ? "s" : ""} détecté{importDuplicates > 1 ? "s" : ""}.
            <p className="mt-1 text-ink/65">Les doublons seront ignorés. Aucune fiche publique ne sera créée par cet import.</p>
            <div className="mt-3 max-h-32 overflow-y-auto text-xs text-ink/70">{pendingImport.map((item, index) => <p key={`${item.name}-${index}`}>{item.name} · {item.supplier || "Fournisseur à renseigner"}</p>)}</div>
            <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn-primary" disabled={busy} onClick={() => void action(async () => {
              const result = await importSelections(pendingImport); setPendingImport([]);
              setMessage(`${result.imported} produits importés, ${result.skipped} ignorés.`); await refresh();
            })}>Confirmer l'import</button>
            <button type="button" className="btn-secondary" onClick={() => setPendingImport([])}>Annuler</button></div>
          </div>}
        </div>}
      </section>

      {(error || message) && <div role={error ? "alert" : "status"} className={`mt-4 rounded-lg px-4 py-3 text-sm ${error ? "bg-red-50 text-red-800" : "bg-[#eaf2e8] text-forest"}`}>{error || message}</div>}

      <section className="mt-5 overflow-hidden rounded-2xl border border-forest/10 bg-ivory shadow-sm" aria-label="Catalogue de sélection">
        <div className="px-5 pb-4 pt-6 sm:px-7">
          <p className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-champagne">Votre catalogue de travail</p>
          <h2 className="mt-1 font-display text-3xl sm:text-4xl">Parcours des produits</h2>
        </div>
        <div className="border-y border-forest/10 bg-[#eef1ea] px-3 py-2 sm:px-5">
          <div role="tablist" aria-label="Étapes des sélections" className="flex gap-1 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin" }}>
            {selectionTabs.map((entry, index) => <button key={entry} ref={(node) => { tabButtons.current[index] = node; }} id={`selection-tab-${index}`} type="button" role="tab" aria-selected={status === entry} aria-controls="selection-results" tabIndex={status === entry ? 0 : -1} onClick={() => setStatus(entry)} onKeyDown={(event) => handleTabKey(event, index)} className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne ${status === entry ? "bg-forest text-ivory shadow-sm" : "text-forest/75 hover:bg-ivory hover:text-forest"}`}>
              <span>{entry === "Tous" ? "Toutes" : entry}</span><span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-bold ${status === entry ? "bg-ivory/15 text-ivory" : "bg-forest/10 text-forest/70"}`}>{entry === "Tous" ? items.length : stageCounts[entry]}</span>
            </button>)}
          </div>
        </div>
        <div id="selection-results" role="tabpanel" aria-labelledby={`selection-tab-${selectionTabs.indexOf(status)}`} tabIndex={0} className="px-5 pb-6 pt-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-champagne sm:px-7">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h3 className="font-display text-2xl">{status === "Tous" ? "Toutes les sélections" : status}</h3><p className="mt-1 text-sm text-ink/60">{stageDescriptions[status]}</p></div>
            <span className="rounded-full bg-cream px-3 py-1.5 text-xs font-semibold text-forest/80">{filtered.length} résultat{filtered.length === 1 ? "" : "s"}</span>
          </div>
          <div className="mt-5 grid gap-3 rounded-xl border border-forest/10 bg-[#faf9f5] p-3 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1fr)_minmax(9rem,auto)_minmax(9rem,auto)_minmax(11rem,auto)] sm:p-4">
            <label className="block text-[0.7rem] font-bold uppercase tracking-[0.12em] text-forest/60 sm:col-span-2 xl:col-span-1">Rechercher
              <span className="relative mt-1 block"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-forest/45" size={16} /><input className="input-field w-full pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Produit, molécule, fournisseur…" /></span>
            </label>
            <label className="block text-[0.7rem] font-bold uppercase tracking-[0.12em] text-forest/60">Type de produit
              <select id="selection-category" className="input-field mt-1" value={category} onChange={(event) => setCategory(event.target.value)}><option value="Tous">Tous les types</option>{selectionCategories.map((entry) => <option key={entry}>{entry}</option>)}</select>
            </label>
            <label className="block text-[0.7rem] font-bold uppercase tracking-[0.12em] text-forest/60">Niveau d'intérêt
              <select className="input-field mt-1" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="Tous">Tous les niveaux</option>{selectionPriorities.map((entry) => <option key={entry}>{entry}</option>)}</select>
            </label>
            <label className="block text-[0.7rem] font-bold uppercase tracking-[0.12em] text-forest/60 sm:col-span-2 xl:col-span-1">Trier par
              <select className="input-field mt-1" value={sort} onChange={(event) => setSort(event.target.value as SelectionSort)}><option value="name">Nom A–Z</option><option value="recent">Modification récente</option><option value="priority">Intérêt prioritaire</option></select>
            </label>
          </div>
          {(query || category !== "Tous" || priorityFilter !== "Tous") && <button type="button" className="mt-3 text-xs font-semibold text-forest underline decoration-champagne underline-offset-4" onClick={() => { setQuery(""); setCategory("Tous"); setPriorityFilter("Tous"); }}>Effacer les filtres</button>}
          {loading ? <p className="py-12 text-center text-ink/60">Chargement des sélections…</p> :
            filtered.length === 0 ? <div className="mt-5 rounded-xl border border-dashed border-forest/20 bg-cream/50 px-5 py-12 text-center">
              <p className="font-display text-2xl">Aucune référence ici pour le moment</p><p className="mx-auto mt-2 max-w-md text-sm text-ink/60">{query || category !== "Tous" || priorityFilter !== "Tous" ? "Essayez une autre recherche ou effacez les filtres." : stageDescriptions[status]}</p>
              {query || category !== "Tous" || priorityFilter !== "Tous" ? <button type="button" className="btn-secondary mt-5" onClick={() => { setQuery(""); setCategory("Tous"); setPriorityFilter("Tous"); }}>Effacer les filtres</button> : <button type="button" className="btn-secondary mt-5" onClick={() => setDraft(emptySelection())}><Plus size={16} /> Ajouter un produit</button>}
            </div> : <>
              <div className="mt-5 grid gap-3 xl:hidden">{filtered.map((item) => <article key={item.id} className="rounded-xl border border-forest/10 bg-ivory p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3"><div className="flex flex-wrap gap-2"><CategoryBadge category={item.category} /><PriorityBadge priority={item.priority} /></div><button type="button" className="rounded-lg border border-forest/15 p-2 hover:bg-cream" aria-label={`Ouvrir la fiche ${item.name}`} onClick={() => setDetailId(item.id)}><ArrowUpRight size={17} /></button></div>
                <button type="button" className="mt-3 block text-left text-base font-semibold leading-snug hover:underline" onClick={() => setDetailId(item.id)}>{item.name}</button>
                <p className="mt-1 text-xs text-ink/55">{[item.molecule, item.rate, item.origin].filter(Boolean).join(" · ") || "Caractéristiques à vérifier"}</p>
                <div className="mt-4 space-y-2 border-t border-forest/10 pt-3 text-sm"><div className="flex items-start justify-between gap-4"><span className="shrink-0 text-xs text-ink/50">Fournisseur</span><span className="min-w-0 text-right text-xs font-medium [overflow-wrap:anywhere]">{item.supplier || "À renseigner"}</span></div><div className="flex items-start justify-between gap-4"><span className="shrink-0 text-xs text-ink/50">Premier prix</span><span className="min-w-0 text-right"><strong>{item.prices[0] ? money(item.prices[0].price) : "—"}</strong><small className="block text-xs text-ink/50">{item.prices[0]?.format || "Aucun format"}</small></span></div></div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-forest/10 pt-3"><label className="inline-flex items-center gap-2 text-xs text-ink/65"><input type="checkbox" checked={compareIds.includes(item.id)} onChange={() => toggleCompare(item.id)} /> Comparer</label><select className="rounded-lg border border-forest/15 bg-ivory px-3 py-2 text-xs" value={item.status} disabled={busy} aria-label={`Étape de ${item.name}`} onChange={(event) => changeStatus(item, event.target.value as ProductSelection["status"])}>{selectionStatuses.map((entry) => <option key={entry}>{entry}</option>)}</select></div>
              </article>)}</div>
              <div className="mt-5 hidden overflow-x-auto xl:block"><table className="w-full min-w-[950px] border-collapse text-left text-sm">
                <thead><tr className="border-b border-forest/15 text-[0.65rem] uppercase tracking-[0.14em] text-forest/55">
                  <th className="w-20 py-3 pr-3">Comparer</th><th className="w-[31%] py-3 pr-3">Produit</th><th className="py-3 pr-3">Profil</th><th className="py-3 pr-3">Fournisseur</th><th className="py-3 pr-3">Premier prix</th><th className="py-3 pr-3">Étape</th><th className="py-3">Fiche</th>
                </tr></thead><tbody>{filtered.map((item) => <tr key={item.id} className="border-b border-forest/10 transition-colors last:border-0 hover:bg-cream/70">
                  <td className="py-4 pr-3"><input type="checkbox" checked={compareIds.includes(item.id)} onChange={() => toggleCompare(item.id)} aria-label={`Comparer ${item.name}`} /></td>
                  <td className="py-4 pr-4"><button type="button" className="text-left font-semibold leading-snug hover:underline" onClick={() => setDetailId(item.id)}>{item.name}</button><p className="mt-1 text-xs text-ink/55">{item.origin || "Provenance à renseigner"}</p></td>
                  <td className="py-4 pr-3"><div className="flex flex-wrap gap-1.5"><CategoryBadge category={item.category} /><PriorityBadge priority={item.priority} /></div><p className="mt-1.5 text-xs text-ink/55">{[item.molecule, item.rate].filter(Boolean).join(" · ") || "Profil à vérifier"}</p></td>
                  <td className="py-4 pr-3 text-ink/75">{item.supplier || "—"}</td>
                  <td className="py-4 pr-3"><span className="font-semibold">{item.prices[0] ? money(item.prices[0].price) : "—"}</span><p className="mt-1 text-xs text-ink/55">{item.prices[0]?.format || "Aucun format"}</p></td>
                  <td className="py-4 pr-3"><select className="rounded-lg border border-forest/15 bg-ivory px-2 py-2 text-xs" value={item.status} disabled={busy} aria-label={`Étape de ${item.name}`} onChange={(event) => changeStatus(item, event.target.value as ProductSelection["status"])}>{selectionStatuses.map((entry) => <option key={entry}>{entry}</option>)}</select></td>
                  <td className="py-4"><button type="button" className="rounded-lg border border-forest/15 p-2 hover:bg-cream" aria-label={`Ouvrir la fiche ${item.name}`} onClick={() => setDetailId(item.id)}><ArrowUpRight size={17} /></button></td>
                </tr>)}</tbody></table></div>
            </>}
        </div>
      </section>

      {compared.length > 0 && <section className="mt-6 rounded-xl border border-forest/10 bg-ivory p-5 shadow-sm" aria-label="Comparaison des produits">
        <div className="flex items-center justify-between"><h2 className="font-display text-2xl">Comparer {compared.length} produit{compared.length > 1 ? "s" : ""}</h2><button type="button" className="text-xs underline" onClick={() => setCompareIds([])}>Effacer</button></div>
        <div className="mt-4 overflow-x-auto"><table className="min-w-[580px] w-full text-sm"><tbody>
          {(["name", "category", "molecule", "rate", "origin", "culture", "aromas", "intensity", "taste", "status"] as const).map((key) => <tr key={key} className="border-b border-forest/10"><th className="w-36 py-2 text-left capitalize text-ink/55">{key}</th>{compared.map((item) => <td key={item.id} className="px-3 py-2">{item[key] || "—"}</td>)}</tr>)}
          <tr><th className="py-2 text-left text-ink/55">Coût / g</th>{compared.map((item) => <td key={item.id} className="px-3 py-2">{item.prices.slice(1).map((row) => <p key={row.format}>{row.format} : {costPerGram(row) ? money(costPerGram(row)!) + " / g" : "à vérifier"}</p>)}</td>)}</tr>
        </tbody></table></div>
      </section>}

      {detail && !draft && <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest/65 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailId(""); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="selection-detail-title" className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-ivory shadow-2xl">
          <div className="flex items-start justify-between gap-4 bg-forest px-6 py-5 text-ivory sm:px-9">
            <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-champagne">Fiche de sélection · {detail.category}</p>
              <h2 id="selection-detail-title" className="mt-2 font-display text-3xl sm:text-4xl">{detail.name}</h2>
              <p className="mt-2 text-xs text-ivory/70">{detail.supplier} · {detail.molecule || "Molécule à vérifier"}</p></div>
            <button ref={closeButton} type="button" className="rounded-lg border border-ivory/35 p-2" aria-label="Fermer la fiche" onClick={() => setDetailId("")}><X size={19} /></button>
          </div>
          <div className="overflow-y-auto p-6 sm:p-9">
            {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            {message && <p role="status" className="mb-4 rounded-lg bg-[#eaf2e8] p-3 text-sm">{message}</p>}
            {(detailImage || detail.imageUrl) && <img className="mb-6 max-h-56 w-full rounded-xl bg-cream object-contain" src={detailImage || detail.imageUrl} alt={detail.name} />}
            <div className="grid overflow-hidden rounded-xl border border-forest/10 sm:grid-cols-5">{[
              ["Type", detail.category], ["Molécule", detail.molecule], ["Taux indiqué", detail.rate], ["Provenance", detail.origin], ["Culture", detail.culture],
            ].map(([label, value]) => <div key={label} className="border-b border-r border-forest/10 p-3"><p className="text-[0.65rem] font-bold uppercase tracking-[0.13em] text-forest/55">{label}</p><p className="mt-1 text-sm font-semibold">{value || "À renseigner"}</p></div>)}</div>
            <div className="mt-7 grid gap-7 lg:grid-cols-[1.4fr_0.8fr]">
              <div className="space-y-6">
                <DetailSection title="En quelques mots"><p>{detail.description || "Description à compléter."}</p></DetailSection>
                <DetailSection title="Formats & prix"><div className="overflow-hidden rounded-lg border border-forest/10">{detail.prices.length ? detail.prices.map((row, index) => <div key={`${row.format}-${index}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-forest/10 px-4 py-3 text-sm last:border-0"><span>{row.format}</span><span className="font-semibold">{money(row.price)}{index > 0 && <small className="ml-2 font-normal text-ink/60">{costPerGram(row) ? `${money(costPerGram(row)!)} / g` : "coût / g à vérifier"}</small>}</span></div>) : <p className="p-4 text-ink/60">Formats à renseigner.</p>}</div><p className="text-xs text-ink/50">Prix fournisseur relevés lors de l'import, à vérifier avant commande.</p></DetailSection>
                <DetailSection title="Profil client"><p><strong>Goût :</strong> {detail.taste || "À renseigner"}</p><p><strong>Arômes :</strong> {detail.aromas || "À renseigner"}</p><p><strong>Intensité :</strong> {detail.intensity || "À renseigner"}</p><p><strong>Aspect :</strong> {detail.appearance || "À renseigner"}</p></DetailSection>
                {Object.keys(detail.attributes).length > 0 && <DetailSection title="Caractéristiques fournisseur">{Object.entries(detail.attributes).map(([key, value]) => <p key={key}><strong>{key} :</strong> {value}</p>)}</DetailSection>}
              </div>
              <aside className="space-y-4"><div className="rounded-xl border border-forest/10 bg-cream p-4"><h3 className="text-xs font-bold uppercase tracking-[0.14em]">Votre sélection</h3><p className="mt-3 text-sm">Étape : <strong>{detail.status}</strong></p><p className="mt-2 text-sm">Intérêt : <strong>{detail.priority}</strong></p><p className="mt-2 text-sm">Note : <strong>{detail.rating || "Pas encore noté"}</strong></p></div>
                <div className="rounded-xl border border-forest/10 p-4"><h3 className="text-xs font-bold uppercase tracking-[0.14em]">Notes privées</h3><p className="mt-3 whitespace-pre-wrap text-sm text-ink/70">{detail.notes || "Aucune note pour le moment."}</p></div>
                <div className="rounded-xl border border-forest/10 p-4"><h3 className="text-xs font-bold uppercase tracking-[0.14em]">Publication</h3><p className="mt-2 text-sm">{detail.publishedSlug ? detail.updatedAt > detail.publishedAt ? "Fiche modifiée depuis sa publication : mettez-la à jour" : "Fiche en ligne" : publicationMissing(detail).length ? `À compléter : ${publicationMissing(detail).join(", ")}` : "Prête à publier"}</p>{detail.publishedSlug && <a className="mt-2 inline-block text-sm underline" href="/fiches-produits" target="_blank" rel="noreferrer">Voir les fiches publiques ↗</a>}</div>
                <div className="rounded-xl border border-forest/10 bg-[#f8faf6] p-4"><h3 className="text-xs font-bold uppercase tracking-[0.14em]">Boutique en ligne</h3>
                  {linkedCatalog ? <><p className="mt-2 text-sm font-semibold">{linkedCatalog.name}</p><p className="mt-1 text-xs text-ink/60">{linkedCatalog.category === "flowers" ? "Fleurs CBD" : "Résines CBD"} · {money(linkedCatalog.price)} / g · {linkedCatalog.stock} g en stock</p><p className={`mt-2 text-xs font-semibold ${linkedCatalog.isActive ? "text-forest" : "text-amber-800"}`}>{linkedCatalog.isActive ? "En ligne" : "Inactif"}</p>{linkedCatalog.isActive && <a className="mt-2 inline-block text-sm underline" href={`/produits/${linkedCatalog.slug}`} target="_blank" rel="noreferrer">Voir dans la boutique ↗</a>}</> : <p className="mt-2 text-sm text-ink/60">{detail.catalogProductId ? "Produit lié indisponible : vérifiez le catalogue." : "Pas encore publié dans la boutique."}</p>}
                  {!linkedCatalog?.isActive && catalogPublicationMissing(detail).length > 0 && <p className="mt-2 text-xs text-amber-800">À compléter pour la boutique : {catalogPublicationMissing(detail).join(", ")}.</p>}
                  <a className="mt-2 inline-block text-xs underline" href="/admin/produits">Gérer les produits ↗</a>
                </div>
                {detail.url && <a href={detail.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm underline">Fiche fournisseur <ArrowUpRight size={15} /></a>}
              </aside>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-forest/10 bg-ivory px-6 py-4 sm:px-9">
            {detail.publishedSlug && <button type="button" className="btn-secondary" disabled={busy} onClick={() => unpublish(detail)}>Dépublier</button>}
            <button type="button" className="btn-secondary" disabled={busy || publicationMissing(detail).length > 0} onClick={() => publish(detail)}>{detail.publishedSlug ? "Mettre à jour la fiche" : "Publier la fiche"}</button>
            <button type="button" className="btn-secondary inline-flex items-center gap-2" disabled={busy || !detail.imagePath} onClick={() => downloadPdf(detail)}><FileText size={16} /> Créer le PDF</button>
            {(!detail.catalogProductId || detail.catalogProductId === `selection-${detail.id}`) && !linkedCatalog?.isActive && <button type="button" className="btn-primary" disabled={busy || catalogPublicationMissing(detail).length > 0} title={catalogPublicationMissing(detail).length ? `À compléter : ${catalogPublicationMissing(detail).join(", ")}` : undefined} onClick={() => setCatalogDraft({ id: detail.id, price: linkedCatalog?.price ? String(linkedCatalog.price).replace(".", ",") : "", stock: linkedCatalog?.stock ? String(linkedCatalog.stock) : "", description: detail.description || "" })}>{linkedCatalog ? "Remettre en boutique" : "Mettre en boutique"}</button>}
            <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setDraft({ ...detail })}><Pencil size={16} /> Modifier</button>
          </div>
        </section>
      </div>}

      {catalogDraft && detail && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-forest/75 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCatalogDraft(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="selection-catalog-title" className="w-full max-w-xl overflow-hidden rounded-2xl bg-ivory shadow-2xl">
          <div className="bg-forest px-6 py-5 text-ivory"><p className="text-xs font-bold uppercase tracking-[0.18em] text-champagne">Publication marchande</p><h2 id="selection-catalog-title" className="mt-1 font-display text-3xl">{linkedCatalog ? "Remettre en boutique" : "Mettre en boutique"}</h2><p className="mt-2 text-sm text-ivory/75">{selectionPublicName(detail)} · {detail.category === "Fleur" ? "Fleurs CBD" : "Résines CBD"}</p></div>
          <form className="space-y-4 p-6" onSubmit={submitCatalog}>
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            <p className="text-sm leading-6 text-ink/70">Le prix ci-dessous est le prix de vente au gramme. Les prix fournisseur ne sont jamais transférés au catalogue. La boutique utilisera le panier et les modes de paiement actuellement configurés sur le site.</p>
            <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold">Prix de vente / g (€)<input className="input-field mt-1 w-full" value={catalogDraft.price} inputMode="decimal" required placeholder="9,90" onChange={(event) => setCatalogDraft({ ...catalogDraft, price: event.target.value })} /></label><label className="text-xs font-semibold">Stock disponible (g)<input className="input-field mt-1 w-full" type="number" min="1" step="1" required value={catalogDraft.stock} onChange={(event) => setCatalogDraft({ ...catalogDraft, stock: event.target.value })} /></label></div>
            <label className="block text-xs font-semibold">Description visible par les clients<textarea className="input-field mt-1 min-h-28 w-full" minLength={30} maxLength={1000} required value={catalogDraft.description} onChange={(event) => setCatalogDraft({ ...catalogDraft, description: event.target.value })} /></label>
            <p className="rounded-lg border border-forest/10 bg-cream p-3 text-xs leading-5 text-ink/70">La fiche utilisera l’image Verdanza, les arômes, la provenance et le profil renseignés dans la sélection. Vous pourrez ensuite la modifier dans Admin → Produits. Les formats promotionnels ne sont pas activés automatiquement.</p>
            <div className="flex justify-end gap-2 border-t border-forest/10 pt-4"><button type="button" className="btn-secondary" disabled={busy} onClick={() => setCatalogDraft(null)}>Annuler</button><button type="submit" className="btn-primary" disabled={busy}>{busy ? "Publication…" : "Confirmer la mise en boutique"}</button></div>
          </form>
        </section>
      </div>}

      {draft && <div className="fixed inset-0 z-50 flex justify-end bg-forest/55" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraft(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="selection-edit-title" className="flex h-full w-full max-w-2xl flex-col bg-ivory shadow-2xl">
          <div className="flex items-center justify-between border-b border-forest/10 px-5 py-4"><div><p className="text-[0.65rem] font-bold uppercase tracking-[0.17em] text-champagne">Fiche de sélection</p><h2 id="selection-edit-title" className="font-display text-3xl">{draft.id ? "Modifier le produit" : "Nouveau produit"}</h2></div><button ref={closeButton} type="button" className="rounded-md border p-2" aria-label="Fermer l'éditeur" onClick={() => setDraft(null)}><X size={18} /></button></div>
          <form id="selection-form" className="grid flex-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2" onSubmit={saveDraft}>
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">{error}</p>}
            {message && <p role="status" className="rounded-lg bg-[#eaf2e8] p-3 text-sm sm:col-span-2">{message}</p>}
            <Field label="Nom du produit *" value={draft.name} required onChange={(value) => setDraft({ ...draft, name: value })} wide />
            <Field label="Nom public de la fiche" value={draft.publicName} onChange={(value) => setDraft({ ...draft, publicName: value })} wide />
            <SelectField label="Étape" value={draft.status} values={selectionStatuses} onChange={(value) => setDraft({ ...draft, status: value as ProductSelection["status"] })} />
            <SelectField label="Intérêt" value={draft.priority} values={selectionPriorities} onChange={(value) => setDraft({ ...draft, priority: value as ProductSelection["priority"] })} />
            <SelectField label="Type" value={draft.category} values={selectionCategories} onChange={(value) => setDraft({ ...draft, category: value as ProductSelection["category"] })} />
            <Field label="Molécule" value={draft.molecule} onChange={(value) => setDraft({ ...draft, molecule: value })} />
            <Field label="Taux indiqué" value={draft.rate} onChange={(value) => setDraft({ ...draft, rate: value })} />
            <Field label="Provenance" value={draft.origin} onChange={(value) => setDraft({ ...draft, origin: value })} />
            <Field label="Culture / fabrication" value={draft.culture} onChange={(value) => setDraft({ ...draft, culture: value })} />
            <Field label="Fournisseur" value={draft.supplier} onChange={(value) => setDraft({ ...draft, supplier: value })} />
            <Field label="Lien de la fiche fournisseur" value={draft.url} type="url" onChange={(value) => setDraft({ ...draft, url: value })} wide />
            <TextArea label="Courte description" value={draft.description} onChange={(value) => setDraft({ ...draft, description: value })} wide />
            <AttributesField key={draft.id || "new"} value={draft.attributes} onChange={(attributes) => setDraft({ ...draft, attributes })} />
            <div className="sm:col-span-2"><div className="flex items-center justify-between"><h3 className="text-sm font-bold">Formats et prix fournisseur</h3><button type="button" className="text-xs underline" onClick={() => setDraft({ ...draft, prices: [...draft.prices, { format: "", price: "" }] })}>+ Ajouter un format</button></div>
              {draft.prices.map((row, index) => <div key={index} className="mt-2 flex items-center gap-2"><input className="input-field min-w-0 flex-1" aria-label={`Format ${index + 1}`} placeholder="3 g (+ 1 g offert)" value={row.format} onChange={(event) => setDraft({ ...draft, prices: draft.prices.map((entry, position) => position === index ? { ...entry, format: event.target.value } : entry) })} /><input className="input-field w-24" aria-label={`Prix ${index + 1} en euros`} placeholder="36,20" inputMode="decimal" value={row.price} onChange={(event) => setDraft({ ...draft, prices: draft.prices.map((entry, position) => position === index ? { ...entry, price: event.target.value } : entry) })} /><button type="button" aria-label={`Retirer le format ${index + 1}`} onClick={() => setDraft({ ...draft, prices: draft.prices.filter((_, position) => position !== index) })}><X size={16} /></button></div>)}
            </div>
            <TextArea label="Goût / profil aromatique" value={draft.taste} onChange={(value) => setDraft({ ...draft, taste: value })} wide />
            <Field label="Arômes (séparés par des virgules)" value={draft.aromas} onChange={(value) => setDraft({ ...draft, aromas: value })} wide />
            <SelectField label="Intensité" value={draft.intensity} values={["", ...selectionIntensities]} onChange={(value) => setDraft({ ...draft, intensity: value as ProductSelection["intensity"] })} />
            <SelectField label="Famille aromatique" value={draft.aromaFamily} values={["", ...selectionAromaFamilies]} onChange={(value) => setDraft({ ...draft, aromaFamily: value as ProductSelection["aromaFamily"] })} />
            <Field label="Aspect" value={draft.appearance} onChange={(value) => setDraft({ ...draft, appearance: value })} wide />
            <TextArea label="Notes de test / décision (privées)" value={draft.notes} onChange={(value) => setDraft({ ...draft, notes: value })} wide />
            <Field label="Note personnelle de 0 à 5" value={String(draft.rating)} type="number" onChange={(value) => setDraft({ ...draft, rating: Number(value) })} />
            <Field label="Lien image source (référence)" value={draft.imageUrl} type="url" onChange={(value) => setDraft({ ...draft, imageUrl: value })} />
            <label className="block text-xs font-semibold sm:col-span-2">Produit de la boutique lié (facultatif)
              <select className="input-field mt-1 w-full" value={draft.catalogProductId} onChange={(event) => setDraft({ ...draft, catalogProductId: event.target.value })}>
                <option value="">Aucun produit lié</option>
                {catalogProducts.map((product) => <option key={product.id} value={product.id}>{product.name}{product.isActive ? "" : " · inactif"}</option>)}
              </select>
            </label>
            <div className="sm:col-span-2 rounded-lg border border-forest/10 bg-cream p-4 text-sm"><p className="font-semibold">Image de la fiche Verdanza</p><p className="mt-1 text-xs text-ink/60">Utilisez une image que Verdanza peut publier. Enregistrez d'abord le produit, puis ajoutez le fichier JPEG/PNG/WebP.</p>
              {(draftImage || draft.imageUrl) && <img className="mt-3 max-h-40 max-w-full rounded-md object-contain" src={draftImage || draft.imageUrl} alt="Aperçu du produit" />}
              {draft.imagePath && <p className="mt-2 inline-flex items-center gap-1 text-xs text-forest"><Check size={14} /> Image enregistrée</p>}
              {draft.id && <input className="mt-3 block w-full text-xs" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Ajouter une image produit" onChange={(event) => void handleImageFile(event, draft, setDraft, action, refresh)} />}
            </div>
          </form>
          <div className="flex justify-end gap-2 border-t border-forest/10 px-5 py-4"><button type="button" className="btn-secondary" onClick={() => setDraft(null)}>Annuler</button><button type="submit" form="selection-form" className="btn-primary" disabled={busy}>Enregistrer</button></div>
        </section>
      </div>}
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-2 text-sm leading-6 text-ink/75"><h3 className="border-b border-forest/10 pb-2 font-display text-2xl text-forest">{title}</h3>{children}</section>;
}

function CategoryBadge({ category }: { category: ProductSelection["category"] }) {
  const tone = category === "Fleur" ? "bg-[#e8f0e6] text-[#285b40]" : category === "Résine"
    ? "bg-[#f3eadb] text-[#795730]" : "bg-[#f1efeb] text-ink/65";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[0.7rem] font-semibold ${tone}`}>{category === "Autre" ? "Type à préciser" : category}</span>;
}

function PriorityBadge({ priority }: { priority: ProductSelection["priority"] }) {
  const tone = priority === "Haute" ? "bg-[#f8ecdc] text-[#875d23]" : priority === "Moyenne"
    ? "bg-[#eef1e9] text-forest/75" : "bg-[#f1efeb] text-ink/60";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[0.7rem] font-semibold ${tone}`}>Intérêt {priority.toLowerCase()}</span>;
}

function Field({ label, value, onChange, wide, required, type = "text" }: {
  label: string; value: string; onChange: (value: string) => void; wide?: boolean; required?: boolean; type?: string;
}) {
  return <label className={`block text-xs font-semibold ${wide ? "sm:col-span-2" : ""}`}>{label}
    <input className="input-field mt-1 w-full" value={value} required={required} type={type} onChange={(event) => onChange(event.target.value)} /></label>;
}

function SelectField({ label, value, values, onChange }: {
  label: string; value: string; values: readonly string[]; onChange: (value: string) => void;
}) {
  return <label className="block text-xs font-semibold">{label}<select className="input-field mt-1 w-full" value={value} onChange={(event) => onChange(event.target.value)}>{values.map((option) => <option key={option} value={option}>{option || "À renseigner"}</option>)}</select></label>;
}

function TextArea({ label, value, onChange, wide }: {
  label: string; value: string; onChange: (value: string) => void; wide?: boolean;
}) {
  return <label className={`block text-xs font-semibold ${wide ? "sm:col-span-2" : ""}`}>{label}<textarea className="input-field mt-1 min-h-24 w-full" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

async function handleImageFile(event: ChangeEvent<HTMLInputElement>, item: ProductSelection,
  setDraft: (value: ProductSelection) => void, action: (run: () => Promise<void>) => Promise<void>, refresh: () => Promise<void>) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  await action(async () => {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image illisible.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob || blob.size > 2_000_000) throw new Error("Image trop volumineuse après optimisation.");
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error("Lecture de l'image impossible."));
      reader.readAsDataURL(blob);
    });
    const result = await uploadSelectionImage(item.id, base64);
    setDraft({ ...item, imagePath: result.imagePath, updatedAt: result.updatedAt });
    await refresh();
  });
}

function downloadJson(items: ProductSelection[]) {
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `verdanza-selections-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function parseAttributes(value: string) {
  const attributes: Record<string, string> = {};
  for (const line of value.split("\n")) {
    const separator = line.indexOf(":");
    if (separator > 0) attributes[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return attributes;
}

function AttributesField({ value, onChange }: { value: Record<string, string>; onChange: (value: Record<string, string>) => void }) {
  const [text, setText] = useState(Object.entries(value).map(([key, detail]) => `${key} : ${detail}`).join("\n"));
  return <label className="block text-xs font-semibold sm:col-span-2">Caractéristiques fournisseur (une par ligne : nom : valeur)
    <textarea className="input-field mt-1 min-h-24 w-full" value={text} onChange={(event) => {
      setText(event.target.value);
      onChange(parseAttributes(event.target.value));
    }} /></label>;
}

function useSelectionImage(id: string, path: string) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl("");
    if (!id || !path) return;
    let active = true;
    let objectUrl = "";
    void downloadSelectionImage(id).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      if (active) setUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    }).catch(() => { /* The original supplier image remains an optional fallback. */ });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, path]);
  return url;
}
