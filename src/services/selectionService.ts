import { getFirebaseIdToken } from "../lib/firebaseAuth";
import type { ProductSelection } from "../types/selection";

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

export async function saveSelection(selection: ProductSelection) {
  return selectionRequest<{ selection: ProductSelection }>({ action: "save", selection });
}

export async function importSelections(selections: ProductSelection[]) {
  return selectionRequest<{ imported: number; skipped: number }>({ action: "import", selections });
}

export async function extractSelection(url: string) {
  return selectionRequest<{ selection: ProductSelection }>({ action: "extract", url });
}

export async function uploadSelectionImage(id: string, imageBase64: string) {
  return selectionRequest<{ imagePath: string; updatedAt: string }>({ action: "uploadImage", id, imageBase64 });
}

export async function publishSelection(id: string) {
  return selectionRequest<{ slug: string; pdfUrl: string }>({ action: "publish", id });
}

export async function publishSelectionToCatalog(id: string, catalog: { price: number; stock: number; description: string }) {
  return selectionRequest<{ productId: string; slug: string; category: "flowers" | "resins" }>(
    { action: "publishCatalog", id, catalog },
  );
}

export async function unpublishSelection(id: string) {
  return selectionRequest<{ ok: boolean }>({ action: "unpublish", id });
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
