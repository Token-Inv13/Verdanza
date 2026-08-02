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
  internalReference?: string;
  legacyInternalReferences?: string[];
  slug: string;
  name: string;
  category: ProductCategory;
  price: number;
  compareAtPrice?: number;
  fixedPriceMode?: FixedPriceMode;
  fixedPriceOptions?: FixedPriceOption[];
  shortDescription: string;
  longDescription: string;
  image: string;
  imageAlt?: string;
  images?: ProductImageAsset[];
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
  qualitySealEnabled?: boolean;
  experienceDescription?: string;
  whyChooseDescription?: string;
  advisedProfile?: string;
  stock: number;
  lowStockThreshold: number;
  isActive: boolean;
  isFeatured: boolean;
  seoTitle: string;
  seoDescription: string;
};

export type ProductImageAsset = {
  id: string;
  url: string;
  storagePath?: string;
  alt: string;
  sortOrder: number;
  isPrimary: boolean;
};

export type FixedPriceMode = "automatic" | "manual" | "disabled";

export type FixedPriceOption = {
  id: string;
  label?: string;
  totalPrice: number;
  quantityGrams: number;
  isActive: boolean;
  sortOrder?: number;
  source?: "automatic" | "manual";
  policyVersion?: number;
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
export type PaymentLinkDeliveryIntent = "initial" | "resend";
export type PaymentLinkDeliveryStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "unknown";
export type PaymentLinkDeliverySummary = {
  requestId: string;
  intent: PaymentLinkDeliveryIntent;
  status: PaymentLinkDeliveryStatus;
  channel: "email";
  amount: number;
  currency: "EUR";
  attempts: number;
  createdAt?: string;
  lastAttemptAt?: string;
  completedAt?: string;
  providerId?: string;
  errorCode?: string;
};
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
  estimatedDelayMinMinutes?: number;
  estimatedDelayMaxMinutes?: number;
  slots: string[];
  customerMessage?: string;
  adminNote?: string;
  sortOrder?: number;
  isArchived?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type CouponDiscountType = "percent" | "fixed" | "free_shipping";
export type PromotionRuleType =
  | "fixed_cart_discount"
  | "fixed_category_discount"
  | "threshold_extra_discount"
  | "percentage_cart_discount"
  | "percentage_category_discount"
  | "free_shipping";

export type AppliedPromotion = {
  id: string;
  label: string;
  type: PromotionRuleType;
  applicationMode?: "automatic" | "code";
  discountAmount: number;
  eligibleSubtotal?: number;
  eligibleCategory?: ProductCategory;
  eligibleCategories?: ProductCategory[];
  productIds?: string[];
  couponId?: string;
  couponCode?: string;
  appliedAt?: string;
};

export type Coupon = {
  id: string;
  code: string;
  label: string;
  discountType: CouponDiscountType;
  discountValue: number;
  minimumOrder: number;
  autoApply?: boolean;
  promotionType?: PromotionRuleType;
  eligibleCategory?: ProductCategory;
  minEligibleSubtotal?: number;
  paidThresholdAmount?: number;
  maxGiftAmount?: number;
  maxDiscountAmount?: number;
  stackable?: boolean;
  priority?: number;
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
  archivedAt?: string;
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
  linkedCouponId?: string;
  linkedPromoCode?: string;
  deletedLinkedCouponId?: string;
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
  purchaseMode?: "gram" | "fixed_price";
  fixedPriceOptionId?: string;
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
  productInternalReference?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal?: number;
  purchaseMode?: "gram" | "fixed_price";
  fixedPriceOptionId?: string;
  fixedPriceQuantity?: number;
  fixedPriceTotal?: number;
  fixedPriceGrams?: number;
  slug?: string;
  category?: ProductCategory;
  cultureType?: CultureType;
  purchasePricePerGramSnapshot?: number | null;
  purchaseCostTotalSnapshot?: number | null;
  purchaseCostCapturedAt?: string;
  purchaseCostSource?: "supplier_weighted" | "manual_fallback";
};

export type ProductCost = {
  productId: string;
  purchasePricePerGram?: number | null;
  updatedAt?: string;
  updatedBy?: string;
};

export type SupplierProductAlias = {
  id: string;
  supplierName: string;
  normalizedSupplierName: string;
  originalLabel: string;
  normalizedOriginalLabel: string;
  productId: string;
  productInternalReference?: string;
  productName?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
};

export type SupplierPurchaseStatus = "draft" | "validated" | "cancelled";
export type SupplierPurchaseCostBase = "HT" | "TTC";

export type SupplierPurchaseLine = {
  id: string;
  productId: string;
  productName?: string;
  productInternalReference?: string;
  supplierOriginalLabel?: string;
  matchSource?: "alias" | "internal_reference" | "normalized_name" | "slug_variant" | "manual";
  matchConfidence?: "confirmed" | "suggested" | "ambiguous" | "missing";
  quantityGrams: number;
  grossAmountExVat: number;
  vatRate: number;
  lineDiscountAmount?: number;
  allocatedGlobalDiscount?: number;
  allocatedShipping?: number;
  netCostAmount?: number;
  effectiveCostPerGram?: number;
};

export type SupplierPurchase = {
  id: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  internalReference?: string;
  paidLinesGrossAmountExVat: number;
  globalDiscountExVat: number;
  shippingExVat: number;
  vatRate: number;
  vatAmount?: number;
  totalExVat: number;
  totalIncVat: number;
  costBase: SupplierPurchaseCostBase;
  status: SupplierPurchaseStatus;
  lines: SupplierPurchaseLine[];
  createdAt?: string;
  updatedAt?: string;
  validatedAt?: string;
  sourceFileSha256?: string;
  importedFromPdfAt?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  createdBy?: string;
  updatedBy?: string;
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
  checkoutRequestId?: string;
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
  promotionDiscountTotal?: number;
  appliedPromotions?: AppliedPromotion[];
  subtotalBeforePromotion?: number;
  subtotalAfterPromotion?: number;
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
  paymentLinkDelivery?: PaymentLinkDeliverySummary;
  paymentLinkDeliveryHistory?: PaymentLinkDeliverySummary[];
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
  promotionsRestoredAt?: string;
  restoredPromotionIds?: string[];
  missingPromotionIds?: string[];
  promotionRestoration?: {
    requestedPromotionIds: string[];
    restoredPromotionIds: string[];
    missingPromotionIds: string[];
    alreadyRestoredPromotionIds: string[];
    restoredAt: string;
    restoredByUid: string;
  };
  linkedInvoiceCancellation?: {
    invoiceId: string;
    status: "cancelled" | "already_cancelled" | "missing";
    checkedAt: string;
    changedAt?: string;
    changedByUid: string;
  };
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
  note?: string;
  isGift?: boolean;
  promotionLabel?: string;
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
  appliedPromotions?: AppliedPromotion[];
  total: number;
  paymentMethod?: string;
  paymentStatus: PaymentStatus;
  internalNote?: string;
  issuedAt?: string;
  validatedAt?: string;
  sentAt?: string;
  sentTo?: string;
  archived?: boolean;
  isArchived?: boolean;
  archivedAt?: string;
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
