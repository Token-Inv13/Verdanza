import type { Product } from "../types";

export type CartStockLine = {
  productId: string;
  lineKey?: string;
  quantity: number;
  quantityGrams?: number;
  product: Product;
};

export type CartStockIssue = {
  productId: string;
  lineKey?: string;
  productName: string;
  requestedQuantity: number;
  availableStock: number;
  message: string;
};

export function availableProductStock(product?: Product | null) {
  const stock = Math.floor(Number(product?.stock ?? 0));
  return Number.isFinite(stock) ? Math.max(0, stock) : 0;
}

export function publicProductStockLabel(product?: Product | null) {
  const stock = availableProductStock(product);
  if (!product || product.isActive === false) return "Indisponible";
  if (stock <= 0) return "Rupture de stock";
  return "Disponible";
}

export function isProductOrderable(product?: Product | null) {
  return Boolean(
    product &&
      product.isActive !== false &&
      availableProductStock(product) > 0,
  );
}

export function getCartLineStockIssue(line: CartStockLine): CartStockIssue | null {
  const availableStock = availableProductStock(line.product);
  const requestedQuantity = Math.max(0, Math.floor(Number(line.quantityGrams ?? line.quantity)));

  if (!isProductOrderable(line.product)) {
    return {
      productId: line.productId,
      lineKey: line.lineKey,
      productName: line.product.name,
      requestedQuantity,
      availableStock,
      message: `${line.product.name} : ${publicProductStockLabel(line.product)}.`,
    };
  }

  if (requestedQuantity > availableStock) {
    return {
      productId: line.productId,
      lineKey: line.lineKey,
      productName: line.product.name,
      requestedQuantity,
      availableStock,
      message: `${line.product.name} : stock insuffisant pour la quantit\u00e9 demand\u00e9e.`,
    };
  }

  return null;
}

export function getCartStockIssues(lines: CartStockLine[]) {
  const lineIssues = lines
    .map((line) => getCartLineStockIssue(line))
    .filter((issue): issue is CartStockIssue => Boolean(issue));
  const grouped = new Map<
    string,
    { requestedQuantity: number; availableStock: number; productName: string; lineKey?: string }
  >();
  for (const line of lines) {
    const requestedQuantity = Math.max(0, Math.floor(Number(line.quantityGrams ?? line.quantity)));
    const existing = grouped.get(line.productId);
    if (existing) {
      existing.requestedQuantity += requestedQuantity;
      continue;
    }
    grouped.set(line.productId, {
      requestedQuantity,
      availableStock: availableProductStock(line.product),
      productName: line.product.name,
      lineKey: line.lineKey,
    });
  }
  const aggregateIssues = Array.from(grouped.entries())
    .filter(([, entry]) => entry.requestedQuantity > entry.availableStock)
    .map(([productId, entry]): CartStockIssue => ({
      productId,
      lineKey: entry.lineKey,
      productName: entry.productName,
      requestedQuantity: entry.requestedQuantity,
      availableStock: entry.availableStock,
      message: `${entry.productName} : stock insuffisant pour la quantit\u00e9 totale demand\u00e9e.`,
    }));
  const seen = new Set<string>();
  return [...lineIssues, ...aggregateIssues].filter((issue) => {
    const key = `${issue.productId}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
