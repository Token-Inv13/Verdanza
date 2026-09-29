import type { ProductCategory } from "./index.js";

export const stockReasons = {
  supplier_receipt: "Réception fournisseur",
  inventory_correction: "Correction inventaire",
  damaged_lost: "Produit endommagé/perdu",
  return_to_stock: "Retour en stock",
  internal_use: "Échantillon / utilisation interne",
  other: "Autre",
} as const;
export type StockReason = keyof typeof stockReasons;
export type StockSnapshot = {
  productId: string;
  name: string;
  internalReference: string;
  category: ProductCategory;
  stock: number;
  lowStockThreshold: number;
  isActive: boolean;
};
export type StockAdjustment = {
  operationId: string;
  productId: string;
  expectedStock: number;
  targetStock: number;
  expectedLowStockThreshold: number;
  lowStockThreshold: number;
  reason: StockReason;
  note: string;
};
export type StockOperationResult = {
  status: "applied";
  operationId: string;
  productId: string;
  productName: string;
  beforeStock: number;
  afterStock: number;
  delta: number;
  beforeLowStockThreshold: number;
  afterLowStockThreshold: number;
  reason: StockReason;
  note: string;
  adminUid: string;
  appliedAt: string;
  replayed: boolean;
};
export type StockHistoryEntry = {
  id: string;
  type: string;
  quantity: number;
  note: string;
  createdAt: string;
  createdBy: string;
  beforeStock?: number;
  afterStock?: number;
  operationId?: string;
};
export type StockDetail = { product: StockSnapshot; movements: StockHistoryEntry[] };
export type StockOperationStatus = { status: "applied"; result: StockOperationResult } | { status: "not_executed" };
