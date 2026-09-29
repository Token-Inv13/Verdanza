import { getFirebaseIdToken } from "../lib/firebaseAuth";
import type { ProductSelection } from "../types/selection";
import type { PipelineAction, PipelineContext, PricingPolicy } from "../types/selectionPipeline";

async function selectionRequest<T>(body?: Record<string, unknown>, query = ""): Promise<T> {
  const token = await getFirebaseIdToken();
  if (!token) throw new Error("Connexion administrateur requise.");
  const response = await fetch(`/api/selection${query}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Opération indisponible.");
  return result;
}

export async function listSelections() {
  return selectionRequest<{ selections: ProductSelection[] }>();
}

export async function saveSelection(selection: ProductSelection, operationId = crypto.randomUUID(), imageBase64?: string) {
  return selectionRequest<{ selection: ProductSelection }>({ action: "pipeline", operation: { action: "save", operationId, id: selection.id, expectedRevision: selection.revision || 0, selection, ...(imageBase64 ? { imageBase64 } : {}) } });
}

export async function importSelections(selections: ProductSelection[], operationId = crypto.randomUUID()) {
  return selectionRequest<{ imported: number; skipped: number }>({ action: "import", selections, operationId });
}

export async function extractSelection(url: string) {
  return selectionRequest<{ selection: ProductSelection }>({ action: "extract", url });
}

export async function getSelectionPipeline(id: string, pricing?: { category: "flowers" | "resins"; positioning: "standard" | "premium" }) {
  const suffix = pricing ? `&pricingCategory=${pricing.category}&positioning=${pricing.positioning}` : "";
  return selectionRequest<PipelineContext>(undefined, `?action=pipeline&id=${encodeURIComponent(id)}${suffix}`);
}

export async function runSelectionPipeline(item: ProductSelection, action: Exclude<PipelineAction, "save">, operationId: string) {
  return selectionRequest<{ selection: ProductSelection }>({ action: "pipeline", operation: { action, id: item.id, expectedRevision: item.revision || 0, operationId } });
}

export async function saveSelectionPricingPolicy(policy: PricingPolicy, expectedPolicy: PricingPolicy | null, operationId: string) {
  return selectionRequest<{ policy: PricingPolicy }>({ action: "pipelinePolicy", policy, expectedPolicy, operationId });
}

export async function downloadSelectionPdf(id: string) {
  const token = await getFirebaseIdToken();
  if (!token) throw new Error("Connexion administrateur requise.");
  const response = await fetch(`/api/selection?action=preview&id=${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error || "PDF indisponible.");
  }
  return response.blob();
}

export async function downloadSelectionImage(id: string) {
  const token = await getFirebaseIdToken();
  if (!token) throw new Error("Connexion administrateur requise.");
  const response = await fetch(`/api/selection?action=adminImage&id=${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Image privée indisponible.");
  return response.blob();
}
