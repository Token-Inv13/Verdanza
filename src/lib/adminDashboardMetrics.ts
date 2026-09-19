import type { AdminOrderRow } from "../services/ordersService.js";
import type { AdminMetric, Product } from "../types/index.js";
import { isProductionFixtureOrder } from "./accountingSummary.js";

export type AdminDashboardOrder = Pick<
  AdminOrderRow,
  "paymentStatus" | "orderStatus" | "delivery" | "total" | "productionFixture"
>;

export function buildDashboardMetrics(
  products: Product[],
  orders: AdminDashboardOrder[],
): AdminMetric[] {
  const commercialOrders = orders.filter((order) => !isProductionFixtureOrder(order));
  const activeOrders = commercialOrders.filter((order) => order.orderStatus !== "cancelled");
  const paidOrders = activeOrders.filter((order) => order.paymentStatus === "paid");
  const paymentToConfirm = activeOrders.filter((order) =>
    ["to_confirm", "payment_link_sent", "pending"].includes(order.paymentStatus),
  );
  const preparingOrders = activeOrders.filter((order) =>
    [
      "new",
      "contact_required",
      "confirmed",
      "preparing",
    ].includes(order.orderStatus),
  );
  const deliveryOrders = activeOrders.filter((order) =>
    order.orderStatus === "out_for_delivery",
  );
  const lowStockProducts = products.filter(
    (product) => product.stock <= product.lowStockThreshold,
  );
  const activeProducts = products.filter((product) => product.isActive);
  const totalStock = activeProducts.reduce(
    (sum, product) => sum + Number(product.stock || 0),
    0,
  );

  return [
    {
      label: "Règlements à suivre",
      value: String(paymentToConfirm.length),
      detail: `${paidOrders.length} déjà réglé(s)`,
    },
    {
      label: "À préparer",
      value: String(preparingOrders.length),
      detail: "Nouvelles, à confirmer ou à préparer",
    },
    {
      label: "En livraison",
      value: String(deliveryOrders.length),
      detail: "Commandes en cours de livraison",
    },
    {
      label: "Produits actifs",
      value: String(activeProducts.length),
      detail: "Catalogue public",
    },
    {
      label: "Stock total",
      value: `${totalStock} g`,
      detail: "Produits actifs",
    },
    {
      label: "Stocks bas",
      value: String(lowStockProducts.length),
      detail: "Selon seuil produit",
    },
    {
      label: "Ruptures",
      value: String(products.filter((product) => product.stock <= 0).length),
      detail: "Stock à 0 g",
    },
  ];
}
