import type { Product } from "../types";

export type CartStockLine = {
  productId: string;
  quantity: number;
  product: Product;
};

export type CartStockIssue = {
  productId: string;
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

  if (!isProductOrderable(line.product)) {
    return {
      productId: line.productId,
      productName: line.product.name,
      requestedQuantity: line.quantity,
      availableStock,
      message: `${line.product.name} : ${publicProductStockLabel(line.product)}.`,
    };
  }

  if (line.quantity > availableStock) {
    return {
      productId: line.productId,
      productName: line.product.name,
      requestedQuantity: line.quantity,
      availableStock,
      message: `${line.product.name} : stock insuffisant pour la quantit\u00e9 demand\u00e9e.`,
    };
  }

  return null;
}

export function getCartStockIssues(lines: CartStockLine[]) {
  return lines
    .map((line) => getCartLineStockIssue(line))
    .filter((issue): issue is CartStockIssue => Boolean(issue));
}
