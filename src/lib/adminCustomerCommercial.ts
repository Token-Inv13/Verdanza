import type { AdminOrderRow } from "../services/ordersService.js";
import type { CustomerProfile } from "../types/index.js";
import { adminDateValue, formatAdminDate } from "./adminDatePresentation.js";
import { isExactCagnotteProductionFixtureCustomer } from "./cagnotteProductionFixtureIdentity.js";
import { hasOwnProductionFixtureMarker } from "./productionFixtureMarker.js";

export type CustomerComputedStats = {
  orderCount: number;
  totalSpent: number;
  averageCart: number;
  lastOrderAt: number;
  lastOrderLabel: string;
  status: {
    value: NonNullable<CustomerProfile["status"]>;
    label: string;
    tone: "neutral" | "success" | "warning" | "muted" | "gold";
  };
};

export type CommercialCustomerEntry = {
  customer: CustomerProfile;
  orders: AdminOrderRow[];
  stats: CustomerComputedStats;
};

export function commercialAdminCustomers(customers: readonly CustomerProfile[]) {
  return customers.filter((customer) => !isExactCagnotteProductionFixtureCustomer(customer));
}

export function commercialAdminOrders(orders: readonly AdminOrderRow[]) {
  return orders.filter((order) => !hasOwnProductionFixtureMarker(order));
}

export function ordersForCommercialCustomer(
  orders: readonly AdminOrderRow[],
  customer: CustomerProfile,
) {
  const email = customer.email?.toLowerCase();
  const phone = normalizeCustomerPhone(customer.phone);
  const uid = customer.uid || customer.id;
  return commercialAdminOrders(orders).filter((order) => {
    if (order.customerId && uid && order.customerId === uid) return true;
    if (email && order.customerEmail?.toLowerCase() === email) return true;
    if (phone && normalizeCustomerPhone(order.customerPhone) === phone) return true;
    return false;
  });
}

export function commercialCustomerStats(
  customer: CustomerProfile,
  orders: readonly AdminOrderRow[],
): CustomerComputedStats {
  const commercialOrders = commercialAdminOrders(orders);
  const orderCount = Math.max(Number(customer.orderCount || 0), commercialOrders.length);
  const orderTotal = commercialOrders.reduce(
    (sum, order) => sum + parseEuro(order.total),
    0,
  );
  const totalSpent = Math.max(Number(customer.totalSpent || 0), orderTotal);
  const lastOrderAt = commercialOrders.reduce(
    (latest, order) => Math.max(latest, adminDateValue(order.createdAt)),
    0,
  );
  return {
    orderCount,
    totalSpent,
    averageCart: orderCount ? totalSpent / orderCount : 0,
    lastOrderAt,
    lastOrderLabel: lastOrderAt ? formatAdminDate(lastOrderAt) : "Aucune",
    status: commercialCustomerStatus(customer, commercialOrders),
  };
}

export function commercialCustomerStatus(
  customer: CustomerProfile,
  orders: readonly AdminOrderRow[],
): CustomerComputedStats["status"] {
  const commercialOrders = commercialAdminOrders(orders);
  if (customer.archived || customer.status === "archived") {
    return { value: "archived", label: "Archive", tone: "muted" };
  }
  if (customer.status === "watch") {
    return { value: "watch", label: "A suivre", tone: "warning" };
  }
  if (customer.status === "loyal" || Number(customer.orderCount || commercialOrders.length) >= 3) {
    return { value: "loyal", label: "Fidele", tone: "gold" };
  }
  if (
    customer.status === "active" ||
    commercialOrders.length > 0 ||
    Number(customer.orderCount || 0) > 0
  ) {
    return { value: "active", label: "Actif", tone: "success" };
  }
  return { value: "new", label: "Nouveau", tone: "neutral" };
}

export function buildCommercialCustomerEntries(
  customers: readonly CustomerProfile[],
  orders: readonly AdminOrderRow[],
): CommercialCustomerEntry[] {
  const commercialCustomers = commercialAdminCustomers(customers);
  const commercialOrders = commercialAdminOrders(orders);
  return commercialCustomers.map((customer) => {
    const customerOrders = ordersForCommercialCustomer(commercialOrders, customer);
    return {
      customer,
      orders: customerOrders,
      stats: commercialCustomerStats(customer, customerOrders),
    };
  });
}

function normalizeCustomerPhone(value?: string) {
  return value?.replace(/\D/g, "") || "";
}

function parseEuro(value: string) {
  return Number(value.replace("EUR", "").replace(",", ".").trim()) || 0;
}
