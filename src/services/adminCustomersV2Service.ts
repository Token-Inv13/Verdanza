import { getFirebaseIdToken } from "../lib/firebaseAuth";
import type { CustomerMutation } from "../types/adminCustomers";
export class AdminCustomersRequestError extends Error { constructor(readonly code: string, message: string, readonly status: number) { super(message); } }
export async function readAdminCustomers<T>(action: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
  return request<T>(`/api/invoices?${new URLSearchParams({ action, ...params })}`, { method: "GET", signal });
}
const operations = new Map<string, string>();
export async function mutateAdminCustomer(operation: CustomerMutation): Promise<{ revision: number; replayed: boolean }> {
  const key = JSON.stringify(operation); const operationId = operations.get(key) || crypto.randomUUID(); operations.set(key, operationId);
  try { const result = await request<{ revision: number; replayed: boolean }>("/api/invoices", { method: "POST", body: JSON.stringify({ action: "adminCustomerMutate", operation: { ...operation, operationId } }) }); operations.delete(key); return result; }
  catch (error) { if (error instanceof AdminCustomersRequestError && error.status < 500) operations.delete(key); throw error; }
}
async function request<T>(url: string, input: RequestInit): Promise<T> {
  const token = await getFirebaseIdToken(); if (!token) throw new AdminCustomersRequestError("authentication_required", "Session admin requise.", 401);
  const response = await fetch(url, { ...input, cache: "no-store", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
  let body: T & { code?: string; error?: string };
  try { body = await response.json(); } catch { throw new AdminCustomersRequestError("invalid_response", "Réponse clients illisible. Réessayez.", 503); }
  if (!response.ok) throw new AdminCustomersRequestError(body.code || "customers_unavailable", body.error || "Données clients indisponibles.", response.status);
  return body;
}
