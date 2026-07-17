export type ProductCategory = "flowers" | "resins" | "oils" | "packs";
export type ProductStockStatus = "available" | "coming_soon";

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
  cbnRate?: string;
  thcRate: string;
  origin: string;
  cultureType: CultureType;
  aromas: string[];
  tags: string[];
  texture?: string;
  productTier?: "Premium" | "Ultra premium";
  experienceDescription?: string;
  whyChooseDescription?: string;
  advisedProfile?: string;
  comingSoon?: boolean;
  stockStatus?: ProductStockStatus;
  stockLabel?: string;
  stock: number;
  lowStockThreshold: number;
  isActive: boolean;
  isFeatured: boolean;
  seoTitle: string;
  seoDescription: string;
};

export type ProductFavorite = {
  id: string;
  userId: string;
  productId: string;
  productName: string;
  productCategory: ProductCategory;
  productImage: string;
  createdAt?: unknown;
};

export type ReviewStatus = "pending" | "internal" | "approved" | "rejected";

export type ProductReview = {
  id: string;
  rating: number;
  comment: string;
  productId: string;
  productName: string;
  orderId: string;
  userId: string;
  customerEmail?: string;
  createdAt?: unknown;
  status: ReviewStatus;
  publicVisible: false;
};

export type DeliveryMethod = "postal" | "local_express";
export type DeliveryZoneStatus =
  | "open"
  | "temporarily_closed"
  | "disabled"
  | "coming_soon";
export type OrderType = "order" | "preorder";
export type PaymentProvider =
  | "manual"
  | "bank_transfer"
  | "cash_on_delivery"
  | "future_psp";
export type PreferredPaymentMethod =
  | "card_payment_link"
  | "cash_on_delivery"
  | "bank_transfer"
  | "local_delivery_payment"
  | "confirm_with_verdanza";
export type FinalPaymentMethod =
  | "card_payment_link"
  | "cash_on_delivery"
  | "bank_transfer"
  | "other";
export type PaymentLinkChannel = "email" | "whatsapp" | "sms" | "other";
export type DeliveryFeeStatus = "free" | "to_confirm" | "configured";

