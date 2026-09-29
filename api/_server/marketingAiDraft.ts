import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { MarketingAiProvenance } from "../../src/types/marketingAi.js";
import type { MarketingParameters } from "../../src/types/marketing.js";
import { marketingParameterProductIds } from "../../src/lib/marketingAiReferences.js";

export const marketingAiCollection = "marketingAiGenerations";
export class MarketingAiDraftError extends Error {
  constructor(message: string, readonly code: string, readonly status = 409) { super(message); }
}
export async function claimMarketingAiProposal(tx: Transaction, db: Firestore, actorId: string, draftId: string,
  source: { generationId: string; proposalId: string }, kind: string, parameters: MarketingParameters) {
  if (!source || Object.keys(source).some((key) => !["generationId", "proposalId"].includes(key))
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(source.generationId)
    || !/^proposal-[1-3]$/.test(source.proposalId))
    throw new MarketingAiDraftError("Provenance IA invalide.", "ai_source_invalid");
  const ref = db.collection(marketingAiCollection).doc(source.generationId), snap = await tx.get(ref);
  const generation = snap.data();
  const proposal = generation?.proposals?.find((p: { id: string }) => p.id === source.proposalId);
  if (!generation || generation.state !== "completed" || generation.requestedBy !== actorId || !proposal || proposal.kind !== kind)
    throw new MarketingAiDraftError("Proposition IA introuvable ou non autorisée.", "ai_source_invalid", 403);
  if (generation.drafts?.[source.proposalId] && generation.drafts[source.proposalId] !== draftId)
    throw new MarketingAiDraftError("Cette proposition a déjà un brouillon.", "ai_draft_exists");
  const allowedProductIds = generation.allowedProductIds as string[];
  const referencedProductIds = [...new Set<string>([...proposal.referencedProductIds, ...marketingParameterProductIds(parameters)])];
  if (referencedProductIds.some((id) => !allowedProductIds.includes(id)))
    throw new MarketingAiDraftError("Produit hors du contexte autorisé.", "ai_unknown_product");
  const provenance: MarketingAiProvenance = {
    generationId: source.generationId, proposalId: source.proposalId, provider: generation.provider,
    model: generation.model, promptVersion: generation.promptVersion, generatedAt: generation.createdAt,
    requestedBy: generation.requestedBy, allowedProductIds, referencedProductIds,
    ...(generation.providerResponseId ? { providerResponseId: generation.providerResponseId } : {}),
    ...(generation.usage ? { usage: generation.usage } : {})
  };
  return { provenance, ref, drafts: { ...generation.drafts, [source.proposalId]: draftId } };
}
export async function assertMarketingAiProducts(tx: Transaction, db: Firestore, provenance: MarketingAiProvenance, parameters: MarketingParameters) {
  const ids = new Set([...provenance.referencedProductIds, ...marketingParameterProductIds(parameters)]);
  for (const id of ids) {
    if (!provenance.allowedProductIds.includes(id)) throw new MarketingAiDraftError("Produit hors contexte IA.", "ai_unknown_product");
    const product = await tx.get(db.collection("products").doc(id)), data = product.data();
    if (!data || data.isActive !== true || typeof data.stock !== "number" || !Number.isFinite(data.stock) || data.stock <= 0
      || typeof data.price !== "number" || !Number.isFinite(data.price) || data.price <= 0)
      throw new MarketingAiDraftError("Produit IA supprimé, inactif ou indisponible : " + id, "ai_product_unavailable");
  }
}
