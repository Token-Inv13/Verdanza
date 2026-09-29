import { useCallback, useEffect, useState } from "react";
import { AdminConfirmDialog } from "../AdminConfirmDialog";
import { getSelectionPipeline, runSelectionPipeline } from "../../../services/selectionService";
import { pipelineStage, type PipelineAction, type PipelineContext } from "../../../types/selectionPipeline";
import { selectionValidationMissing } from "../../../lib/selectionPipeline";
import { selectionPublicName, type ProductSelection } from "../../../types/selection";

const nextAction = { draft: "validateSelection", selection_validated: "prepareProduct", product_prepared: "createCatalog", catalog_ready: "validatePublication", publish_ready: "activate", published: "prepareProduct" } as const;
const labels = { validateSelection: "Valider la sélection", prepareProduct: "Préparer le brouillon produit", createCatalog: "Préparer le catalogue", validatePublication: "Valider le récapitulatif", activate: "Publier dans la boutique" };
export function SelectionWorkflow({ item, onChanged, onEdit }: { item: ProductSelection; onChanged: () => Promise<void>; onEdit: () => void }) {
  const [context, setContext] = useState<PipelineContext | null>(null);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{ action: Exclude<PipelineAction, "save" | "publishSheet" | "unpublishSheet">; operationId: string } | null>(null);
  const load = useCallback(async () => { const value = await getSelectionPipeline(item.id); setContext(value); return value; }, [item.id]);
  useEffect(() => { let active = true; setContext(null); void getSelectionPipeline(item.id).then((value) => { if (active) setContext(value); }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Workflow indisponible."); }); return () => { active = false; }; }, [item.id, item.revision]);
  const stage = context ? pipelineStage(context.workflow) : "draft";
  const action = nextAction[stage];
  const product = context?.product;
  const draft = context?.workflow.draft;
  const missing = selectionValidationMissing(item);
  return <section className="space-y-3 rounded-xl border border-forest/15 bg-cream p-4" aria-label="Parcours de publication">
    <h3 className="font-display text-2xl">Parcours de publication</h3>
    <ol className="flex flex-wrap gap-2 text-xs">{["Source", "Sélection", "Produit", "Catalogue", "Publication"].map((s, index) => <li key={s} className="rounded-full border border-forest/15 px-3 py-2">{s}{index === 0 || (context && [context.workflow.selectionValidatedRevision, context.workflow.productPreparedRevision, context.workflow.catalogReadyRevision, context.workflow.publishedRevision][index - 1] === context.workflow.revision) ? " ✓" : " · à valider"}</li>)}</ol>
    <p className="text-xs">Révision {item.revision || 0} · {context?.workflow.stale ? "Validation obsolète après modification" : stage === "published" ? "Publication validée" : labels[action]}</p>
    <p className="text-xs">{product ? `Produit lié : ${product.name} · ${product.internalReference || "référence à réserver"} · ${product.isActive ? "actif" : "inactif"} · ${product.stock} g` : item.catalogProductId ? "Produit lié indisponible" : "Aucun produit catalogue créé"}</p>
    {product && <a className="block text-xs underline" href="/admin/stocks">Corriger le stock dans la gestion transactionnelle</a>}
    {missing.length > 0 && <p className="text-xs text-amber-800">À compléter : {missing.join(", ")}.</p>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    <button type="button" className="btn-primary" disabled={!context || (action === "validateSelection" && missing.length > 0)} onClick={() => { setError(""); void load().then((value) => { setConfirmation({ action: nextAction[pipelineStage(value.workflow)], operationId: crypto.randomUUID() }); }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Relecture indisponible.")); }}>{labels[action]}</button>
    <AdminConfirmDialog open={Boolean(confirmation)} title={confirmation ? labels[confirmation.action] : "Validation"} description="Vérifiez les données et la révision avant confirmation." confirmLabel={confirmation?.action === "activate" ? "Confirmer et publier" : "Confirmer cette étape"} onCancel={() => setConfirmation(null)} summary={<div className="space-y-2">
      <p><strong>{selectionPublicName(item)}</strong> · {item.category} · Révision {item.revision || 0}</p>
      <p>Intensité : {item.intensity || "à compléter"} · Arômes : {item.aromas || "à compléter"} · Famille : {item.aromaFamily || "à compléter"}</p>
      <p>Aspect : {item.appearance || "à compléter"} · Provenance : {item.origin || "à compléter"} · Culture : {item.culture || "à compléter"}</p>
      <p>{draft?.longDescription || item.commercial?.description || "Description client à compléter"}</p>
      <p>Prix : {draft?.price || item.commercial?.pricePerGram || "à compléter"} €/g · Stock : {product ? `${product.stock} g conservés` : `${item.commercial?.initialStock ?? "à compléter"} g initiaux`}</p>
      <p>Formats : {(draft?.fixedPriceOptions || item.commercial?.fixedPriceOptions || []).map((o) => `${o.quantityGrams} g : ${o.totalPrice} €`).join(" · ") || (item.economics || []).map((r) => `${r.label} : ${r.finalPrice ?? "à compléter"} €`).join(" · ") || "Vente au gramme"}</p>
      <p>Image : {item.imagePath ? "image Verdanza enregistrée" : "à compléter"} · Galerie : {draft?.images?.length || 0} image(s) · SEO : {draft?.seoTitle || item.commercial?.seoTitle || "à compléter"}</p>
      <p>{draft?.seoDescription || item.commercial?.seoDescription || "Description SEO à compléter"}</p>
      <p>Identifiant : {item.catalogProductId || `selection-${item.id}`} · Référence : {product?.internalReference || "réservée atomiquement à la création"}</p>
      <p>État attendu : {confirmation?.action === "activate" ? "actif, contenu visible en boutique" : confirmation?.action === "createCatalog" ? product?.isActive ? "produit déjà actif conservé, contenu à confirmer séparément" : "catalogue inactif" : "préparation privée"}</p>
    </div>} warning={confirmation?.action === "activate" ? "Cette confirmation publie le contenu marchand. La fiche publique/PDF reste indépendante. Le stock existant ne sera pas réécrit." : "Aucune activation boutique à cette étape. Le brouillon et les coûts restent privés."} onConfirm={async () => {
      if (!confirmation) return;
      await runSelectionPipeline(item, confirmation.action, confirmation.operationId);
      await onChanged(); await load(); setConfirmation(null);
    }}><button type="button" className="text-sm underline" onClick={() => { setConfirmation(null); onEdit(); }}>Corriger la fiche avant confirmation</button></AdminConfirmDialog>
  </section>;
}