export type DeliveryZone = {
  id: string;
  name: string;
  slug?: string;
  method: DeliveryMethod;
  isActive: boolean;
  isOpen?: boolean;
  status?: DeliveryZoneStatus;
  fee: number;
  minimumOrder: number;
  minimumOrderAmount?: number;
  estimatedDelay: string;
  slots: string[];
  customerMessage?: string;
  adminNote?: string;
  sortOrder?: number;
  isArchived?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type CouponDiscountType = "percent" | "fixed" | "free_shipping";

export type Coupon = {
  id: string;
  code: string;
  label: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minimumOrder: number;
  maxUses?: number;
  usedCount: number;
  startsAt?: string;
  endsAt?: string;
  isActive: boolean;
  productIds?: string[];
  categories?: ProductCategory[];
  isArchived?: boolean;
  isTemplate?: boolean;
  internalNote?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type PromoBannerType = "top_bar" | "shop_card" | "checkout_notice" | "modal";
export type PromoBannerPlacement =
  | "home"
  | "shop"
  | "flowers"
  | "resins"
  | "cart"
  | "checkout"
  | "all_public"
  | "draft";
export type PromoBannerVariant = "default" | "promo" | "delivery" | "info" | "warning";

export type PromoBanner = {
  id: string;
  title: string;
  message: string;
  type: PromoBannerType;
  placement: PromoBannerPlacement;
  placements?: PromoBannerPlacement[];
  isActive: boolean;
  startsAt?: string;
  endsAt?: string;
  priority: number;
  buttonLabel?: string;
  buttonUrl?: string;
  linkedPromoCode?: string;
  variant: PromoBannerVariant;
  dismissible: boolean;
  isArchived?: boolean;
  isTemplate?: boolean;
  archivedAt?: string;
  createdAt?: string;
  updatedAt?: string;
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
  | "new"
  | "contact_required"
  | "confirmed"
  | "preparing"
  | "out_for_delivery"
  | "shipped"
  | "delivered"
  | "cancelled";

export type PaymentStatus = "to_confirm" | "payment_link_sent" | "pending" | "paid" | "cancelled";

export type OrderItem = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  slug?: string;
  category?: ProductCategory;
  cultureType?: CultureType;
};

export type OrderAnalyticsPurchaseStatus =
  | "not_eligible"
  | "pending"
  | "sending"
  | "sent"
  | "failed";

export type OrderAnalytics = {
  consentGrantedAtSubmission: boolean;
  consentCapturedAt?: string;
  clientId?: string;
  sessionId?: string;
  consentRevokedAt?: string;
  revocationTokenHash?: string;
  purchaseStatus: OrderAnalyticsPurchaseStatus;
  purchaseAttempts?: number;
  purchaseLastAttemptAt?: string;
  purchaseSentAt?: string;
  purchaseLastErrorCode?: string;
};

export type StatusHistoryEntry = {
  status: OrderStatus;
  previousStatus?: OrderStatus;
  changedAt: string;
  changedBy: "system" | "admin";
  changedByUid?: string;
  note?: string;
};

export type OrderEmails = {
  orderConfirmationSentAt?: string;
  orderConfirmationStatus?: "sent" | "skipped" | "failed";
  orderConfirmationFailedAt?: string;
  orderConfirmationSkippedAt?: string;
  orderConfirmationError?: string;
  orderConfirmationProviderId?: string;
  adminNotificationSentAt?: string;
  adminNotificationStatus?: "sent" | "skipped" | "failed" | "partial";
  adminNotificationFailedAt?: string;
  adminNotificationSkippedAt?: string;
  adminNotificationError?: string;
  adminNotificationProviderId?: string;
  adminNotificationRecipients?: Record<
    string,
    { status: "sent" | "skipped" | "failed"; reason?: string; providerId?: string }
  >;
  lastAttemptedAt?: string;
  statusUpdateSentAt?: Partial<Record<OrderStatus, string>>;
  refundNotificationSentAt?: string;
};

export type OrderAlerts = {
  adminSmsSentAt?: string;
  adminSmsStatus?: "sent" | "skipped" | "failed";
  adminSmsFailedAt?: string;
  adminSmsSkippedAt?: string;
  adminSmsError?: string;
  adminSmsProviderId?: string;
  adminWhatsappSentAt?: string;
  adminWhatsappStatus?: "sent" | "skipped" | "failed";
  adminWhatsappFailedAt?: string;
  adminWhatsappSkippedAt?: string;
  adminWhatsappError?: string;
  adminWhatsappProviderId?: string;
  lastAttemptedAt?: string;
};

export type Order = {
  id: string;
  orderType?: OrderType;
  customerId?: string;
  customerEmail: string;
  customerPhone: string;
  customerName?: string;
  items: OrderItem[];
  subtotal: number;
  subtotalBeforeDiscount?: number;
  deliveryFee: number;
  discountAmount?: number;
  couponCode?: string;
  promoCode?: string;
  promoId?: string;
  discountType?: CouponDiscountType;
  discountValue?: number;
  totalAfterDiscount?: number;
  promoApplied?: boolean;
  total: number;
  paymentProvider?: PaymentProvider;
  paymentStatus: PaymentStatus;
  paymentReference?: string;
  paymentInstructions?: string;
  preferredPaymentMethod?: PreferredPaymentMethod;
  finalPaymentMethod?: FinalPaymentMethod;
  paymentConfirmedAt?: string;
  paymentConfirmedBy?: string;
  paymentLinkUrl?: string;
  paymentLinkLabel?: string;
  paymentLinkAmount?: number;
  paymentLinkCurrency?: "EUR";
  paymentLinkSent?: boolean;
  paymentLinkSentAt?: string;
  paymentLinkSentBy?: string;
  paymentLinkChannel?: PaymentLinkChannel;
  customerMessage?: string;
  orderStatus: OrderStatus;
  deliveryMethod: DeliveryMethod;
  deliveryAddress: Address;
  deliveryZone?: string;
  deliverySlot?: string;
  deliveryMinimumApplied?: number;
  postalFreeShippingApplied?: boolean;
  deliveryFeeStatus?: DeliveryFeeStatus;
  deliveryNote?: string;
  trackingNumber?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  statusHistory?: StatusHistoryEntry[];
  emails?: OrderEmails;
  alerts?: OrderAlerts;
  analytics?: OrderAnalytics;
  internalNote?: string;
  archived?: boolean;
  hidden?: boolean;
  archivedAt?: string;
  archivedBy?: string;
  hiddenAt?: string;
  hiddenBy?: string;
  deletedAt?: string;
  deletedBy?: string;
  paidAt?: string;
  cancelledAt?: string;
  stockRestoredAt?: string;
  couponRestoredAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceStatus =
  | "draft"
  | "validated"
  | "sent"
  | "paid"
  | "cancelled"
  | "credit_note_issued";

export type VatMode = "not_configured" | "vat_exempt" | "vat_applicable" | "other";

export type InvoiceLine = {
  id: string;
  label: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type BillingSettings = {
  id: "billing";
  tradeName: string;
  displayName: string;
  legalName?: string;
  legalForm?: string;
  siren?: string;
  siret?: string;
  vatMode: VatMode;
  vatNumber?: string;
  vatMention?: string;
  address?: string;
  phone: string;
  email: string;
  paymentTerms?: string;
  legalMentions?: string;
  logoUrl?: string;
  isManuallyValidated: boolean;
  validationWarning: string;
  updatedAt?: string;
};

export type Invoice = {
  id: string;
  invoiceNumber: string;
  orderId?: string;
  origin: "order" | "manual";
  status: InvoiceStatus;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: Address;
  lines: InvoiceLine[];
  subtotal: number;
  deliveryFee: number;
  discountAmount: number;
  total: number;
  paymentMethod?: string;
  paymentStatus: PaymentStatus;
  internalNote?: string;
  issuedAt?: string;
  validatedAt?: string;
  sentAt?: string;
  sentTo?: string;
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
  internalNote?: string;
  status?: "new" | "active" | "loyal" | "watch" | "archived";
  archived?: boolean;
  hidden?: boolean;
  archivedAt?: string;
  hiddenAt?: string;
  assignedPromos?: CustomerAssignedPromo[];
  loyaltyHistory?: CustomerLoyaltyHistoryEntry[];
  internalNotes?: CustomerInternalNote[];
  role: "customer";
  createdAt?: string;
  updatedAt?: string;
};

export type CustomerAssignedPromo = {
  code: string;
  couponId?: string;
  label?: string;
  note?: string;
  isActive: boolean;
  assignedAt?: string;
  assignedBy?: string;
};

export type CustomerLoyaltyHistoryEntry = {
  type: "add" | "remove" | "set";
  points: number;
  previousBalance: number;
  nextBalance: number;
  reason: string;
  note?: string;
  createdAt?: string;
  createdBy?: string;
};

export type CustomerInternalNote = {
  note: string;
  isImportant?: boolean;
  createdAt?: string;
  createdBy?: string;
};

export type LoyaltyMovement = {
  id: string;
  customerId: string;
  customerEmail?: string;
  points: number;
  reason: "order_paid" | "admin_adjustment" | "reward_redeemed";
  note?: string;
  orderId?: string;
  createdAt?: string;
  createdBy?: string;
};

export type SiteSettings = {
  id: string;
  siteName: string;
  supportEmail: string;
  localDeliveryEnabled: boolean;
  postalDeliveryEnabled: boolean;
  maintenanceMode: boolean;
};
