export type ProductCategory = "flowers" | "resins" | "oils" | "packs";

export type CultureType =
  | "Indoor"
  | "Greenhouse"
  | "Hydroponique"
  | "Sous-serre"
  | "Autre"
  | "A renseigner";

export type Product = {
  id: string;
  slug: string;
  name: string;
  category: ProductCategory;
  price: number;
  compareAtPrice?: number;
  shortDescription: string;
  longDescription: string;
  image: string;
  cbdRate: string;
  cbgRate: string;
  thcRate: string;
  origin: string;
  cultureType: CultureType;
  aromas: string[];
  tags: string[];
  stock: number;
  lowStockThreshold: number;
  isActive: boolean;
  isFeatured: boolean;
  seoTitle: string;
  seoDescription: string;
};

export type DeliveryMethod = "postal" | "local_express";

export type DeliveryZone = {
  id: string;
  name: string;
  method: DeliveryMethod;
  isActive: boolean;
  fee: number;
  minimumOrder: number;
  estimatedDelay: string;
  slots: string[];
};

export type StockMovementType =
  | "manual_add"
  | "sale"
  | "order_cancelled"
  | "return"
  | "loss"
  | "correction"
  | "restock";

export type StockMovement = {
  id: string;
  productId: string;
  productName: string;
  type: StockMovementType;
  quantity: number;
  note?: string;
  createdAt: string;
  createdBy?: string;
  orderId?: string;
  stripeEventId?: string;
};

export type CartItem = {
  productId: string;
  quantity: number;
};

export type Address = {
  firstName: string;
  lastName: string;
  line1: string;
  line2?: string;
  postalCode: string;
  city: string;
  country: string;
};

export type OrderStatus =
  | "pending"
  | "paid"
  | "preparing"
  | "ready"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "refunded";

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export type OrderItem = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
};

export type StatusHistoryEntry = {
  status: OrderStatus;
  previousStatus?: OrderStatus;
  changedAt: string;
  changedBy: "system" | "stripe" | "admin";
  changedByUid?: string;
  note?: string;
};

export type OrderEmails = {
  orderConfirmationSentAt?: string;
  adminNotificationSentAt?: string;
  statusUpdateSentAt?: Partial<Record<OrderStatus, string>>;
  refundNotificationSentAt?: string;
};

export type Order = {
  id: string;
  customerId?: string;
  customerEmail: string;
  customerPhone: string;
  customerName?: string;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  deliveryMethod: DeliveryMethod;
  deliveryAddress: Address;
  deliveryZone?: string;
  deliverySlot?: string;
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
  stripeEventIds?: string[];
  refundId?: string;
  refundedAt?: string;
  statusHistory?: StatusHistoryEntry[];
  emails?: OrderEmails;
  internalNote?: string;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminMetric = {
  label: string;
  value: string;
  detail: string;
};

export type AdminUser = {
  id: string;
  uid?: string;
  email: string;
  role: "admin" | "owner";
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type CustomerProfile = {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  phone: string;
  loyaltyPoints: number;
  orderCount: number;
  totalSpent: number;
  role: "customer";
  createdAt?: string;
  updatedAt?: string;
};

export type SiteSettings = {
  id: string;
  siteName: string;
  supportEmail: string;
  localDeliveryEnabled: boolean;
  postalDeliveryEnabled: boolean;
  maintenanceMode: boolean;
};
