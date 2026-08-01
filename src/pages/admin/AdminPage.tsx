import { FormEvent, useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useAdminData } from "../../hooks/useAdminData";
import {
  deleteProductAdmin,
  updateProductFlags,
  updateProductStock,
  upsertProduct,
  type ProductInput,
} from "../../services/productsService";
import {
  deleteProductImageByPath,
  uploadProductImageAsset,
  type ProductImageUploadProgress,
} from "../../services/productImagesService";
import {
  deleteCancelledOrder,
  retryOrderEmails,
  retryOrderPurchaseAnalytics,
  updateOrderAdminFields,
  type AdminOrderRow,
  type RetryOrderEmailTarget,
} from "../../services/ordersService";
import {
  createDeliveryZoneAdmin,
  deleteDeliveryZoneAdmin,
  updateDeliveryZoneAdmin,
  type DeliveryZoneAdminInput,
} from "../../services/deliveryZonesService";
import {
  archiveCoupon,
  deleteCouponAndNeutralizeBannerLinks,
  normalizeCouponCode,
  updateCouponStatus,
  upsertCoupon,
  type CouponInput,
} from "../../services/couponsService";
import {
  archivePromoBanner,
  associatedPromoBannerId,
  deletePromoBanner,
  findAssociatedPromoBanner,
  getBannerPlacements,
  promoBannerVisibility,
  promoBannerStatus,
  updatePromoBannerStatus,
  upsertAssociatedPromoBanner,
  upsertPromoBanner,
  type PromoBannerInput,
} from "../../services/promoBannersService";
import {
  adjustCustomerLoyalty,
  assignPromoToCustomer,
  getCustomerAdminDetails,
  updateCustomerAdminStatus,
  updateCustomerInternalNote,
  type CustomerAdminDetails,
} from "../../services/adminCustomersService";
import {
  createInvoiceFromOrder,
  createManualInvoice,
  downloadInvoicePdf,
  saveBillingSettings,
  sendInvoiceEmail,
  updateInvoiceStatus,
  type ManualInvoiceInput,
} from "../../services/invoicesService";
import { getAdminAnalytics } from "../../services/adminAnalyticsService";
import {
  visibleAdminCoupons,
  visibleAdminInvoices,
  visibleAdminPromoBanners,
} from "../../lib/adminArchives";
import { saveProductCostAdmin } from "../../services/productCostsService";
import {
  analyzeSupplierInvoicePdfAdmin,
  cancelSupplierPurchaseAdmin,
  deleteSupplierPurchaseAdmin,
  saveSupplierProductAliasAdmin,
  saveSupplierPurchaseAdmin,
  type SupplierInvoiceAnalysisResult,
} from "../../services/supplierPurchasesService";
import {
  getAdminPaymentLinks,
  sendOrderPaymentLinkEmail,
  type AdminPaymentLink,
} from "../../services/paymentLinksService";
import {
  getAdminFavoriteStats,
  type FavoriteProductStat,
} from "../../services/favoritesService";
import {
  getAdminProductReviews,
  updateReviewStatus,
} from "../../services/reviewsService";
import type {
  AdminMetric,
  BillingSettings,
  Coupon,
  CustomerProfile,
  DeliveryZone,
  DeliveryZoneStatus,
  FinalPaymentMethod,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  OrderStatus,
  OrderAnalytics,
  PaymentProvider,
  PreferredPaymentMethod,
  PaymentLinkChannel,
  PaymentStatus,
  Product,
  ProductCategory,
  ProductImageAsset,
  ProductCost,
  FixedPriceMode,
  FixedPriceOption,
  PromoBanner,
  PromoBannerPlacement,
  PromoBannerType,
  PromoBannerVariant,
  PromotionRuleType,
  SupplierPurchase,
  SupplierPurchaseLine,
  ProductReview,
  ProductFavorite,
  LoyaltyMovement,
  ReviewStatus,
  StatusHistoryEntry,
} from "../../types";
import type {
  AdminAnalyticsContentRow,
  AdminAnalyticsDeliveryRow,
  AdminAnalyticsDeviceRow,
  AdminAnalyticsFunnelStep,
  AdminAnalyticsNamedRow,
  AdminAnalyticsPageRow,
  AdminAnalyticsPreset,
  AdminAnalyticsProductRow,
  AdminAnalyticsResponse,
} from "../../types/adminAnalytics";
import {
  orderStatusLabel,
  paymentProviderLabel,
  paymentStatusLabel,
} from "../../utils/orderStatus";
import {
  LOCAL_DELIVERY_MINIMUM,
  POSTAL_DELIVERY_MINIMUM,
  POSTAL_FREE_SHIPPING_THRESHOLD,
} from "../../config/deliveryRules";
import { BRAND_LABEL } from "../../lib/brandAssets";
import {
  computeWeightedSupplierCosts,
  estimateStockValue,
  normalizeSupplierPurchaseInput,
  resolveOrderItemPurchaseCost,
  type WeightedSupplierCost,
} from "../../lib/accountingCosts";
import { formatLocalDeliveryEstimate } from "../../lib/deliveryEstimate";
import {
  orderItemLineTotal,
  orderItemQuantityLabel,
} from "../../lib/orderLineDisplay";
import {
  FIXED_PRICE_POLICY_VERSION,
  fixedPriceOptionsForMode,
  fixedPriceEffectiveUnitPrice,
  fixedPriceOptionLabel,
  isFixedPriceAdvantageous,
  normalizeFixedPriceMode,
  resolveFixedPriceOptions,
  validateManualFixedPriceOptions,
} from "../../lib/fixedPriceOptions";
import {
  PRODUCT_IMAGE_MAX_COUNT,
  ensureSinglePrimary,
  normalizeProductImages,
  syncProductPrimaryImage,
  validateProductImagesForProduct,
} from "../../lib/productImages";

const emptyProduct: ProductInput = {
  slug: "",
  name: "",
  category: "flowers",
  price: 0,
  fixedPriceMode: "automatic",
  fixedPriceOptions: [],
  shortDescription: "",
  longDescription: "",
  image: BRAND_LABEL,
  cbdRate: "A renseigner",
  cbgRate: "A renseigner",
  thcRate: "< 0,3 %",
  origin: "A renseigner",
  cultureType: "A renseigner",
  aromas: [],
  tags: [],
  stock: 0,
  lowStockThreshold: 5,
  qualitySealEnabled: false,
  isActive: true,
  isFeatured: false,
  seoTitle: "",
  seoDescription: "",
};

const emptyCoupon: CouponInput = {
  code: "",
  label: "",
  discountType: "percent",
  discountValue: 10,
  minimumOrder: 0,
  autoApply: false,
  promotionType: "percentage_cart_discount",
  eligibleCategory: undefined,
  minEligibleSubtotal: 0,
  paidThresholdAmount: 0,
  maxGiftAmount: 0,
  maxDiscountAmount: undefined,
  stackable: false,
  priority: 10,
  usedCount: 0,
  isActive: true,
  productIds: [],
  categories: [],
};

const emptyPromoBanner: PromoBannerInput = {
  title: "",
  message: "",
  type: "shop_card",
  placement: "draft",
  placements: ["draft"],
  isActive: false,
  startsAt: "",
  endsAt: "",
  priority: 10,
  buttonLabel: "",
  buttonUrl: "",
  linkedCouponId: "",
  linkedPromoCode: "",
  deletedLinkedCouponId: "",
  variant: "default",
  dismissible: false,
  isArchived: false,
};

const paymentStatusOptions: PaymentStatus[] = [
  "to_confirm",
  "payment_link_sent",
  "pending",
  "paid",
  "cancelled",
];

const finalPaymentMethodOptions: FinalPaymentMethod[] = [
  "card_payment_link",
  "cash_on_delivery",
  "bank_transfer",
  "other",
];

export function AdminPage({ section }: { section: string }) {
  const {
    products,
    productSource,
    orders,
    orderSource,
    deliveryZones,
    deliverySource,
    coupons,
    couponSource,
    promoBanners,
    promoBannerSource,
    customers,
    customerSource,
    invoices,
    invoiceSource,
    billingSettings,
    billingSource,
    productCosts,
    productCostsSource,
    productCostsError,
    supplierPurchases,
    supplierPurchasesSource,
    supplierPurchasesError,
    isLoading,
    refresh,
  } = useAdminData();
  const [searchParams] = useSearchParams();
  const messageScope =
    section === "Comptabilité"
      ? `${section}:${normalizeAccountingTab(searchParams.get("tab"))}`
      : section;
  const [messageState, setMessageState] = useState({ text: "", scope: messageScope });
  const message = messageState.scope === messageScope ? messageState.text : "";
  const [editingProduct, setEditingProduct] = useState<ProductInput>(emptyProduct);
  const [productImageStoragePathsToDelete, setProductImageStoragePathsToDelete] = useState<string[]>([]);
  const [editingCoupon, setEditingCoupon] = useState<CouponInput>(emptyCoupon);
  const [couponBannerAction, setCouponBannerAction] = useState<"none" | "create" | "link">("none");
  const [couponBannerTargetId, setCouponBannerTargetId] = useState("");
  const [editingPromoBanner, setEditingPromoBanner] =
    useState<PromoBannerInput>(emptyPromoBanner);
  const [editingBilling, setEditingBilling] = useState<BillingSettings>(billingSettings);

  useEffect(() => {
    setEditingBilling(billingSettings);
  }, [billingSettings]);

  useEffect(() => {
    setMessageState({ text: "", scope: messageScope });
  }, [messageScope]);

  useEffect(() => {
    if (!message) return undefined;
    const timeoutId = window.setTimeout(() => {
      setMessageState((current) =>
        current.scope === messageScope && current.text === message
          ? { text: "", scope: messageScope }
          : current,
      );
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [message, messageScope]);

  const visibleCoupons = useMemo(() => visibleAdminCoupons(coupons), [coupons]);
  const visiblePromoBanners = useMemo(
    () => visibleAdminPromoBanners(promoBanners),
    [promoBanners],
  );
  const visibleInvoices = useMemo(() => visibleAdminInvoices(invoices), [invoices]);
  const lowStockProducts = useMemo(
    () => products.filter((product) => product.stock <= product.lowStockThreshold),
    [products],
  );
  const dashboardMetrics = useMemo(
    () => buildDashboardMetrics(products, orders),
    [orders, products],
  );

  function setMessage(text: string) {
    setMessageState({ text, scope: messageScope });
  }

  function editProduct(product: Product) {
    setProductImageStoragePathsToDelete([]);
    setEditingProduct(product);
  }

  function resetProductForm() {
    setProductImageStoragePathsToDelete([]);
    setEditingProduct(emptyProduct);
  }

  function editCoupon(coupon: CouponInput) {
    setEditingCoupon(coupon);
    const associatedBanner = findAssociatedPromoBanner(promoBanners, coupon);
    if (associatedBanner) {
      setCouponBannerAction("link");
      setCouponBannerTargetId(associatedBanner.id);
      return;
    }
    setCouponBannerAction("none");
    setCouponBannerTargetId("");
  }

  async function handleDeleteCancelledOrder(orderId: string) {
    setMessage("");
    try {
      await deleteCancelledOrder(orderId);
      setMessage(`Commande ${orderId} supprimee definitivement.`);
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Suppression commande impossible.",
      );
    }
  }

  async function handleProductSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const fixedPriceMode = normalizeFixedPriceMode(
      editingProduct.fixedPriceMode,
      editingProduct.category,
    );
    const fixedPriceOptions = fixedPriceOptionsForMode(
      fixedPriceMode,
      editingProduct.fixedPriceOptions,
    );
    const manualIssues = validateManualFixedPriceOptions({
      ...editingProduct,
      fixedPriceMode,
      fixedPriceOptions,
    } as Product);
    const blockingManualIssues = manualIssues.filter((issue) => issue.severity === "error");
    if (blockingManualIssues.length > 0) {
      setMessage(`Formats prix fixe invalides : ${blockingManualIssues[0].message}`);
      return;
    }
    const productToSave = syncProductPrimaryImage({
      ...editingProduct,
      slug: editingProduct.slug || slugify(editingProduct.name),
      aromas: normalizeList(editingProduct.aromas),
      tags: normalizeList(editingProduct.tags),
      fixedPriceMode,
      fixedPriceOptions,
    });
    const productId = productToSave.id || productToSave.slug;
    const imageValidation = validateProductImagesForProduct(productId || "", productToSave.images || []);
    if (!imageValidation.ok) {
      setMessage(imageValidation.errors[0]);
      return;
    }
    const savedProductId = await upsertProduct(productToSave);
    const pathsToDelete = productImageStoragePathsToDelete.slice();
    if (pathsToDelete.length) {
      await Promise.allSettled(
        pathsToDelete.map((path) => deleteProductImageByPath(path, savedProductId)),
      );
    }
    resetProductForm();
    setMessage("Produit enregistre.");
    await refresh();
  }

  async function handleProductDelete(product: ProductInput, confirmationReference: string) {
    setMessage("");
    if (!product.id) {
      setMessage("Produit non enregistre: aucune suppression definitive possible.");
      return;
    }
    try {
      const result = await deleteProductAdmin({
        productId: product.id,
        confirmationReference,
      });
      resetProductForm();
      const storageWarning = result.storage?.failed?.length
        ? ` Nettoyage Storage partiel: ${result.storage.failed.length} fichier(s) non supprime(s).`
        : "";
      setMessage(`Produit ${product.name} supprime definitivement.${storageWarning}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Suppression produit impossible.");
    }
  }

  async function handleFlagChange(product: Product, key: "isActive" | "isFeatured") {
    const flags = {
      isActive: key === "isActive" ? !product.isActive : product.isActive,
      isFeatured: key === "isFeatured" ? !product.isFeatured : product.isFeatured,
    };
    if (productSource === "local") {
      await upsertProduct({ ...product, ...flags });
    } else {
      await updateProductFlags(product.id, flags);
    }
    await refresh();
  }

  async function handleStockChange(product: Product, stock: number, threshold: number) {
    if (productSource === "local") {
      await upsertProduct({ ...product, stock, lowStockThreshold: threshold });
    } else {
      await updateProductStock(product.id, stock, threshold);
    }
    await refresh();
  }

  async function handleDeliveryZoneSave(
    zone: DeliveryZone,
    data: DeliveryZoneAdminInput,
  ) {
    await updateDeliveryZoneAdmin(zone.id, data);
    setMessage(`Zone ${zone.name} mise a jour.`);
    await refresh();
  }

  async function handleDeliveryZoneCreate(data: DeliveryZoneAdminInput) {
    const zoneId = await createDeliveryZoneAdmin(data);
    setMessage(`Zone ${data.name} creee (${zoneId}).`);
    await refresh();
  }

  async function handleDeliveryZoneDelete(zone: DeliveryZone) {
    const confirmed = window.confirm(
      `Suppression definitive de la zone ${zone.name} (${zone.id}). Cette action est irreversible. Les commandes existantes ne seront pas modifiees. Confirmer ?`,
    );
    if (!confirmed) return;
    await deleteDeliveryZoneAdmin(zone.id);
    setMessage(`Zone ${zone.name} supprimee.`);
    await refresh();
  }

  async function handleCouponSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const couponPayload = {
        ...editingCoupon,
        productIds: normalizeList(editingCoupon.productIds ?? []),
        categories: normalizeList(editingCoupon.categories ?? []) as ProductCategory[],
      };
      await upsertCoupon(couponPayload);
      const couponCode = normalizeCouponCode(couponPayload.code);
      const couponId = couponPayload.id || couponCode.toLowerCase();
      const savedCoupon = {
        ...couponPayload,
        id: couponId,
        code: couponCode,
        usedCount: Number(couponPayload.usedCount || 0),
        isActive: Boolean(couponPayload.isActive),
      } as Coupon;
      let bannerWarning = "";
      try {
        if (couponBannerAction === "create") {
          await upsertAssociatedPromoBanner({
            coupon: savedCoupon,
            banners: promoBanners,
            title: couponPayload.label || couponCode,
            message: couponDescription(savedCoupon),
          });
        }
        if (couponBannerAction === "link" && couponBannerTargetId) {
          const target = promoBanners.find((banner) => banner.id === couponBannerTargetId);
          if (target) {
            const targetIsAssociatedBanner =
              target.id === associatedPromoBannerId(couponId) ||
              target.linkedCouponId === couponId ||
              normalizeCouponCode(target.linkedPromoCode || "") === couponCode;
            await upsertPromoBanner({
              ...target,
              message: targetIsAssociatedBanner ? couponDescription(savedCoupon) : target.message,
              linkedCouponId: couponId,
              linkedPromoCode: couponCode,
              deletedLinkedCouponId: "",
            });
          }
        }
      } catch (bannerError) {
        console.warn("Unable to update associated promotion banner", bannerError);
        bannerWarning =
          bannerError instanceof Error
            ? ` Association banniere non mise a jour : ${bannerError.message}`
            : " Association banniere non mise a jour.";
      }
      setEditingCoupon(emptyCoupon);
      setCouponBannerAction("none");
      setCouponBannerTargetId("");
      setMessage(`Code promo enregistre.${bannerWarning}`);
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Erreur enregistrement promotion : ${error.message}`
          : "Erreur enregistrement promotion.",
      );
    }
  }

  async function handleCouponToggle(coupon: Coupon) {
    await updateCouponStatus(coupon.id, !coupon.isActive);
    await refresh();
  }

  async function handleCouponArchive(coupon: Coupon) {
    const confirmed = window.confirm(
      "Cette action archive le code promo. Il restera consultable mais ne devra plus etre utilise.",
    );
    if (!confirmed) return;
    await archiveCoupon(coupon.id);
    setMessage(`Code promo ${coupon.code} archive.`);
    await refresh();
  }

  async function handleCouponDelete(coupon: Coupon) {
    const confirmed = window.confirm(
      `Suppression definitive de la promotion ${coupon.label || coupon.code} (${coupon.id}). Cette action est irreversible. Les commandes et factures existantes ne seront pas modifiees. Confirmer ?`,
    );
    if (!confirmed) return;
    await deleteCouponAndNeutralizeBannerLinks(coupon);
    setEditingCoupon(emptyCoupon);
    setMessage(`Promotion ${coupon.label || coupon.code} supprimee definitivement.`);
    await refresh();
  }

  async function handlePromoBannerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await upsertPromoBanner(editingPromoBanner);
      setEditingPromoBanner(emptyPromoBanner);
      setMessage("Banniere enregistree.");
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Erreur enregistrement banniere : ${error.message}`
          : "Erreur enregistrement banniere.",
      );
    }
  }

  async function handlePromoBannerToggle(banner: PromoBanner) {
    await updatePromoBannerStatus(banner.id, !banner.isActive);
    await refresh();
  }

  async function handlePromoBannerArchive(banner: PromoBanner) {
    const confirmed = window.confirm(
      "Cette action archive la banniere. Elle ne sera plus visible cote client.",
    );
    if (!confirmed) return;
    await archivePromoBanner(banner.id);
    setMessage(`Banniere ${banner.title} archivee.`);
    await refresh();
  }

  async function handlePromoBannerDelete(banner: PromoBanner) {
    const confirmed = window.confirm(
      `Suppression definitive de la banniere ${banner.title} (${banner.id}). Cette action est irreversible. La promotion liee ne sera pas supprimee. Confirmer ?`,
    );
    if (!confirmed) return;
    await deletePromoBanner(banner.id);
    setEditingPromoBanner(emptyPromoBanner);
    setMessage(`Banniere ${banner.title} supprimee definitivement.`);
    await refresh();
  }

  async function handleLoyaltyAdjustment(customer: CustomerProfile) {
    const modeInput = window.prompt(
      "Action points : add pour ajouter, remove pour retirer, set pour definir",
      "add",
    );
    const mode = modeInput === "remove" || modeInput === "set" ? modeInput : "add";
    const rawPoints = window.prompt(
      mode === "set" ? "Nouveau solde de points" : "Nombre de points",
      "0",
    );
    const points = Number(rawPoints);
    if (!Number.isFinite(points) || points < 0 || (mode !== "set" && points === 0)) return;
    const reason = window.prompt("Raison", "correction manuelle") || "correction manuelle";
    const note = window.prompt("Note interne", "") || "";
    const signedPoints = mode === "remove" ? -points : points;
    await adjustCustomerLoyalty(customer, signedPoints, note, mode, reason);
    setMessage("Points fidelite mis a jour.");
    await refresh();
  }

  async function handleCustomerPromoAssignment(customer: CustomerProfile, couponId: string, note: string) {
    const coupon = coupons.find((entry) => entry.id === couponId);
    if (!coupon) {
      setMessage("Code promo introuvable.");
      return;
    }
    await assignPromoToCustomer(customer, coupon, note);
    setMessage(`Code ${coupon.code} attribue a ${customer.displayName || customer.email || "ce client"}.`);
    await refresh();
  }

  async function handleCustomerStatusUpdate(
    customer: CustomerProfile,
    data: { status?: CustomerProfile["status"]; archived?: boolean; hidden?: boolean },
  ) {
    await updateCustomerAdminStatus(customer.id, data);
    setMessage("Fiche client mise a jour.");
    await refresh();
  }

  async function handleProductCostSave(productId: string, purchasePricePerGram: number | null) {
    await saveProductCostAdmin(productId, purchasePricePerGram);
    setMessage("Cout d'achat produit enregistre.");
    await refresh();
  }

  async function handleSupplierPurchaseSave(purchase: Partial<SupplierPurchase>) {
    const purchaseId = await saveSupplierPurchaseAdmin(purchase);
    setMessage(`Achat fournisseur enregistre (${purchaseId}).`);
    await refresh();
  }

  async function handleSupplierAliasSave(alias: { supplierName: string; originalLabel: string; productId: string }) {
    await saveSupplierProductAliasAdmin(alias);
    setMessage("Correspondance fournisseur memorisee.");
    await refresh();
  }

  async function handleSupplierPurchaseDelete(purchase: SupplierPurchase) {
    const confirmed = window.confirm(
      `Suppression definitive de l'achat fournisseur ${purchase.invoiceNumber || purchase.id}. Cette action est irreversible. Confirmer ?`,
    );
    if (!confirmed) return;
    await deleteSupplierPurchaseAdmin(purchase.id);
    setMessage("Achat fournisseur supprime.");
    await refresh();
  }

  async function handleSupplierPurchaseCancel(purchase: SupplierPurchase) {
    const confirmed = window.confirm(
      `Annuler l'achat fournisseur valide ${purchase.invoiceNumber || purchase.id} ? Il sera conserve mais exclu des couts et marges.`,
    );
    if (!confirmed) return;
    await cancelSupplierPurchaseAdmin(purchase.id);
    setMessage("Achat fournisseur annule.");
    await refresh();
  }

  async function handleManualInvoiceCreate(input: ManualInvoiceInput) {
    const result = await createManualInvoice(input);
    setMessage(`Facture brouillon ${result.invoiceNumber} creee.`);
    await refresh();
  }

  async function handleInvoiceStatusUpdate(invoice: Invoice, status: InvoiceStatus) {
    await updateInvoiceStatus(invoice.id, status);
    setMessage(`Facture ${invoice.invoiceNumber} mise a jour.`);
    await refresh();
  }

  async function handleInvoiceDownload(invoice: Invoice) {
    await downloadInvoicePdf(invoice.id, invoice.invoiceNumber);
  }

  async function handleInvoiceSend(invoice: Invoice) {
    if (!billingSettings.isManuallyValidated) {
      const confirmed = window.confirm(billingSettings.validationWarning);
      if (!confirmed) return;
    }
    await sendInvoiceEmail(invoice.id);
    setMessage(`Facture ${invoice.invoiceNumber} envoyee.`);
    await refresh();
  }

  async function handleBillingSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveBillingSettings(editingBilling);
    setMessage("Paramètres de facturation enregistrés.");
    await refresh();
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-forest/10 bg-ivory px-4 py-5 shadow-sm sm:px-6 md:flex-row md:items-end">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-champagne">
            Verdanza
          </p>
          <h1 className="font-display text-4xl leading-none text-forest sm:text-5xl">
            {section}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <button className="btn-secondary" onClick={() => void refresh()}>
            Rafraichir
          </button>
        </div>
      </div>

      {message && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-md border border-champagne/30 bg-cream px-4 py-3 text-sm text-forest">
          <p>{message}</p>
          <button
            type="button"
            className="text-xs font-semibold uppercase tracking-[0.12em] text-forest/60 hover:text-forest"
            onClick={() => setMessage("")}
          >
            Fermer
          </button>
        </div>
      )}

      {isLoading && <p className="mt-8 text-forest/70">Chargement des donnees...</p>}

      {section === "Dashboard" && (
        <>
          <section className="mt-6">
            <p className="text-xs uppercase tracking-[0.18em] text-champagne">
              Vue rapide
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {dashboardMetrics.map((metric) => (
              <article
                key={metric.label}
                className="admin-card min-h-32 border-forest/10 bg-ivory/95"
              >
                <p className="text-sm text-ink/55">{metric.label}</p>
                <strong className="mt-2 block font-display text-4xl text-forest">
                  {metric.value}
                </strong>
                <span className="text-xs text-ink/50">{metric.detail}</span>
              </article>
            ))}
            </div>
          </section>
          <section className="mt-6 grid gap-3 md:grid-cols-3">
            <SourceCard label="Produits" value={productSource} count={products.length} />
            <SourceCard label="Commandes" value={orderSource} count={orders.length} />
            <SourceCard
              label="Zones livraison"
              value={deliverySource}
              count={deliveryZones.length}
            />
          </section>
          <AdminOrders
            orders={orders}
            orderSource={orderSource}
            onRefresh={refresh}
            onDelete={async (orderId) => {
              if (orderSource !== "firestore") {
                setMessage("Aucune commande supprimable.");
                return;
              }
              await handleDeleteCancelledOrder(orderId);
            }}
            onUpdate={async (orderId, data) => {
              if (orderSource !== "firestore") {
                setMessage("Aucune commande modifiable.");
                return;
              }
              await updateOrderAdminFields(orderId, data);
              await refresh();
            }}
          />
        </>
      )}

      {section === "Analytics" && <AdminAnalyticsPanel />}

      {section === "Produits" && (
        <div className="mt-8 grid gap-6 xl:grid-cols-[420px_1fr]">
          <ProductForm
            product={editingProduct}
            onChange={setEditingProduct}
            onSubmit={handleProductSubmit}
            onImageStoragePathRemoved={(path) =>
              setProductImageStoragePathsToDelete((current) =>
                current.includes(path) ? current : [...current, path],
              )
            }
            onDeleteProduct={handleProductDelete}
          />
          <section>
            <SourceLine source={productSource} />
            <ProductTable
              products={products}
              onEdit={editProduct}
              onFlagChange={handleFlagChange}
            />
          </section>
        </div>
      )}

      {section === "Stocks" && (
        <>
          <SourceLine source={productSource} />
          <StockTable products={products} onStockChange={handleStockChange} />
          <section className="mt-8 grid gap-4 md:grid-cols-2">
            {lowStockProducts.map((product) => (
              <article key={product.id} className="admin-card border-champagne/40">
                <h2 className="font-display text-3xl text-forest">{product.name}</h2>
                <p className="mt-2 text-sm text-ink/60">
                  Stock {product.stock} g, seuil {product.lowStockThreshold} g.
                </p>
              </article>
            ))}
          </section>
        </>
      )}

      {section === "Commandes" && (
        <>
          <SourceLine source={orderSource} />
          <AdminOrders
            orders={orders}
            invoices={visibleInvoices}
            orderSource={orderSource}
            onRefresh={refresh}
            onDelete={async (orderId) => {
              if (orderSource !== "firestore") {
                setMessage("Aucune commande supprimable.");
                return;
              }
              await handleDeleteCancelledOrder(orderId);
            }}
            onCreateInvoice={async (orderId) => {
              const result = await createInvoiceFromOrder(orderId);
              setMessage(`Facture brouillon ${result.invoiceNumber} creee.`);
              await refresh();
            }}
            onUpdate={async (orderId, data) => {
              if (orderSource !== "firestore") {
                setMessage("Aucune commande modifiable.");
                return;
              }
              await updateOrderAdminFields(orderId, data);
              await refresh();
            }}
          />
        </>
      )}

      {section === "Livraisons locales" && (
        <>
          <SourceLine source={deliverySource} />
          <DeliveryRulesSummary />
          <DeliveryZonesPanel
            zones={deliveryZones}
            onSave={handleDeliveryZoneSave}
            onCreate={handleDeliveryZoneCreate}
            onDelete={handleDeliveryZoneDelete}
          />
        </>
      )}

      {section === "Coupons" && (
        <div className="mt-8 grid gap-6 xl:grid-cols-[420px_1fr]">
          <CouponForm
            coupon={editingCoupon}
            banners={visiblePromoBanners}
            bannerAction={couponBannerAction}
            bannerTargetId={couponBannerTargetId}
            onChange={setEditingCoupon}
            onBannerActionChange={setCouponBannerAction}
            onBannerTargetIdChange={setCouponBannerTargetId}
            onSubmit={handleCouponSubmit}
          />
          <section>
            <SourceLine source={couponSource} />
            <CouponsTable
              coupons={visibleCoupons}
              onEdit={editCoupon}
              onToggle={handleCouponToggle}
              onArchive={handleCouponArchive}
              onDelete={handleCouponDelete}
            />
          </section>
        </div>
      )}

      {section === "Bannieres" && (
        <div className="mt-8 grid gap-6 xl:grid-cols-[420px_1fr]">
          <PromoBannerForm
            banner={editingPromoBanner}
            coupons={visibleCoupons}
            onChange={setEditingPromoBanner}
            onSubmit={handlePromoBannerSubmit}
          />
          <section>
            <SourceLine source={promoBannerSource} />
            <PromoBannersTable
              banners={visiblePromoBanners}
              coupons={visibleCoupons}
              onEdit={setEditingPromoBanner}
              onToggle={handlePromoBannerToggle}
              onArchive={handlePromoBannerArchive}
              onDelete={handlePromoBannerDelete}
            />
          </section>
        </div>
      )}

      {section === "Clients" && (
        <>
          <SourceLine source={customerSource} />
          <CustomersTable
            customers={customers}
            orders={orders}
            coupons={coupons}
            onAdjustPoints={handleLoyaltyAdjustment}
            onNote={async (customer, note) => {
              await updateCustomerInternalNote(customer.id, note);
              setMessage("Note client enregistree.");
              await refresh();
            }}
            onAssignPromo={handleCustomerPromoAssignment}
            onStatusUpdate={handleCustomerStatusUpdate}
          />
        </>
      )}

      {section === "Favoris produits" && (
        <AdminFavoritesPanel products={products} />
      )}

      {section === "Avis clients" && <AdminReviewsPanel />}

      {section === "Comptabilité" && (
        <AccountingPanel
          products={products}
          productCosts={productCosts}
          productCostsSource={productCostsSource}
          productCostsError={productCostsError}
          supplierPurchases={supplierPurchases}
          supplierPurchasesSource={supplierPurchasesSource}
          supplierPurchasesError={supplierPurchasesError}
          orders={orders}
          invoices={visibleInvoices}
          invoiceSource={invoiceSource}
          billingSettings={billingSettings}
          billingSource={billingSource}
          editingBilling={editingBilling}
          onBillingChange={setEditingBilling}
          onRetry={refresh}
          onCreateManualInvoice={handleManualInvoiceCreate}
          onInvoiceStatus={handleInvoiceStatusUpdate}
          onInvoiceDownload={handleInvoiceDownload}
          onInvoiceSend={handleInvoiceSend}
          onBillingSubmit={handleBillingSettingsSubmit}
          onSaveProductCost={handleProductCostSave}
          onSaveSupplierPurchase={handleSupplierPurchaseSave}
          onSaveSupplierAlias={handleSupplierAliasSave}
          onDeleteSupplierPurchase={handleSupplierPurchaseDelete}
          onCancelSupplierPurchase={handleSupplierPurchaseCancel}
        />
      )}

      {["Parametres", "Paramètres"].includes(section) && (
        <section className="admin-card mt-8">
          <h2 className="font-display text-3xl text-forest">Module non affiche</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink/65">
            Cette section n'est pas exposee dans la navigation admin tant qu'elle
            ne presente pas de donnees operationnelles utiles.
          </p>
        </section>
      )}
    </div>
  );
}

function ProductForm({
  product,
  onChange,
  onSubmit,
  onImageStoragePathRemoved,
  onDeleteProduct,
}: {
  product: ProductInput;
  onChange: (product: ProductInput) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onImageStoragePathRemoved: (path: string) => void;
  onDeleteProduct: (product: ProductInput, confirmationReference: string) => Promise<void>;
}) {
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const canDeleteProduct = Boolean(product.id && product.internalReference);

  useEffect(() => {
    setDeleteConfirmation("");
  }, [product.id]);

  return (
    <form onSubmit={onSubmit} className="admin-card h-fit">
      <h2 className="font-display text-3xl text-forest">
        {product.id ? "Éditer produit" : "Créer produit"}
      </h2>
      <div className="mt-5 grid gap-4">
        <Input label="Nom" value={product.name} onChange={(name) => onChange({ ...product, name })} />
        <Input
          label="Slug"
          value={product.slug}
          onChange={(slug) => onChange({ ...product, slug })}
        />
        <label className="text-sm font-medium text-forest">
          Categorie
          <select
            className="input-field mt-2"
            value={product.category}
            onChange={(event) =>
              onChange({
                ...product,
                category: event.target.value as ProductCategory,
              })
            }
          >
            <option value="flowers">Fleurs CBD</option>
            <option value="resins">Resines CBD</option>
            <option value="oils">Huiles CBD</option>
            <option value="packs">Packs</option>
          </select>
        </label>
        <div className="rounded-md border border-forest/10 bg-cream/40 px-3 py-2 text-sm text-forest">
          <span className="block text-xs uppercase tracking-[0.14em] text-ink/50">
            Reference produit
          </span>
          <span className="mt-1 block font-mono text-base">
            {product.internalReference ||
              (product.id
                ? "Une reference sera generee automatiquement a l'enregistrement"
                : "Generee automatiquement a l'enregistrement")}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberInput
            label="Prix / g"
            value={product.price}
            onChange={(price) => onChange({ ...product, price })}
          />
          <NumberInput
            label="Prix promo"
            value={product.compareAtPrice || 0}
            onChange={(compareAtPrice) =>
              onChange({ ...product, compareAtPrice: compareAtPrice || undefined })
            }
          />
          <NumberInput
            label="Stock"
            value={product.stock}
            onChange={(stock) => onChange({ ...product, stock })}
          />
          <NumberInput
            label="Seuil faible"
            value={product.lowStockThreshold}
            onChange={(lowStockThreshold) =>
              onChange({ ...product, lowStockThreshold })
            }
          />
        </div>
        <FixedPriceOptionsEditor
          product={product}
          onModeChange={(fixedPriceMode) =>
            onChange({
              ...product,
              fixedPriceMode,
              fixedPriceOptions:
                fixedPriceOptionsForMode(fixedPriceMode, product.fixedPriceOptions),
            })
          }
          onChange={(fixedPriceOptions) =>
            onChange({
              ...product,
              fixedPriceMode: "manual",
              fixedPriceOptions,
            })
          }
        />
        <Input
          label="Description courte"
          value={product.shortDescription}
          onChange={(shortDescription) => onChange({ ...product, shortDescription })}
        />
        <Textarea
          label="Description longue"
          value={product.longDescription}
          onChange={(longDescription) => onChange({ ...product, longDescription })}
        />
        <div className="grid grid-cols-3 gap-3">
          <Input label="CBD" value={product.cbdRate} onChange={(cbdRate) => onChange({ ...product, cbdRate })} />
          <Input label="CBG" value={product.cbgRate} onChange={(cbgRate) => onChange({ ...product, cbgRate })} />
          <Input label="THC" value={product.thcRate} onChange={(thcRate) => onChange({ ...product, thcRate })} />
        </div>
        <Input label="Origine" value={product.origin} onChange={(origin) => onChange({ ...product, origin })} />
        <Input label="Culture" value={product.cultureType} onChange={(cultureType) => onChange({ ...product, cultureType: cultureType as Product["cultureType"] })} />
        <ProductImagesEditor
          product={product}
          onChange={(patch) => onChange({ ...product, ...patch })}
          onStoragePathRemoved={onImageStoragePathRemoved}
        />
        <Input label="Aromes, separes par virgule" value={product.aromas.join(", ")} onChange={(aromas) => onChange({ ...product, aromas: normalizeList(aromas) })} />
        <Input label="Tags, separes par virgule" value={product.tags.join(", ")} onChange={(tags) => onChange({ ...product, tags: normalizeList(tags) })} />
        <Input label="SEO title" value={product.seoTitle} onChange={(seoTitle) => onChange({ ...product, seoTitle })} />
        <Textarea label="SEO description" value={product.seoDescription} onChange={(seoDescription) => onChange({ ...product, seoDescription })} />
        <div className="flex flex-wrap gap-4 text-sm text-forest">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={product.isActive}
              onChange={(event) =>
                onChange({ ...product, isActive: event.target.checked })
              }
            />
            Actif
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={product.isFeatured}
              onChange={(event) =>
                onChange({ ...product, isFeatured: event.target.checked })
              }
            />
            Mis en avant
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={product.qualitySealEnabled === true}
              onChange={(event) =>
                onChange({ ...product, qualitySealEnabled: event.target.checked })
              }
            />
            <span>
              Sceau qualité Verdanza
              <span className="mt-0.5 block text-xs font-normal text-ink/55">
                Affiche le sceau rond sur la carte et la fiche produit.
              </span>
            </span>
          </label>
        </div>
        <button className="btn-primary" type="submit">
          Enregistrer
        </button>
        {product.id && (
          <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            <h3 className="font-semibold">Supprimer definitivement le produit</h3>
            <p className="mt-2 leading-6">
              Action irreversible pour {product.name || "ce produit"}.
              Reference actuelle : <span className="font-mono">{product.internalReference || "absente"}</span>.
            </p>
            {!product.internalReference && (
              <p className="mt-2 font-semibold">
                Suppression refusee tant que le produit ne possede pas de reference.
              </p>
            )}
            {product.internalReference && (
              <Input
                label={`Saisissez ${product.internalReference} pour confirmer`}
                value={deleteConfirmation}
                onChange={setDeleteConfirmation}
              />
            )}
            <button
              type="button"
              className="mt-3 rounded-md border border-red-300 bg-white px-4 py-2 font-semibold text-red-800 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canDeleteProduct || deleteConfirmation !== product.internalReference}
              onClick={() => void onDeleteProduct(product, deleteConfirmation)}
            >
              Supprimer definitivement le produit
            </button>
          </div>
        )}
      </div>
    </form>
  );
}

function ProductImagesEditor({
  product,
  onChange,
  onStoragePathRemoved,
}: {
  product: ProductInput;
  onChange: (patch: Pick<ProductInput, "images" | "image" | "imageAlt">) => void;
  onStoragePathRemoved: (path: string) => void;
}) {
  const [uploadProgress, setUploadProgress] = useState<ProductImageUploadProgress | null>(null);
  const [error, setError] = useState("");
  const images = normalizeProductImages({
    id: product.id || "",
    name: product.name || "Produit",
    image: product.image,
    imageAlt: product.imageAlt,
    images: product.images,
  });
  const targetProductId = product.id || product.slug || slugify(product.name || "");

  function applyImages(nextImages: ProductImageAsset[]) {
    const normalized = ensureSinglePrimary(nextImages);
    const primary = normalized.find((image) => image.isPrimary) || normalized[0];
    onChange({
      images: normalized,
      image: primary?.url || BRAND_LABEL,
      imageAlt: primary?.alt || product.name || "Produit Verdanza",
    });
  }

  async function handleFiles(files: FileList | null) {
    setError("");
    if (!files?.length) return;
    if (!targetProductId) {
      setError("Renseignez le nom ou le slug avant d'ajouter une image.");
      return;
    }
    const incoming = Array.from(files);
    if (images.length + incoming.length > PRODUCT_IMAGE_MAX_COUNT) {
      setError(`Maximum ${PRODUCT_IMAGE_MAX_COUNT} images par produit.`);
      return;
    }
    const uploaded: ProductImageAsset[] = [];
    try {
      for (const file of incoming) {
        const image = await uploadProductImageAsset({
          productId: targetProductId,
          file,
          alt: `${product.name || "Produit"} Verdanza`,
          sortOrder: images.length + uploaded.length,
          isPrimary: images.length + uploaded.length === 0,
          onProgress: setUploadProgress,
        });
        uploaded.push(image);
      }
      applyImages([...images, ...uploaded]);
      setUploadProgress(null);
    } catch (uploadError) {
      await Promise.allSettled(
        uploaded
          .filter((image) => image.storagePath)
          .map((image) => deleteProductImageByPath(image.storagePath as string, targetProductId)),
      );
      setUploadProgress(null);
      setError(uploadError instanceof Error ? uploadError.message : "Televersement impossible.");
    }
  }

  function removeImage(image: ProductImageAsset) {
    if (image.storagePath) onStoragePathRemoved(image.storagePath);
    applyImages(images.filter((entry) => entry.id !== image.id));
  }

  function moveImage(index: number, direction: -1 | 1) {
    const next = images.slice();
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    applyImages(next);
  }

  return (
    <div className="rounded-md border border-forest/10 bg-cream p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold text-forest">Images produit</h3>
          <p className="mt-1 text-xs leading-5 text-ink/60">
            JPEG, PNG ou WebP. Maximum {PRODUCT_IMAGE_MAX_COUNT} images, optimisation WebP avant envoi.
          </p>
        </div>
        <label className="btn-secondary min-h-9 cursor-pointer px-3 py-2 text-xs">
          Ajouter
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            onChange={(event) => {
              void handleFiles(event.target.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      <div
        className="mt-3 rounded-md border border-dashed border-forest/20 bg-ivory p-4 text-center text-xs text-ink/60"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void handleFiles(event.dataTransfer.files);
        }}
      >
        Glissez-deposez des images ici.
      </div>
      {error && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {error}
        </p>
      )}
      {uploadProgress && (
        <p className="mt-3 rounded-md border border-forest/10 bg-ivory p-3 text-xs text-forest">
          {uploadProgress.fileName} - {uploadProgress.status} {uploadProgress.progress} %
        </p>
      )}
      <div className="mt-4 grid gap-3">
        {images.map((image, index) => (
          <div key={image.id} className="rounded-md border border-forest/10 bg-ivory p-3">
            <div className="flex gap-3">
              <img
                src={image.url}
                alt=""
                className="h-20 w-20 rounded-md border border-forest/10 object-cover"
                loading="lazy"
              />
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone={image.isPrimary ? "success" : "muted"}>
                    {image.isPrimary ? "Principale" : `Image ${index + 1}`}
                  </AdminBadge>
                  <button
                    type="button"
                    className="text-xs font-semibold text-forest underline"
                    onClick={() =>
                      applyImages(images.map((entry) => ({ ...entry, isPrimary: entry.id === image.id })))
                    }
                  >
                    Choisir comme principale
                  </button>
                  <button
                    type="button"
                    className="text-xs text-forest/70 underline disabled:opacity-40"
                    disabled={index === 0}
                    onClick={() => moveImage(index, -1)}
                  >
                    Monter
                  </button>
                  <button
                    type="button"
                    className="text-xs text-forest/70 underline disabled:opacity-40"
                    disabled={index === images.length - 1}
                    onClick={() => moveImage(index, 1)}
                  >
                    Descendre
                  </button>
                  <button
                    type="button"
                    className="text-xs text-red-700 underline"
                    onClick={() => removeImage(image)}
                  >
                    Supprimer l'image
                  </button>
                </div>
                <Input
                  label="Texte alternatif"
                  value={image.alt}
                  onChange={(alt) =>
                    applyImages(
                      images.map((entry) => (entry.id === image.id ? { ...entry, alt } : entry)),
                    )
                  }
                />
              </div>
            </div>
          </div>
        ))}
        {!images.length && (
          <p className="text-xs text-ink/55">
            Aucune image configuree. Le placeholder existant sera utilise.
          </p>
        )}
      </div>
    </div>
  );
}

function FixedPriceOptionsEditor({
  product,
  onModeChange,
  onChange,
}: {
  product: ProductInput;
  onModeChange: (mode: FixedPriceMode) => void;
  onChange: (options: FixedPriceOption[]) => void;
}) {
  const options = product.fixedPriceOptions || [];
  const mode = normalizeFixedPriceMode(product.fixedPriceMode, product.category);
  const resolvedOptions = resolveFixedPriceOptions({
    ...product,
    fixedPriceMode: mode,
    isActive: product.isActive !== false,
  } as Product);
  const manualIssues = validateManualFixedPriceOptions({
    ...product,
    fixedPriceMode: mode,
    fixedPriceOptions: options,
  } as Product);
  const duplicateActiveTotals = new Set(
    options
      .filter((option) => option.isActive)
      .map((option) => `${option.quantityGrams}:${option.totalPrice}`)
      .filter((key, index, all) => all.indexOf(key) !== index),
  );

  function updateOption(index: number, patch: Partial<FixedPriceOption>) {
    const next = [...options];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  }

  return (
    <div className="rounded-md border border-forest/10 bg-cream p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-forest">Formats prix fixe</h3>
          <p className="mt-1 text-xs leading-5 text-ink/60">
            Politique automatique v{FIXED_PRICE_POLICY_VERSION}. Le stock reste toujours decremente en grammes.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {(["automatic", "manual", "disabled"] as FixedPriceMode[]).map((entry) => (
          <button
            key={entry}
            type="button"
            className={
              mode === entry
                ? "rounded-md border border-forest bg-forest px-3 py-2 text-sm font-semibold text-ivory"
                : "rounded-md border border-forest/15 bg-ivory px-3 py-2 text-sm font-semibold text-forest"
            }
            onClick={() => onModeChange(entry)}
          >
            {entry === "automatic"
              ? "Automatique"
              : entry === "manual"
                ? "Manuel"
                : "Desactive"}
          </button>
        ))}
      </div>

      {mode === "automatic" && (
        <div className="mt-4 rounded-md border border-forest/10 bg-ivory p-3">
          <p className="text-xs leading-5 text-ink/60">
            Les formats sont recalcules depuis le prix au gramme actuel. Ils ne sont pas
            stockes comme grille manuelle.
          </p>
          <FixedPriceOptionsPreview product={product as Product} options={resolvedOptions} />
        </div>
      )}

      {mode === "disabled" && (
        <p className="mt-4 rounded-md border border-forest/10 bg-ivory p-3 text-xs leading-5 text-ink/60">
          Aucun bouton de format fixe ne sera affiche publiquement pour ce produit.
        </p>
      )}

      {mode === "manual" && (
        <>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
              onClick={() =>
                onChange([
                  ...options,
                  {
                    id: `format-${options.length + 1}`,
                    totalPrice: 0,
                    quantityGrams: 0,
                    isActive: false,
                    source: "manual",
                    sortOrder: options.length,
                  },
                ])
              }
            >
              Ajouter
            </button>
          </div>
          {manualIssues.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              {manualIssues.map((issue) => (
                <p key={`${issue.optionId || "global"}-${issue.message}`}>
                  {issue.message}
                </p>
              ))}
            </div>
          )}
        </>
      )}
      {mode === "manual" && (
        <div className="mt-4 grid gap-3">
        {options.length === 0 && (
          <p className="text-xs text-ink/55">Aucun format prix fixe configure.</p>
        )}
        {options.map((option, index) => {
          const duplicateKey = `${option.quantityGrams}:${option.totalPrice}`;
          const isDuplicateActive = option.isActive && duplicateActiveTotals.has(duplicateKey);
          const isAdvantageous = isFixedPriceAdvantageous(product as Product, option);
          return (
            <div key={`${option.id}-${index}`} className="rounded-md border border-forest/10 bg-ivory p-3">
              <div className="grid gap-3 md:grid-cols-4">
                <Input
                  label="Identifiant"
                  value={option.id}
                  onChange={(id) => updateOption(index, { id })}
                />
                <Input
                  label="Libelle"
                  value={option.label || ""}
                  onChange={(label) => updateOption(index, { label })}
                  placeholder={fixedPriceOptionLabel(option)}
                />
                <NumberInput
                  label="Prix total"
                  value={option.totalPrice}
                  onChange={(totalPrice) => updateOption(index, { totalPrice })}
                />
                <NumberInput
                  label="Grammes"
                  value={option.quantityGrams}
                  onChange={(quantityGrams) =>
                    updateOption(index, { quantityGrams: Math.floor(quantityGrams) })
                  }
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-forest/70">
                <label className="flex items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    checked={option.isActive}
                    onChange={(event) => updateOption(index, { isActive: event.target.checked })}
                  />
                  Actif
                </label>
                <span>
                  Prix effectif : {fixedPriceEffectiveUnitPrice(option).toFixed(2).replace(".", ",")} EUR/g
                  {isAdvantageous ? " - avantageux" : ""}
                </span>
                <button
                  type="button"
                  className="text-red-700 underline"
                  onClick={() => onChange(options.filter((_, optionIndex) => optionIndex !== index))}
                >
                  Supprimer ce format
                </button>
              </div>
              {option.isActive && !isAdvantageous && (
                <p className="mt-2 text-xs text-amber-800">
                  Ce format actif n'est pas moins cher que le prix au gramme actuel.
                </p>
              )}
              {isDuplicateActive && (
                <p className="mt-2 text-xs text-red-700">
                  Un format actif identique existe deja pour ce produit.
                </p>
              )}
            </div>
          );
        })}
        </div>
      )}
    </div>
  );
}

function FixedPriceOptionsPreview({
  product,
  options,
}: {
  product: Product;
  options: ReturnType<typeof resolveFixedPriceOptions>;
}) {
  if (options.length === 0) {
    return (
      <p className="mt-3 text-xs text-amber-800">
        Aucun format automatique coherent pour le prix et la categorie actuels.
      </p>
    );
  }

  return (
    <div className="mt-3 grid gap-2">
      {options.map((option) => (
        <div
          key={option.id}
          className="rounded-md border border-forest/10 bg-cream p-3 text-xs text-forest"
        >
          <p className="font-semibold">{fixedPriceOptionLabel(option)}</p>
          <p className="mt-1 text-forest/70">
            Prix effectif : {fixedPriceEffectiveUnitPrice(option).toFixed(2).replace(".", ",")} EUR/g
          </p>
          <p className="text-forest/70">
            Economie : {option.savingAmount.toFixed(2).replace(".", ",")} EUR (
            {(option.savingRate * 100).toFixed(1).replace(".", ",")} %)
          </p>
          <p className="text-forest/60">
            Politique v{option.policyVersion || FIXED_PRICE_POLICY_VERSION} - {option.id}
          </p>
        </div>
      ))}
      {!product.isActive && (
        <p className="text-xs text-amber-800">
          Produit inactif : aucun format ne sera affiche publiquement.
        </p>
      )}
    </div>
  );
}

type AdminBadgeTone = "neutral" | "success" | "warning" | "danger" | "muted" | "gold";

function AdminBadge({
  children,
  tone = "neutral",
}: {
  children: string | number;
  tone?: AdminBadgeTone;
}) {
  const styles = {
    neutral: "border-forest/15 bg-ivory text-forest",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-red-200 bg-red-50 text-red-900",
    muted: "border-forest/10 bg-cream text-ink/60",
    gold: "border-champagne/40 bg-cream text-forest",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

function AdminEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-b border-forest/10 bg-cream px-4 py-5 text-sm text-forest">
      <strong className="block">{title}</strong>
      <span className="mt-1 block text-ink/60">{description}</span>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

function AdminDataError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => Promise<void>;
}) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>{message}</span>
        <button
          type="button"
          className="min-h-9 rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-50"
          onClick={() => void onRetry()}
        >
          Reessayer
        </button>
      </div>
    </div>
  );
}

function ProductTable({
  products,
  onEdit,
  onFlagChange,
}: {
  products: Product[];
  onEdit: (product: Product) => void;
  onFlagChange: (product: Product, key: "isActive" | "isFeatured") => Promise<void>;
}) {
  const [categoryFilter, setCategoryFilter] = useState<ProductCategoryFilter>("all");
  const [search, setSearch] = useState("");
  const categoryFilters = buildProductCategoryFilters(products);
  const visibleProducts = products
    .filter((product) => productMatchesCategoryFilter(product, categoryFilter))
    .filter((product) => productMatchesAdminSearch(product, search));

  return (
    <section className="overflow-hidden rounded-lg border border-forest/10 bg-ivory">
      <div className="border-b border-forest/10 bg-cream/70 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-champagne">Catalogue</p>
            <h2 className="font-display text-3xl text-forest">Produits par section</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {categoryFilters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={categoryFilter === filter.value ? "btn-primary min-h-9 px-3 py-1.5 text-xs" : "btn-secondary min-h-9 px-3 py-1.5 text-xs"}
                onClick={() => setCategoryFilter(filter.value)}
              >
                {filter.label} · {filter.count}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 max-w-sm">
          <Input
            label="Recherche nom, slug ou reference"
            value={search}
            onChange={setSearch}
            placeholder="VDZ-RES-KM7QF2"
          />
        </div>
      </div>
      {!products.length && (
        <AdminEmptyState
          title="Aucun produit pour le moment."
          description="Ajoutez un produit ou rafraichissez les donnees connectees."
        />
      )}
      {!!products.length && !visibleProducts.length && (
        <AdminEmptyState
          title="Aucun produit dans cette section."
          description="Changez de filtre ou affichez tous les produits."
        />
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
            <tr>
              {["Produit", "Categorie", "Prix", "Stock", "Actif", "Mis en avant", "Sceau", "Action"].map((header) => (
                <th key={header} className="px-4 py-3 font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleProducts.map((product) => (
              <tr key={product.id} className="border-t border-forest/10">
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <img
                      src={product.image || BRAND_LABEL}
                      alt=""
                      className="h-14 w-14 rounded-md border border-forest/10 object-cover"
                      loading="lazy"
                    />
                    <div>
                      <strong className="block text-forest">{product.name}</strong>
                      <span className="text-xs text-ink/50">{product.slug}</span>
                      <span className="block text-xs font-mono text-ink/55">
                        {product.internalReference || "Reference a attribuer"}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <AdminBadge tone={categoryTone(product.category)}>
                    {productCategoryLabel(product.category)}
                  </AdminBadge>
                </td>
                <td className="px-4 py-4">{product.price.toFixed(2)} EUR/g</td>
                <td className="px-4 py-4">
                  <span className="block font-semibold text-forest">{product.stock} g</span>
                  <AdminBadge tone={stockTone(product)}>
                    {stockLabel(product)}
                  </AdminBadge>
                </td>
                <td className="px-4 py-4">
                  <button onClick={() => void onFlagChange(product, "isActive")}>
                    <AdminBadge tone={product.isActive ? "success" : "muted"}>
                    {product.isActive ? "Actif" : "Inactif"}
                    </AdminBadge>
                  </button>
                </td>
                <td className="px-4 py-4">
                  <button onClick={() => void onFlagChange(product, "isFeatured")}>
                    <AdminBadge tone={product.isFeatured ? "gold" : "muted"}>
                    {product.isFeatured ? "Oui" : "Non"}
                    </AdminBadge>
                  </button>
                </td>
                <td className="px-4 py-4">
                  <AdminBadge tone={product.qualitySealEnabled ? "gold" : "muted"}>
                    {product.qualitySealEnabled ? "Actif" : "Non"}
                  </AdminBadge>
                </td>
                <td className="px-4 py-4">
                  <button className="btn-secondary min-h-9 px-3 py-2" onClick={() => onEdit(product)}>
                    Editer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StockTable({
  products,
  onStockChange,
}: {
  products: Product[];
  onStockChange: (
    product: Product,
    stock: number,
    threshold: number,
  ) => Promise<void>;
}) {
  const [filter, setFilter] = useState<StockFilter>("all");
  const [search, setSearch] = useState("");
  const stockFilters = buildStockFilters(products);
  const visibleProducts = products
    .filter((product) => productMatchesStockFilter(product, filter))
    .filter((product) => productMatchesAdminSearch(product, search));

  return (
    <section className="mt-8 grid gap-4">
      <div className="rounded-lg border border-forest/10 bg-ivory p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-champagne">Stocks</p>
            <h2 className="font-display text-3xl text-forest">Gestion rapide par filtre</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {stockFilters.map((stockFilter) => (
              <button
                key={stockFilter.value}
                type="button"
                className={filter === stockFilter.value ? "btn-primary min-h-9 px-3 py-1.5 text-xs" : "btn-secondary min-h-9 px-3 py-1.5 text-xs"}
                onClick={() => setFilter(stockFilter.value)}
              >
                {stockFilter.label} · {stockFilter.count}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 max-w-sm">
          <Input
            label="Recherche nom, slug ou reference"
            value={search}
            onChange={setSearch}
            placeholder="VDZ-000001"
          />
        </div>
      </div>
      {!visibleProducts.length && (
        <AdminEmptyState
          title="Aucun produit pour ce filtre."
          description="Changez de filtre ou revenez sur Tous."
        />
      )}
      {visibleProducts.map((product) => (
        <StockRow key={product.id} product={product} onStockChange={onStockChange} />
      ))}
    </section>
  );
}

function StockRow({
  product,
  onStockChange,
}: {
  product: Product;
  onStockChange: (
    product: Product,
    stock: number,
    threshold: number,
  ) => Promise<void>;
}) {
  const [stock, setStock] = useState(product.stock);
  const [threshold, setThreshold] = useState(product.lowStockThreshold);

  return (
    <article className="admin-card grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_100px_110px_auto] md:items-end">
      <div className="flex items-center gap-3">
        <img
          src={product.image || BRAND_LABEL}
          alt=""
          className="h-12 w-12 rounded-md border border-forest/10 object-cover"
          loading="lazy"
        />
        <div>
          <h2 className="font-display text-xl leading-tight text-forest">{product.name}</h2>
          <span className="text-xs font-mono text-ink/50">
            {product.internalReference || "Reference a attribuer"}
          </span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <AdminBadge tone={product.isActive ? "success" : "muted"}>
              {product.isActive ? "Actif" : "Inactif"}
            </AdminBadge>
            <AdminBadge tone={categoryTone(product.category)}>
              {productCategoryLabel(product.category)}
            </AdminBadge>
            <AdminBadge tone={stockTone(product)}>{stockLabel(product)}</AdminBadge>
          </div>
        </div>
      </div>
      <NumberInput label="Stock" value={stock} onChange={setStock} />
      <NumberInput label="Seuil" value={threshold} onChange={setThreshold} />
      <button
        className="btn-primary min-h-10 px-4 py-2 text-sm"
        onClick={() => void onStockChange(product, stock, threshold)}
      >
        Enregistrer
      </button>
    </article>
  );
}

function DeliveryRulesSummary() {
  return (
    <section className="mt-6 grid gap-3 md:grid-cols-3">
      <article className="admin-card border-l-4 border-l-emerald-200">
        <p className="text-xs uppercase tracking-[0.16em] text-champagne">Livraison locale</p>
        <strong className="mt-2 block font-display text-3xl text-forest">
          {LOCAL_DELIVERY_MINIMUM} EUR
        </strong>
        <span className="text-xs text-ink/55">Minimum Aix-en-Provence et alentours</span>
      </article>
      <article className="admin-card border-l-4 border-l-sky-200">
        <p className="text-xs uppercase tracking-[0.16em] text-champagne">Livraison postale</p>
        <strong className="mt-2 block font-display text-3xl text-forest">
          {POSTAL_DELIVERY_MINIMUM} EUR
        </strong>
        <span className="text-xs text-ink/55">Minimum France</span>
      </article>
      <article className="admin-card border-l-4 border-l-champagne">
        <p className="text-xs uppercase tracking-[0.16em] text-champagne">Livraison offerte</p>
        <strong className="mt-2 block font-display text-3xl text-forest">
          {POSTAL_FREE_SHIPPING_THRESHOLD} EUR
        </strong>
        <span className="text-xs text-ink/55">Seuil livraison postale offerte</span>
      </article>
    </section>
  );
}

function DeliveryZonesPanel({
  zones,
  onSave,
  onCreate,
  onDelete,
}: {
  zones: DeliveryZone[];
  onSave: (
    zone: DeliveryZone,
    data: DeliveryZoneAdminInput,
  ) => Promise<void>;
  onCreate: (data: DeliveryZoneAdminInput) => Promise<void>;
  onDelete: (zone: DeliveryZone) => Promise<void>;
}) {
  const [filter, setFilter] = useState<DeliveryZoneFilter>("all");
  const zoneFilters = buildDeliveryZoneFilters(zones);
  const visibleZones = zones.filter((zone) => deliveryZoneMatchesFilter(zone, filter));
  const nextSortOrder =
    zones.reduce((max, zone) => Math.max(max, Number(zone.sortOrder || 0)), 0) + 1;
  const openZones = zones.filter((zone) => zone.isActive && zone.status === "open").length;

  return (
    <section className="mt-8 grid gap-4">
      <div className="rounded-lg border border-forest/10 bg-ivory p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-champagne">Zones locales</p>
            <h2 className="font-display text-3xl text-forest">Disponibilite client</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-ink/60">
              Pilotez les zones affichées au client, leurs seuils, délais publics et états
              d'ouverture. {openZones} zone{openZones > 1 ? "s" : ""} ouverte{openZones > 1 ? "s" : ""} actuellement.
            </p>
          </div>
          <div className="grid gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-forest/55">
              Filtrer
            </span>
            <div className="flex flex-wrap gap-2">
              {zoneFilters.map((zoneFilter) => (
                <button
                  key={zoneFilter.value}
                  type="button"
                  className={filter === zoneFilter.value ? "btn-primary min-h-9 px-3 py-1.5 text-xs" : "btn-secondary min-h-9 px-3 py-1.5 text-xs"}
                  onClick={() => setFilter(zoneFilter.value)}
                >
                  {zoneFilter.label} · {zoneFilter.count}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <DeliveryZoneCreateForm nextSortOrder={nextSortOrder} onCreate={onCreate} />
      {!visibleZones.length && (
        <AdminEmptyState
          title="Aucune zone pour ce filtre."
          description="Changez de filtre ou affichez toutes les zones."
        />
      )}
      {visibleZones.map((zone) => (
        <DeliveryZoneRow key={zone.id} zone={zone} onSave={onSave} onDelete={onDelete} />
      ))}
    </section>
  );
}

function DeliveryZoneCreateForm({
  nextSortOrder,
  onCreate,
}: {
  nextSortOrder: number;
  onCreate: (data: DeliveryZoneAdminInput) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [fee, setFee] = useState(0);
  const [minimumOrder, setMinimumOrder] = useState(LOCAL_DELIVERY_MINIMUM);
  const [estimatedDelay, setEstimatedDelay] = useState("");
  const [estimatedDelayMinMinutes, setEstimatedDelayMinMinutes] = useState("");
  const [estimatedDelayMaxMinutes, setEstimatedDelayMaxMinutes] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [sortOrder, setSortOrder] = useState(nextSortOrder);
  const [isOpen, setIsOpen] = useState(false);
  const publicEstimate = formatLocalDeliveryEstimate({
    estimatedDelayMinMinutes: optionalPositiveNumberFromInput(estimatedDelayMinMinutes),
    estimatedDelayMaxMinutes: optionalPositiveNumberFromInput(estimatedDelayMaxMinutes),
  });

  useEffect(() => {
    setSortOrder(nextSortOrder);
  }, [nextSortOrder]);

  async function handleCreate() {
    await onCreate({
      name,
      isActive: false,
      isOpen: false,
      status: "disabled",
      fee,
      minimumOrder,
      minimumOrderAmount: minimumOrder,
      estimatedDelay,
      estimatedDelayMinMinutes: optionalPositiveNumberFromInput(estimatedDelayMinMinutes),
      estimatedDelayMaxMinutes: optionalPositiveNumberFromInput(estimatedDelayMaxMinutes),
      customerMessage,
      adminNote,
      sortOrder,
    });
    setName("");
    setFee(0);
    setMinimumOrder(LOCAL_DELIVERY_MINIMUM);
    setEstimatedDelay("");
    setEstimatedDelayMinMinutes("");
    setEstimatedDelayMaxMinutes("");
    setCustomerMessage("");
    setAdminNote("");
    setIsOpen(false);
  }

  return (
    <article className="admin-card overflow-hidden p-0">
      <div className="flex flex-col gap-3 border-b border-forest/10 bg-cream/50 p-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-champagne">
            Nouvelle zone locale
          </p>
          <h3 className="mt-1 font-display text-2xl text-forest">Créer une zone inactive</h3>
          <p className="mt-1 text-sm leading-6 text-ink/60">
            La zone est créée désactivée pour permettre une vérification avant publication client.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AdminBadge tone="muted">Inactive</AdminBadge>
          <AdminBadge tone="muted">Désactivée</AdminBadge>
          <button
            type="button"
            className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
            onClick={() => setIsOpen((current) => !current)}
          >
            {isOpen ? "Masquer" : "Afficher"}
          </button>
        </div>
      </div>
      {isOpen && (
        <>
          <div className="grid gap-4 p-4 xl:grid-cols-[1.2fr_1fr_1fr]">
            <div className="grid gap-3 rounded-lg border border-forest/10 bg-ivory p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-forest/55">
                Identité
              </p>
              <Input label="Nom" value={name} onChange={setName} />
              <NumberInput label="Ordre" value={sortOrder} onChange={setSortOrder} />
            </div>
            <div className="grid gap-3 rounded-lg border border-forest/10 bg-ivory p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-forest/55">
                Seuils et visibilité
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberInput label="Frais" value={fee} onChange={setFee} />
                <NumberInput label="Minimum" value={minimumOrder} onChange={setMinimumOrder} />
              </div>
              <label className="text-sm font-medium text-forest">
                Visibilité
                <select className="input-field mt-2" value="inactive" disabled>
                  <option value="inactive">Inactif</option>
                </select>
              </label>
              <label className="text-sm font-medium text-forest">
                Statut client
                <select className="input-field mt-2" value="disabled" disabled>
                  <option value="disabled">Désactivée</option>
                </select>
              </label>
            </div>
            <div className="grid gap-3 rounded-lg border border-forest/10 bg-ivory p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-forest/55">
                Délais et messages
              </p>
              <Input label="Délai interne historique" value={estimatedDelay} onChange={setEstimatedDelay} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Délai public min (minutes)"
                  type="number"
                  value={estimatedDelayMinMinutes}
                  onChange={setEstimatedDelayMinMinutes}
                />
                <Input
                  label="Délai public max (minutes)"
                  type="number"
                  value={estimatedDelayMaxMinutes}
                  onChange={setEstimatedDelayMaxMinutes}
                />
              </div>
              <p className="rounded-md border border-forest/10 bg-cream px-3 py-2 text-xs leading-5 text-ink/65">
                Délai public : {publicEstimate}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Message client" value={customerMessage} onChange={setCustomerMessage} />
                <Input label="Note interne" value={adminNote} onChange={setAdminNote} />
              </div>
            </div>
          </div>
          <div className="flex justify-end border-t border-forest/10 bg-cream/30 p-4">
            <button
              className="btn-primary min-w-44"
              disabled={!name.trim()}
              onClick={() => void handleCreate()}
            >
              Créer la zone
            </button>
          </div>
        </>
      )}
    </article>
  );
}

function DeliveryZoneRow({
  zone,
  onSave,
  onDelete,
}: {
  zone: DeliveryZone;
  onSave: (
    zone: DeliveryZone,
    data: DeliveryZoneAdminInput,
  ) => Promise<void>;
  onDelete: (zone: DeliveryZone) => Promise<void>;
}) {
  const [name, setName] = useState(zone.name);
  const [isActive, setIsActive] = useState(zone.isActive);
  const [status, setStatus] = useState<DeliveryZoneStatus>(
    zone.status || (zone.isActive ? "open" : "disabled"),
  );
  const [fee, setFee] = useState(zone.fee);
  const [minimumOrder, setMinimumOrder] = useState(
    zone.minimumOrderAmount ?? zone.minimumOrder,
  );
  const [estimatedDelay, setEstimatedDelay] = useState(zone.estimatedDelay);
  const [estimatedDelayMinMinutes, setEstimatedDelayMinMinutes] = useState(
    optionalNumberInputValue(zone.estimatedDelayMinMinutes),
  );
  const [estimatedDelayMaxMinutes, setEstimatedDelayMaxMinutes] = useState(
    optionalNumberInputValue(zone.estimatedDelayMaxMinutes),
  );
  const [customerMessage, setCustomerMessage] = useState(zone.customerMessage || "");
  const [adminNote, setAdminNote] = useState(zone.adminNote || "");
  const [sortOrder, setSortOrder] = useState(zone.sortOrder || 0);
  const [isEditing, setIsEditing] = useState(false);
  const isOpen = status === "open" && isActive;
  const publicEstimate = formatLocalDeliveryEstimate({
    estimatedDelayMinMinutes: optionalPositiveNumberFromInput(estimatedDelayMinMinutes),
    estimatedDelayMaxMinutes: optionalPositiveNumberFromInput(estimatedDelayMaxMinutes),
  });
  const methodLabel = zone.method === "postal" ? "Postale" : "Locale";
  const feeLabel = fee > 0 ? `${formatEuro(fee)} EUR` : "Offert";

  return (
    <article className="admin-card overflow-hidden p-0">
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.14em] text-champagne">
            {methodLabel}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h3 className="font-display text-2xl text-forest">{zone.name}</h3>
            <AdminBadge tone={isActive ? "success" : "muted"}>
              {isActive ? "Active" : "Inactive"}
            </AdminBadge>
            <AdminBadge tone={deliveryStatusTone(status, isActive)}>
              {deliveryStatusLabel(status, isActive)}
            </AdminBadge>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink/60">
            <span>Frais : {feeLabel}</span>
            <span>Minimum : {formatEuro(minimumOrder)} EUR</span>
            <span>Ordre : {sortOrder}</span>
            {zone.method === "local_express" && <span>Délai public : {publicEstimate}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
            onClick={() => setIsEditing((current) => !current)}
          >
            {isEditing ? "Masquer" : "Modifier"}
          </button>
          {isEditing && (
            <button
              className="btn-primary min-h-9 px-3 py-1.5 text-xs"
              onClick={() =>
                void onSave(zone, {
                  name,
                  isActive,
                  isOpen,
                  status,
                  fee,
                  minimumOrder,
                  minimumOrderAmount: minimumOrder,
                  estimatedDelay,
                  estimatedDelayMinMinutes: optionalPositiveNumberFromInput(estimatedDelayMinMinutes),
                  estimatedDelayMaxMinutes: optionalPositiveNumberFromInput(estimatedDelayMaxMinutes),
                  customerMessage,
                  adminNote,
                  sortOrder,
                })
              }
            >
              Enregistrer
            </button>
          )}
          <button
            className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
            onClick={() => void onDelete(zone)}
          >
            Supprimer
          </button>
        </div>
      </div>
      {isEditing && (
        <div className="grid gap-4 border-t border-forest/10 bg-cream/30 p-4 md:grid-cols-2 xl:grid-cols-6 xl:items-end">
          <Input label="Nom" value={name} onChange={setName} />
          <NumberInput label="Frais" value={fee} onChange={setFee} />
          <NumberInput label="Minimum" value={minimumOrder} onChange={setMinimumOrder} />
          <NumberInput label="Ordre" value={sortOrder} onChange={setSortOrder} />
          <Input label="Délai interne historique" value={estimatedDelay} onChange={setEstimatedDelay} />
          {zone.method === "local_express" && (
            <>
              <Input
                label="Délai public min (minutes)"
                type="number"
                value={estimatedDelayMinMinutes}
                onChange={setEstimatedDelayMinMinutes}
              />
              <Input
                label="Délai public max (minutes)"
                type="number"
                value={estimatedDelayMaxMinutes}
                onChange={setEstimatedDelayMaxMinutes}
              />
              <p className="rounded-md border border-forest/10 bg-cream px-3 py-2 text-xs leading-5 text-ink/65 xl:col-span-3">
                Délai public : {publicEstimate}
              </p>
            </>
          )}
          <label className="text-sm font-medium text-forest">
            Visibilité
            <select
              className="input-field mt-2"
              value={isActive ? "active" : "inactive"}
              onChange={(event) => setIsActive(event.target.value === "active")}
            >
              <option value="active">Actif</option>
              <option value="inactive">Inactif</option>
            </select>
          </label>
          <label className="text-sm font-medium text-forest xl:col-span-2">
            Statut client
            <select
              className="input-field mt-2"
              value={status}
              onChange={(event) => setStatus(event.target.value as DeliveryZoneStatus)}
            >
              <option value="open">Ouverte</option>
              <option value="temporarily_closed">Temporairement fermée</option>
              <option value="coming_soon">Bientôt disponible</option>
              <option value="disabled">Désactivée</option>
            </select>
          </label>
          <Input label="Message client" value={customerMessage} onChange={setCustomerMessage} />
          <Input label="Note interne" value={adminNote} onChange={setAdminNote} />
        </div>
      )}
    </article>
  );
}

function CouponForm({
  coupon,
  banners,
  bannerAction,
  bannerTargetId,
  onChange,
  onBannerActionChange,
  onBannerTargetIdChange,
  onSubmit,
}: {
  coupon: CouponInput;
  banners: PromoBanner[];
  bannerAction: "none" | "create" | "link";
  bannerTargetId: string;
  onChange: (coupon: CouponInput) => void;
  onBannerActionChange: (action: "none" | "create" | "link") => void;
  onBannerTargetIdChange: (bannerId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const preview = couponPreview(coupon);

  return (
    <form onSubmit={onSubmit} className="admin-card h-fit">
      <h2 className="font-display text-3xl text-forest">
        {coupon.id ? "Modifier une promotion" : "Créer une promotion"}
      </h2>
      <div className="mt-5 grid gap-4">
        <div>
          <Input
            label="Code promo"
            value={coupon.code}
            onChange={(code) => onChange({ ...coupon, code: code.toUpperCase().replace(/\s+/g, "") })}
          />
          <p className="mt-1 text-xs text-ink/55">Exemple : WELCOME10</p>
        </div>
        <Input
          label="Nom / libellé"
          value={coupon.label}
          onChange={(label) => onChange({ ...coupon, label })}
        />
        <label className="text-sm font-medium text-forest">
          Type de réduction
          <select
            className="input-field mt-2"
            value={coupon.discountType}
            onChange={(event) =>
              onChange({
                ...coupon,
                discountType: event.target.value as Coupon["discountType"],
              })
            }
          >
            <option value="percent">Pourcentage</option>
            <option value="fixed">Montant fixe</option>
            <option value="free_shipping">Livraison postale offerte</option>
          </select>
          <span className="mt-1 block text-xs font-normal text-ink/55">
            Choisissez pourcentage, montant fixe ou livraison offerte.
          </span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <NumberInput
            label="Valeur de la remise"
            value={coupon.discountValue}
            onChange={(discountValue) => onChange({ ...coupon, discountValue })}
          />
          <NumberInput
            label="Minimum de commande"
            value={coupon.minimumOrder}
            onChange={(minimumOrder) => onChange({ ...coupon, minimumOrder })}
          />
          <NumberInput
            label="Nombre maximum d'utilisations"
            value={coupon.maxUses || 0}
            onChange={(maxUses) => onChange({ ...coupon, maxUses: maxUses || undefined })}
          />
        </div>
        <p className="text-xs leading-5 text-ink/55">
          Pour 10 %, indiquez 10. Pour 5 €, indiquez 5. Laissez 0 en limite
          d'utilisation pour illimité.
        </p>
        <Input
          label="Date de début"
          value={dateInputValue(coupon.startsAt)}
          onChange={(startsAt) => onChange({ ...coupon, startsAt: startsAt || undefined })}
          type="date"
        />
        <Input
          label="Date de fin"
          value={dateInputValue(coupon.endsAt)}
          onChange={(endsAt) => onChange({ ...coupon, endsAt: endsAt || undefined })}
          type="date"
        />
        <label className="flex items-center gap-2 text-sm text-forest">
          <input
            type="checkbox"
            checked={coupon.isActive}
            onChange={(event) => onChange({ ...coupon, isActive: event.target.checked })}
          />
          Actif
        </label>
        <label className="flex items-center gap-2 text-sm text-forest">
          <input
            type="checkbox"
            checked={coupon.autoApply === true}
            onChange={(event) => onChange({ ...coupon, autoApply: event.target.checked })}
          />
          Auto-appliquer dans le panier
        </label>
        <div className="rounded-md border border-champagne/30 bg-cream p-3 text-sm leading-6 text-forest">
          <strong className="block">Aperçu</strong>
          {preview}
        </div>
        <label className="text-sm font-medium text-forest">
          Banniere associee
          <select
            className="input-field mt-2"
            value={bannerAction}
            onChange={(event) => {
              const action = event.target.value as "none" | "create" | "link";
              onBannerActionChange(action);
              if (action !== "link") onBannerTargetIdChange("");
            }}
          >
            <option value="none">Ne creer aucune banniere</option>
            <option value="create">Creer une banniere associee inactive</option>
            <option value="link">Selectionner une banniere existante</option>
          </select>
        </label>
        {bannerAction === "link" && (
          <label className="text-sm font-medium text-forest">
            Banniere existante
            <select
              className="input-field mt-2"
              value={bannerTargetId}
              onChange={(event) => onBannerTargetIdChange(event.target.value)}
            >
              <option value="">Choisir une banniere</option>
              {banners.map((banner) => (
                <option key={banner.id} value={banner.id}>
                  {banner.title} ({banner.id})
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="btn-secondary min-h-10 justify-between px-3 py-2 text-sm"
          type="button"
          onClick={() => setShowAdvanced((value) => !value)}
        >
          Options avancées
          <span>{showAdvanced ? "Masquer" : "Afficher"}</span>
        </button>
        {showAdvanced && (
          <div className="grid gap-4 rounded-md border border-forest/10 bg-cream p-4">
            <label className="text-sm font-medium text-forest">
              Type moteur automatique
              <select
                className="input-field mt-2"
                value={coupon.promotionType || inferAdminPromotionType(coupon)}
                onChange={(event) =>
                  onChange({
                    ...coupon,
                    promotionType: event.target.value as PromotionRuleType,
                  })
                }
              >
                <option value="fixed_cart_discount">Montant fixe panier</option>
                <option value="fixed_category_discount">Montant fixe categorie</option>
                <option value="threshold_extra_discount">Offert après seuil</option>
                <option value="percentage_cart_discount">Pourcentage panier</option>
                <option value="percentage_category_discount">Pourcentage categorie</option>
                <option value="free_shipping">Livraison offerte</option>
              </select>
              {coupon.promotionType === "threshold_extra_discount" && (
                <span className="mt-1 block text-xs font-normal text-ink/55">
                  Le client paie un montant minimum, puis reçoit jusqu'à X EUR
                  offerts sur la catégorie choisie.
                </span>
              )}
            </label>
            <label className="text-sm font-medium text-forest">
              Categorie eligible
              <select
                className="input-field mt-2"
                value={coupon.eligibleCategory || ""}
                onChange={(event) => {
                  const category = (event.target.value || undefined) as
                    | ProductCategory
                    | undefined;
                  onChange({
                    ...coupon,
                    eligibleCategory: category,
                    categories: category ? [category] : coupon.categories,
                  });
                }}
              >
                <option value="">Tout le panier</option>
                <option value="flowers">Fleurs CBD</option>
                <option value="resins">Resines CBD</option>
              </select>
            </label>
            <NumberInput
              label="Minimum sur categorie eligible"
              value={coupon.minEligibleSubtotal || 0}
              onChange={(minEligibleSubtotal) =>
                onChange({ ...coupon, minEligibleSubtotal })
              }
            />
            {coupon.promotionType === "threshold_extra_discount" && (
              <div className="grid gap-3 md:grid-cols-2">
                <NumberInput
                  label="Montant minimum payé"
                  value={coupon.paidThresholdAmount || 0}
                  onChange={(paidThresholdAmount) =>
                    onChange({ ...coupon, paidThresholdAmount })
                  }
                />
                <NumberInput
                  label="Montant offert maximum"
                  value={coupon.maxGiftAmount || 0}
                  onChange={(maxGiftAmount) => onChange({ ...coupon, maxGiftAmount })}
                />
              </div>
            )}
            <NumberInput
              label="Remise maximale"
              value={coupon.maxDiscountAmount || 0}
              onChange={(maxDiscountAmount) =>
                onChange({ ...coupon, maxDiscountAmount: maxDiscountAmount || undefined })
              }
            />
            <NumberInput
              label="Priorite"
              value={coupon.priority || 10}
              onChange={(priority) => onChange({ ...coupon, priority })}
            />
            <label className="flex items-center gap-2 text-sm text-forest">
              <input
                type="checkbox"
                checked={coupon.stackable === true}
                onChange={(event) => onChange({ ...coupon, stackable: event.target.checked })}
              />
              Cumulable plus tard
            </label>
            <NumberInput
              label="Utilisations actuelles"
              value={coupon.usedCount || 0}
              onChange={(usedCount) => onChange({ ...coupon, usedCount })}
            />
            <Input
              label="Produits concernés"
              value={(coupon.productIds ?? []).join(", ")}
              onChange={(productIds) => onChange({ ...coupon, productIds: normalizeList(productIds) })}
            />
            <Input
              label="Catégories concernées"
              value={(coupon.categories ?? []).join(", ")}
              onChange={(categories) =>
                onChange({ ...coupon, categories: normalizeList(categories) as ProductCategory[] })
              }
            />
            <Input
              label="Notes internes"
              value={coupon.internalNote || ""}
              onChange={(internalNote) => onChange({ ...coupon, internalNote })}
            />
          </div>
        )}
        <button className="btn-primary" type="submit">
          Enregistrer la promotion
        </button>
      </div>
    </form>
  );
}

function CouponsTable({
  coupons,
  onEdit,
  onToggle,
  onArchive,
  onDelete,
}: {
  coupons: Coupon[];
  onEdit: (coupon: CouponInput) => void;
  onToggle: (coupon: Coupon) => Promise<void>;
  onArchive: (coupon: Coupon) => Promise<void>;
  onDelete: (coupon: Coupon) => Promise<void>;
}) {
  const activeCount = coupons.filter((coupon) => couponStatus(coupon).label === "Actif").length;
  const expiredCount = coupons.filter((coupon) => couponStatus(coupon).label === "Expiré").length;
  const usedCount = coupons.reduce((sum, coupon) => sum + Number(coupon.usedCount || 0), 0);

  return (
    <section className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        <article className="admin-card">
          <p className="text-sm text-ink/55">Codes actifs</p>
          <strong className="mt-2 block font-display text-3xl text-forest">{activeCount}</strong>
        </article>
        <article className="admin-card">
          <p className="text-sm text-ink/55">Codes expirés</p>
          <strong className="mt-2 block font-display text-3xl text-forest">{expiredCount}</strong>
        </article>
        <article className="admin-card">
          <p className="text-sm text-ink/55">Utilisations totales</p>
          <strong className="mt-2 block font-display text-3xl text-forest">{usedCount}</strong>
        </article>
      </div>
      <section className="overflow-hidden rounded-lg border border-forest/10 bg-ivory">
      {!coupons.length && (
        <AdminEmptyState
          title="Aucun code promo créé pour le moment."
          description="Créez un code simple comme WELCOME10, BIENVENUE5 ou ETE10."
        />
      )}
      {!!coupons.length && (
        <div className="grid gap-3 p-3 lg:hidden">
          {coupons.map((coupon) => {
            const status = couponStatus(coupon);
            return (
              <article key={coupon.id} className="rounded-lg border border-forest/10 bg-ivory p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <strong className="block text-forest">{coupon.code}</strong>
                    <span className="text-xs text-ink/55">{coupon.label}</span>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {isTemplateCoupon(coupon) && <AdminBadge tone="gold">Modele</AdminBadge>}
                    <AdminBadge tone={status.tone}>{status.label}</AdminBadge>
                  </div>
                </div>
                <p className="mt-3 text-sm text-ink/70">{couponDescription(coupon)}</p>
                <p className="mt-2 text-xs text-ink/55">
                  Minimum {formatEuro(Number(coupon.minimumOrder || 0))} EUR · Utilisations{" "}
                  {coupon.usedCount || 0}
                  {coupon.maxUses ? ` / ${coupon.maxUses}` : " / illimité"}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" onClick={() => onEdit(coupon)}>
                    Modifier
                  </button>
                  <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" onClick={() => void onToggle(coupon)}>
                    {coupon.isActive ? "Désactiver" : "Activer"}
                  </button>
                  <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" onClick={() => void onArchive(coupon)}>
                    Archiver
                  </button>
                  <button className="btn-secondary min-h-9 border-red-200 px-3 py-1.5 text-xs text-red-700" onClick={() => void onDelete(coupon)}>
                    Supprimer
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="hidden w-full min-w-[980px] text-left text-sm lg:table">
          <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
            <tr>
              {["Code", "Type", "Valeur", "Minimum", "Utilisations", "Validité", "Statut", "Actions"].map((header) => (
                <th key={header} className="px-4 py-3 font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coupons.map((coupon) => {
              const status = couponStatus(coupon);
              return (
                <tr key={coupon.id} className="border-t border-forest/10">
                  <td className="px-4 py-4">
                    <strong className="block text-forest">{coupon.code}</strong>
                    <span className="text-xs text-ink/55">{coupon.label}</span>
                    {isTemplateCoupon(coupon) && (
                      <span className="mt-2 inline-flex">
                        <AdminBadge tone="gold">Modele</AdminBadge>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4">{couponTypeLabel(coupon.discountType)}</td>
                  <td className="px-4 py-4">{couponValueLabel(coupon)}</td>
                  <td className="px-4 py-4">{formatEuro(Number(coupon.minimumOrder || 0))} EUR</td>
                  <td className="px-4 py-4">
                    {coupon.usedCount || 0}
                    {coupon.maxUses ? ` / ${coupon.maxUses}` : " / illimité"}
                  </td>
                  <td className="px-4 py-4 text-xs text-ink/60">
                    {coupon.startsAt || "Immédiat"} → {coupon.endsAt || "Sans fin"}
                  </td>
                  <td className="px-4 py-4">
                    <button onClick={() => void onToggle(coupon)}>
                      <AdminBadge tone={status.tone}>{status.label}</AdminBadge>
                    </button>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      <button className="btn-secondary min-h-9 px-3 py-2" onClick={() => onEdit(coupon)}>
                        Modifier
                      </button>
                      <button className="btn-secondary min-h-9 px-3 py-2" onClick={() => void onArchive(coupon)}>
                        Archiver
                      </button>
                      <button className="btn-secondary min-h-9 border-red-200 px-3 py-2 text-red-700" onClick={() => void onDelete(coupon)}>
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
    </section>
  );
}

function BannerPlacementSelector({
  banner,
  onChange,
}: {
  banner: PromoBannerInput;
  onChange: (banner: PromoBannerInput) => void;
}) {
  const selectedPlacements = bannerInputPlacements(banner);

  function togglePlacement(placement: PromoBannerPlacement) {
    let nextPlacements: PromoBannerPlacement[];
    if (placement === "all_public") {
      nextPlacements = selectedPlacements.includes("all_public") ? ["draft"] : ["all_public"];
    } else {
      nextPlacements = selectedPlacements
        .filter((entry) => entry !== "all_public" && entry !== "draft");
      if (selectedPlacements.includes(placement)) {
        nextPlacements = nextPlacements.filter((entry) => entry !== placement);
      } else {
        nextPlacements.push(placement);
      }
      if (!nextPlacements.length) nextPlacements = ["draft"];
    }

    onChange({
      ...banner,
      placement: nextPlacements.includes("all_public") ? "all_public" : nextPlacements[0],
      placements: nextPlacements,
    });
  }

  return (
    <fieldset className="rounded-md border border-forest/10 bg-cream p-4">
      <legend className="px-1 text-sm font-medium text-forest">Emplacements</legend>
      <p className="mt-1 text-xs leading-5 text-ink/55">
        Choisissez les pages publiques ou la banniere doit apparaitre.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {bannerPlacementOptions.map((option) => {
          const checked = selectedPlacements.includes(option.value);
          const disabled =
            selectedPlacements.includes("all_public") && option.value !== "all_public";
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${
                checked
                  ? "border-forest bg-forest text-ivory"
                  : "border-forest/15 bg-ivory text-forest hover:border-forest/40"
              } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
              onClick={() => togglePlacement(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-ink/55">
        Selection actuelle : {promoBannerPlacementsLabel({ ...banner, id: banner.id || "" } as PromoBanner)}
      </p>
    </fieldset>
  );
}

function PromoBannerForm({
  banner,
  coupons,
  onChange,
  onSubmit,
}: {
  banner: PromoBannerInput;
  coupons: Coupon[];
  onChange: (banner: PromoBannerInput) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <form onSubmit={onSubmit} className="admin-card h-fit">
      <h2 className="font-display text-3xl text-forest">
        {banner.id ? "Modifier une banniere" : "Creer une banniere"}
      </h2>
      <p className="mt-2 text-sm leading-6 text-ink/60">
        Les bannieres inactives, expirees ou archivees ne sont pas visibles cote client.
      </p>
      <div className="mt-5 grid gap-4">
        <Input
          label="Titre"
          value={banner.title}
          onChange={(title) => onChange({ ...banner, title })}
        />
        <Textarea
          label="Message court"
          value={banner.message}
          onChange={(message) => onChange({ ...banner, message })}
        />
        <p className="text-xs leading-5 text-ink/55">Gardez le message court et sans HTML.</p>
        <label className="text-sm font-medium text-forest">
          Type de banniere
          <select
            className="input-field mt-2"
            value={banner.type}
            onChange={(event) =>
              onChange({ ...banner, type: event.target.value as PromoBannerType })
            }
          >
            <option value="top_bar">Bandeau haut de page</option>
            <option value="shop_card">Encadre boutique</option>
            <option value="checkout_notice">Encart panier / checkout</option>
            <option value="modal">Modale legere</option>
          </select>
        </label>
        <BannerPlacementSelector banner={banner} onChange={onChange} />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Date de debut"
            value={dateInputValue(banner.startsAt)}
            onChange={(startsAt) => onChange({ ...banner, startsAt: startsAt || undefined })}
            type="date"
          />
          <Input
            label="Date de fin"
            value={dateInputValue(banner.endsAt)}
            onChange={(endsAt) => onChange({ ...banner, endsAt: endsAt || undefined })}
            type="date"
          />
        </div>
        <Input
          label="Bouton optionnel"
          value={banner.buttonLabel || ""}
          onChange={(buttonLabel) => onChange({ ...banner, buttonLabel })}
        />
        <Input
          label="Lien optionnel"
          value={banner.buttonUrl || ""}
          onChange={(buttonUrl) => onChange({ ...banner, buttonUrl })}
        />
        <label className="text-sm font-medium text-forest">
          Promotion liee optionnelle
          <select
            className="input-field mt-2"
            value={banner.linkedCouponId || ""}
            onChange={(event) =>
              onChange({
                ...banner,
                linkedCouponId: event.target.value,
                deletedLinkedCouponId: "",
              })
            }
          >
            <option value="">Aucune promotion liee</option>
            {coupons.map((coupon) => (
              <option key={coupon.id} value={coupon.id}>
                {coupon.label || coupon.code} ({coupon.id}) - {coupon.autoApply ? "automatique" : "code"}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs font-normal text-ink/55">
            Utilisez cette liaison pour une promotion automatique. Le code lie reste reserve aux codes manuels.
          </span>
        </label>
        <Input
          label="Code promo lie optionnel"
          value={banner.linkedPromoCode || ""}
          onChange={(linkedPromoCode) =>
            onChange({
              ...banner,
              linkedPromoCode: linkedPromoCode.toUpperCase().replace(/\s+/g, ""),
            })
          }
        />
        <label className="flex items-center gap-2 text-sm text-forest">
          <input
            type="checkbox"
            checked={banner.isActive}
            onChange={(event) => onChange({ ...banner, isActive: event.target.checked })}
          />
          Active
        </label>
        <div className="rounded-md border border-champagne/30 bg-cream p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-champagne">Apercu</p>
          <div className={`mt-3 rounded-md border p-4 ${adminBannerPreviewClass(banner.variant)}`}>
            <strong className="block text-forest">{banner.title || "Titre de la banniere"}</strong>
            <p className="mt-1 text-sm leading-6 text-ink/70">
              {banner.message || "Message visible cote client."}
            </p>
            {banner.linkedPromoCode && (
              <p className="mt-2 text-xs font-semibold text-forest">
                Code : {banner.linkedPromoCode}
              </p>
            )}
          </div>
        </div>
        <button
          className="btn-secondary min-h-10 justify-between px-3 py-2 text-sm"
          type="button"
          onClick={() => setShowAdvanced((value) => !value)}
        >
          Options avancees
          <span>{showAdvanced ? "Masquer" : "Afficher"}</span>
        </button>
        {showAdvanced && (
          <div className="grid gap-4 rounded-md border border-forest/10 bg-cream p-4">
            <label className="text-sm font-medium text-forest">
              Priorite
              <select
                className="input-field mt-2"
                value={priorityBucket(banner.priority)}
                onChange={(event) => onChange({ ...banner, priority: Number(event.target.value) })}
              >
                <option value={10}>Normale</option>
                <option value={50}>Importante</option>
                <option value={100}>Tres importante</option>
              </select>
              <span className="mt-1 block text-xs font-normal text-ink/55">
                Utile seulement si plusieurs bannieres sont actives au meme endroit.
              </span>
            </label>
            <label className="text-sm font-medium text-forest">
              Variante visuelle
              <select
                className="input-field mt-2"
                value={banner.variant}
                onChange={(event) =>
                  onChange({ ...banner, variant: event.target.value as PromoBannerVariant })
                }
              >
                <option value="default">Default</option>
                <option value="promo">Promo</option>
                <option value="delivery">Livraison</option>
                <option value="info">Info</option>
                <option value="warning">Avertissement</option>
              </select>
              <span className="mt-1 block text-xs font-normal text-ink/55">
                Change l'apparence de la banniere selon son usage.
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm text-forest">
              <input
                type="checkbox"
                checked={banner.dismissible}
                onChange={(event) =>
                  onChange({ ...banner, dismissible: event.target.checked })
                }
              />
              Refermable cote client
            </label>
            <p className="text-xs leading-5 text-ink/55">
              Si active, le client peut fermer la banniere. Elle ne reapparaitra
              plus immediatement sur ce navigateur.
            </p>
          </div>
        )}
        <button className="btn-primary" type="submit">
          Enregistrer la banniere
        </button>
      </div>
    </form>
  );
}

function PromoBannersTable({
  banners,
  coupons,
  onEdit,
  onToggle,
  onArchive,
  onDelete,
}: {
  banners: PromoBanner[];
  coupons: Coupon[];
  onEdit: (banner: PromoBannerInput) => void;
  onToggle: (banner: PromoBanner) => Promise<void>;
  onArchive: (banner: PromoBanner) => Promise<void>;
  onDelete: (banner: PromoBanner) => Promise<void>;
}) {
  const activeCount = banners.filter(
    (banner) => promoBannerVisibility(banner, {
      linkedCoupon: findLinkedCoupon(coupons, banner) || null,
    }).visible,
  ).length;
  const archivedCount = banners.filter((banner) => banner.isArchived).length;
  const scheduledCount = banners.filter((banner) => promoBannerStatus(banner).label === "Programmée").length;

  return (
    <section className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        <article className="admin-card">
          <p className="text-sm text-ink/55">Bannieres actives</p>
          <strong className="mt-2 block font-display text-3xl text-forest">{activeCount}</strong>
        </article>
        <article className="admin-card">
          <p className="text-sm text-ink/55">Programmees</p>
          <strong className="mt-2 block font-display text-3xl text-forest">{scheduledCount}</strong>
        </article>
        <article className="admin-card">
          <p className="text-sm text-ink/55">Archivees</p>
          <strong className="mt-2 block font-display text-3xl text-forest">{archivedCount}</strong>
        </article>
      </div>
      <section className="overflow-hidden rounded-lg border border-forest/10 bg-ivory">
        {!banners.length && (
          <AdminEmptyState
            title="Aucune banniere pour le moment."
            description="Creez un bandeau discret, un encadre boutique ou un message checkout."
          />
        )}
        {!!banners.length && (
          <div className="grid gap-3 p-3 lg:hidden">
            {banners.map((banner) => (
              <PromoBannerCard
                key={banner.id}
                banner={banner}
                coupons={coupons}
                onEdit={onEdit}
                  onToggle={onToggle}
                  onArchive={onArchive}
                  onDelete={onDelete}
                />
            ))}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="hidden w-full min-w-[1120px] text-left text-sm lg:table">
            <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
              <tr>
                {[
                  "Titre",
                  "Type",
                  "Emplacement",
                  "Dates",
                  "Promotion",
                  "Priorite",
                  "Visibilite",
                  "Actions",
                ].map((header) => (
                  <th key={header} className="px-4 py-3 font-medium">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {banners.map((banner) => {
                const linkedCoupon = findLinkedCoupon(coupons, banner);
                const status = promoBannerVisibility(banner, {
                  linkedCoupon: linkedCoupon || null,
                });
                const linkedCouponInactive = Boolean(
                  (banner.linkedCouponId || banner.linkedPromoCode || banner.deletedLinkedCouponId) &&
                    !status.visible,
                );
                return (
                  <tr key={banner.id} className="border-t border-forest/10">
                    <td className="px-4 py-4">
                      <strong className="block text-forest">{banner.title}</strong>
                      <span className="line-clamp-2 text-xs text-ink/55">{banner.message}</span>
                      {banner.isTemplate && (
                        <span className="mt-2 inline-flex">
                          <AdminBadge tone="gold">Modele</AdminBadge>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4">{promoBannerTypeLabel(banner.type)}</td>
                    <td className="px-4 py-4">{promoBannerPlacementsLabel(banner)}</td>
                    <td className="px-4 py-4 text-xs text-ink/60">
                      {banner.startsAt || "Immediat"} - {banner.endsAt || "Sans fin"}
                    </td>
                    <td className="px-4 py-4">
                      {linkedCoupon ? (
                        <div className="grid gap-1">
                          <span>{linkedCoupon.label || linkedCoupon.code}</span>
                          <span className="text-xs text-ink/55">
                            {linkedCoupon.id} - {linkedCoupon.autoApply ? "automatique" : "code"}
                          </span>
                        </div>
                      ) : banner.deletedLinkedCouponId ? (
                        <span>Supprimee : {banner.deletedLinkedCouponId}</span>
                      ) : banner.linkedPromoCode ? (
                        <span>Code : {banner.linkedPromoCode}</span>
                      ) : (
                        "-"
                      )}
                      {linkedCouponInactive && (
                        <span className="mt-2 block">
                          <AdminBadge tone="warning">{status.label}</AdminBadge>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4">{promoBannerPriorityLabel(banner.priority)}</td>
                    <td className="px-4 py-4">
                      <button type="button" onClick={() => void onToggle(banner)}>
                        <AdminBadge tone={status.tone}>{status.label}</AdminBadge>
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button className="btn-secondary min-h-9 px-3 py-2" onClick={() => onEdit(banner)}>
                          Modifier
                        </button>
                        <button className="btn-secondary min-h-9 px-3 py-2" onClick={() => void onArchive(banner)}>
                          Archiver
                        </button>
                        <button className="btn-secondary min-h-9 border-red-200 px-3 py-2 text-red-700" onClick={() => void onDelete(banner)}>
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

function PromoBannerCard({
  banner,
  coupons,
  onEdit,
  onToggle,
  onArchive,
  onDelete,
}: {
  banner: PromoBanner;
  coupons: Coupon[];
  onEdit: (banner: PromoBannerInput) => void;
  onToggle: (banner: PromoBanner) => Promise<void>;
  onArchive: (banner: PromoBanner) => Promise<void>;
  onDelete: (banner: PromoBanner) => Promise<void>;
}) {
  const linkedCoupon = findLinkedCoupon(coupons, banner);
  const status = promoBannerVisibility(banner, {
    linkedCoupon: linkedCoupon || null,
  });
  const linkedCouponInactive = Boolean(
    (banner.linkedCouponId || banner.linkedPromoCode || banner.deletedLinkedCouponId) &&
      !status.visible,
  );
  return (
    <article className="rounded-lg border border-forest/10 bg-ivory p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <strong className="block text-forest">{banner.title}</strong>
          <span className="text-xs text-ink/55">
            {promoBannerTypeLabel(banner.type)} - {promoBannerPlacementsLabel(banner)}
          </span>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {banner.isTemplate && <AdminBadge tone="gold">Modele</AdminBadge>}
          <AdminBadge tone={status.tone}>{status.label}</AdminBadge>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-ink/70">{banner.message}</p>
      <p className="mt-2 text-xs text-ink/55">
        Priorite {promoBannerPriorityLabel(banner.priority)} - {banner.startsAt || "Immediat"} -{" "}
        {banner.endsAt || "Sans fin"}
      </p>
      {(banner.linkedCouponId || banner.linkedPromoCode || banner.deletedLinkedCouponId) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-forest">
          <span>
            {linkedCoupon
              ? `${linkedCoupon.label || linkedCoupon.code} (${linkedCoupon.id})`
              : banner.deletedLinkedCouponId
                ? `Promotion supprimee : ${banner.deletedLinkedCouponId}`
                : `Code : ${banner.linkedPromoCode}`}
          </span>
          {linkedCouponInactive && <AdminBadge tone="warning">{status.label}</AdminBadge>}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" onClick={() => onEdit(banner)}>
          Modifier
        </button>
        <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" onClick={() => void onToggle(banner)}>
          {banner.isActive ? "Desactiver" : "Activer"}
        </button>
        <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" onClick={() => void onArchive(banner)}>
          Archiver
        </button>
        <button className="btn-secondary min-h-9 border-red-200 px-3 py-1.5 text-xs text-red-700" onClick={() => void onDelete(banner)}>
          Supprimer
        </button>
      </div>
    </article>
  );
}

function CustomersTable({
  customers,
  orders,
  coupons,
  onAdjustPoints,
  onNote,
  onAssignPromo,
  onStatusUpdate,
}: {
  customers: CustomerProfile[];
  orders: AdminOrderRow[];
  coupons: Coupon[];
  onAdjustPoints: (customer: CustomerProfile) => Promise<void>;
  onNote: (customer: CustomerProfile, note: string) => Promise<void>;
  onAssignPromo: (customer: CustomerProfile, couponId: string, note: string) => Promise<void>;
  onStatusUpdate: (
    customer: CustomerProfile,
    data: { status?: CustomerProfile["status"]; archived?: boolean; hidden?: boolean },
  ) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CustomerFilter>("active");
  const [sort, setSort] = useState<CustomerSort>("lastOrder");
  const [selectedCustomerId, setSelectedCustomerId] = useState(customers[0]?.id || "");
  const [promoCouponId, setPromoCouponId] = useState(coupons[0]?.id || "");
  const [promoNote, setPromoNote] = useState("");
  const [details, setDetails] = useState<CustomerAdminDetails>({
    loyaltyMovements: [],
    favorites: [],
    reviews: [],
  });
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) || customers[0];
  const selectedOrders = selectedCustomer ? ordersForCustomer(orders, selectedCustomer) : [];
  const selectedStats = selectedCustomer ? customerStats(selectedCustomer, selectedOrders) : null;

  useEffect(() => {
    if (!selectedCustomerId && customers[0]?.id) {
      setSelectedCustomerId(customers[0].id);
    }
  }, [customers, selectedCustomerId]);

  useEffect(() => {
    if (!selectedCustomer) {
      setDetails({ loyaltyMovements: [], favorites: [], reviews: [] });
      return;
    }
    let cancelled = false;
    void getCustomerAdminDetails(selectedCustomer).then((nextDetails) => {
      if (!cancelled) setDetails(nextDetails);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedCustomer]);

  const enrichedCustomers = useMemo(
    () =>
      customers.map((customer) => {
        const customerOrders = ordersForCustomer(orders, customer);
        return {
          customer,
          orders: customerOrders,
          stats: customerStats(customer, customerOrders),
        };
      }),
    [customers, orders],
  );

  const visibleCustomers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return enrichedCustomers
      .filter(({ customer, orders: customerOrders, stats }) => {
        const haystack = [
          customer.displayName,
          customer.email,
          customer.phone,
          customer.internalNote,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (normalizedSearch && !haystack.includes(normalizedSearch)) return false;
        if (filter === "archived") return customer.archived === true || customer.status === "archived";
        if (customer.archived || customer.hidden) return false;
        if (filter === "loyal") return customerStatus(customer, customerOrders).label === "Fidele";
        if (filter === "new") return customerStatus(customer, customerOrders).label === "Nouveau";
        if (filter === "withOrders") return customerOrders.length > 0;
        if (filter === "withoutOrders") return customerOrders.length === 0;
        if (filter === "withNote") return Boolean(customer.internalNote?.trim());
        if (filter === "withPromo") return Boolean(customer.assignedPromos?.some((promo) => promo.isActive));
        if (filter === "watch") return customer.status === "watch";
        if (filter === "all") return true;
        return stats.status.label !== "Archive";
      })
      .sort((left, right) => sortCustomers(left, right, sort));
  }, [enrichedCustomers, filter, search, sort]);

  return (
    <section className="mt-8 space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard label="Clients" value={String(customers.length)} detail="Profils en base" />
        <AdminStatCard
          label="Avec commandes"
          value={String(enrichedCustomers.filter((entry) => entry.orders.length > 0).length)}
          detail="Historique disponible"
        />
        <AdminStatCard
          label="Clients fideles"
          value={String(enrichedCustomers.filter((entry) => entry.stats.status.label === "Fidele").length)}
          detail="3 commandes ou plus"
        />
        <AdminStatCard
          label="Promos attribuees"
          value={String(customers.reduce((sum, customer) => sum + (customer.assignedPromos?.length || 0), 0))}
          detail="Suivi interne"
        />
      </div>

      <div className="rounded-lg border border-forest/10 bg-ivory p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px]">
          <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-forest/60">
            Recherche
            <input
              className="input-field mt-2"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Nom, email, telephone, note"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-forest/60">
            Filtre
            <select
              className="input-field mt-2"
              value={filter}
              onChange={(event) => setFilter(event.currentTarget.value as CustomerFilter)}
            >
              {customerFilters.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-forest/60">
            Tri
            <select
              className="input-field mt-2"
              value={sort}
              onChange={(event) => setSort(event.currentTarget.value as CustomerSort)}
            >
              <option value="lastOrder">Derniere commande</option>
              <option value="totalSpent">Total depense</option>
              <option value="orderCount">Nombre de commandes</option>
              <option value="loyalty">Points fidelite</option>
              <option value="name">Alphabetique</option>
            </select>
          </label>
        </div>
      </div>

      {!customers.length && (
        <AdminEmptyState
          title="Aucun client pour le moment."
          description="Les profils clients apparaitront ici apres inscription ou commande connectee."
        />
      )}
      {!!customers.length && (
        <div className="grid gap-5 2xl:grid-cols-[minmax(360px,520px)_1fr]">
          <div className="space-y-3">
            {!visibleCustomers.length && (
              <AdminEmptyState
                title="Aucun client pour ce filtre."
                description="Changez de filtre ou consultez tous les clients."
                action={
                  <button className="btn-secondary mt-3" onClick={() => setFilter("all")} type="button">
                    Voir tous
                  </button>
                }
              />
            )}
            {visibleCustomers.map(({ customer, stats }) => {
              const status = stats.status;
              const selected = selectedCustomer?.id === customer.id;
              return (
                <article
                  key={customer.id}
                  className={`rounded-lg border p-3 transition ${
                    selected
                      ? "border-champagne bg-cream shadow-sm"
                      : "border-forest/10 bg-ivory hover:border-champagne/60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block truncate text-forest">
                        {customer.displayName || "Client sans nom"}
                      </strong>
                      <span className="mt-1 block break-all text-xs text-ink/60">
                        {customer.email || "Email non renseigne"}
                      </span>
                      <span className="block text-xs text-ink/60">
                        {customer.phone || "Telephone non renseigne"}
                      </span>
                    </div>
                    <AdminBadge tone={status.tone}>{status.label}</AdminBadge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/60">
                    <span>Commandes : {stats.orderCount}</span>
                    <span>Total : {formatEuro(stats.totalSpent)} EUR</span>
                    <span>Derniere : {stats.lastOrderLabel}</span>
                    <span>Points : {customer.loyaltyPoints || 0}</span>
                  </div>
                  {customer.internalNote && (
                    <p className="mt-2 line-clamp-2 rounded-md bg-ivory px-3 py-2 text-xs text-ink/65">
                      {customer.internalNote}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
                      type="button"
                      onClick={() => setSelectedCustomerId(customer.id)}
                    >
                      Voir fiche
                    </button>
                    <button
                      className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
                      type="button"
                      onClick={() => void onAdjustPoints(customer)}
                    >
                      Ajuster points
                    </button>
                    <button
                      className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
                      type="button"
                      onClick={() => void onStatusUpdate(customer, { archived: true, status: "archived" })}
                    >
                      Archiver
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {selectedCustomer && selectedStats && (
            <CustomerDetailPanel
              customer={selectedCustomer}
              orders={selectedOrders}
              stats={selectedStats}
              coupons={coupons}
              details={details}
              promoCouponId={promoCouponId}
              promoNote={promoNote}
              onPromoCouponChange={setPromoCouponId}
              onPromoNoteChange={setPromoNote}
              onAssignPromo={async () => {
                if (!promoCouponId) return;
                await onAssignPromo(selectedCustomer, promoCouponId, promoNote);
                setPromoNote("");
              }}
              onAdjustPoints={() => onAdjustPoints(selectedCustomer)}
              onNote={(note) => onNote(selectedCustomer, note)}
              onStatusUpdate={(data) => onStatusUpdate(selectedCustomer, data)}
            />
          )}
        </div>
      )}
    </section>
  );
}

type CustomerFilter =
  | "active"
  | "all"
  | "new"
  | "loyal"
  | "watch"
  | "withOrders"
  | "withoutOrders"
  | "withNote"
  | "withPromo"
  | "archived";

type CustomerSort = "lastOrder" | "totalSpent" | "orderCount" | "loyalty" | "name";

const customerFilters: { value: CustomerFilter; label: string }[] = [
  { value: "active", label: "Actifs" },
  { value: "new", label: "Nouveaux" },
  { value: "loyal", label: "Fideles" },
  { value: "watch", label: "A suivre" },
  { value: "withOrders", label: "Avec commandes" },
  { value: "withoutOrders", label: "Sans commande" },
  { value: "withNote", label: "Avec note" },
  { value: "withPromo", label: "Avec promo" },
  { value: "archived", label: "Archives" },
  { value: "all", label: "Tous" },
];

function CustomerDetailPanel({
  customer,
  orders,
  stats,
  coupons,
  details,
  promoCouponId,
  promoNote,
  onPromoCouponChange,
  onPromoNoteChange,
  onAssignPromo,
  onAdjustPoints,
  onNote,
  onStatusUpdate,
}: {
  customer: CustomerProfile;
  orders: AdminOrderRow[];
  stats: CustomerComputedStats;
  coupons: Coupon[];
  details: CustomerAdminDetails;
  promoCouponId: string;
  promoNote: string;
  onPromoCouponChange: (couponId: string) => void;
  onPromoNoteChange: (note: string) => void;
  onAssignPromo: () => Promise<void>;
  onAdjustPoints: () => Promise<void>;
  onNote: (note: string) => Promise<void>;
  onStatusUpdate: (data: {
    status?: CustomerProfile["status"];
    archived?: boolean;
    hidden?: boolean;
  }) => Promise<void>;
}) {
  const [draftNote, setDraftNote] = useState(customer.internalNote || "");

  useEffect(() => {
    setDraftNote(customer.internalNote || "");
  }, [customer.id, customer.internalNote]);

  return (
    <article className="rounded-lg border border-forest/10 bg-ivory p-3 shadow-sm lg:p-4">
      <div className="flex flex-col justify-between gap-3 border-b border-forest/10 pb-3 xl:flex-row xl:items-start">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-champagne">Fiche client</p>
          <h2 className="mt-1 font-display text-2xl text-forest">
            {customer.displayName || "Client sans nom"}
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <AdminBadge tone={stats.status.tone}>{stats.status.label}</AdminBadge>
            {customer.archived && <AdminBadge tone="muted">Archive</AdminBadge>}
            {customer.hidden && <AdminBadge tone="muted">Masque</AdminBadge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary min-h-9 px-3 py-1.5 text-xs" type="button" onClick={onAdjustPoints}>
            Ajuster points
          </button>
          {customer.archived || customer.hidden ? (
            <button
              className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
              type="button"
              onClick={() => void onStatusUpdate({ archived: false, hidden: false, status: "active" })}
            >
              Restaurer
            </button>
          ) : (
            <>
              <button
                className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
                type="button"
                onClick={() => void onStatusUpdate({ hidden: true })}
              >
                Masquer
              </button>
              <button
                className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
                type="button"
                onClick={() => void onStatusUpdate({ archived: true, status: "archived" })}
              >
                Archiver
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <MiniCustomerMetric label="Commandes" value={String(stats.orderCount)} />
        <MiniCustomerMetric label="Total depense" value={`${formatEuro(stats.totalSpent)} EUR`} />
        <MiniCustomerMetric label="Panier moyen" value={`${formatEuro(stats.averageCart)} EUR`} />
        <MiniCustomerMetric label="Derniere commande" value={stats.lastOrderLabel} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border border-forest/10 bg-cream p-3">
          <h3 className="font-semibold text-forest">Informations generales</h3>
          <dl className="mt-3 space-y-1.5 text-sm text-ink/70">
            <InfoRow label="Email" value={customer.email || "Email non renseigne"} />
            <InfoRow label="Telephone" value={customer.phone || "Telephone non renseigne"} />
            <InfoRow label="Compte cree" value={formatAdminDate(customer.createdAt) || "Non renseigne"} />
            <InfoRow label="Derniere mise a jour" value={formatAdminDate(customer.updatedAt) || "Non renseigne"} />
            <InfoRow label="Points fidelite" value={`${customer.loyaltyPoints || 0} point(s)`} />
          </dl>
          <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.14em] text-forest/60">
            Statut client
            <select
              className="input-field mt-2"
              value={customer.status || stats.status.value}
              onChange={(event) =>
                void onStatusUpdate({ status: event.currentTarget.value as CustomerProfile["status"] })
              }
            >
              <option value="new">Nouveau</option>
              <option value="active">Actif</option>
              <option value="loyal">Fidele</option>
              <option value="watch">A suivre</option>
              <option value="archived">Archive</option>
            </select>
          </label>
        </section>

        <section className="rounded-lg border border-forest/10 bg-cream p-3">
          <h3 className="font-semibold text-forest">Note interne</h3>
          <textarea
            className="input-field mt-3 min-h-20"
            value={draftNote}
            onChange={(event) => setDraftNote(event.currentTarget.value)}
            placeholder="Client prefere livraison locale le soir, a rappeler avant expedition..."
          />
          <button className="btn-primary mt-3 min-h-10 px-4 py-2 text-sm" type="button" onClick={() => void onNote(draftNote)}>
            Enregistrer note
          </button>
          <div className="mt-4 space-y-2">
            {(customer.internalNotes || []).slice(-3).reverse().map((note, index) => (
              <p key={`${note.createdAt || index}-${index}`} className="rounded-md bg-ivory px-3 py-2 text-xs text-ink/65">
                {note.note}
                <span className="mt-1 block text-ink/45">{formatAdminDate(note.createdAt)}</span>
              </p>
            ))}
            {!customer.internalNotes?.length && (
              <p className="text-sm text-ink/55">Aucune note historisee.</p>
            )}
          </div>
        </section>
      </div>

      <section className="mt-4 rounded-lg border border-forest/10 bg-cream p-3">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <h3 className="font-semibold text-forest">Promos attribuees</h3>
            <p className="mt-1 text-sm text-ink/60">
              Suivi interne uniquement. Cela ne limite pas automatiquement le code a ce client.
            </p>
          </div>
          <div className="grid gap-2 md:grid-cols-[220px_1fr_auto]">
            <select
              className="input-field"
              value={promoCouponId}
              onChange={(event) => onPromoCouponChange(event.currentTarget.value)}
            >
              {coupons.map((coupon) => (
                <option key={coupon.id} value={coupon.id}>
                  {coupon.code}
                </option>
              ))}
            </select>
            <input
              className="input-field"
              value={promoNote}
              onChange={(event) => onPromoNoteChange(event.currentTarget.value)}
              placeholder="Note attribution"
            />
            <button className="btn-secondary min-h-10 px-3 py-2 text-xs" type="button" onClick={() => void onAssignPromo()}>
              Attribuer
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {(customer.assignedPromos || []).map((promo) => (
            <span key={`${promo.code}-${promo.assignedAt}`} className="rounded-full border border-forest/10 bg-ivory px-3 py-2 text-xs text-forest">
              {promo.code} {promo.isActive ? "actif" : "inactif"}
            </span>
          ))}
          {!customer.assignedPromos?.length && (
            <p className="text-sm text-ink/55">Aucune promo attribuee.</p>
          )}
        </div>
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <CustomerOrdersPanel orders={orders} />
        <CustomerSignalsPanel
          favorites={details.favorites}
          reviews={details.reviews}
          loyaltyMovements={details.loyaltyMovements}
          customer={customer}
        />
      </div>
    </article>
  );
}

function CustomerOrdersPanel({ orders }: { orders: AdminOrderRow[] }) {
  return (
    <section className="rounded-lg border border-forest/10 bg-cream p-4">
      <h3 className="font-semibold text-forest">Historique commandes</h3>
      {!orders.length && <p className="mt-3 text-sm text-ink/55">Aucune commande liee.</p>}
      <div className="mt-3 space-y-3">
        {orders.slice(0, 8).map((order) => (
          <article key={order.id} className="rounded-md border border-forest/10 bg-ivory p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <strong className="block text-sm text-forest">{order.id}</strong>
                <span className="text-xs text-ink/55">{formatAdminDate(order.createdAt)}</span>
              </div>
              <strong className="text-sm text-forest">{order.total}</strong>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <AdminBadge tone={orderStatusTone(order.orderStatus)}>{orderStatusLabel(order.orderStatus)}</AdminBadge>
              <AdminBadge tone={paymentStatusTone(order.paymentStatus)}>{paymentStatusLabel(order.paymentStatus)}</AdminBadge>
              <AdminBadge tone={order.deliveryMethod === "postal" ? "neutral" : "gold"}>
                {order.deliveryMethod === "postal" ? "Postale" : "Locale"}
              </AdminBadge>
            </div>
            <p className="mt-2 text-xs text-ink/60">
              {order.items.map(formatOrderItemLine).join(", ") || "Produits non renseignes"}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function CustomerSignalsPanel({
  favorites,
  reviews,
  loyaltyMovements,
  customer,
}: {
  favorites: ProductFavorite[];
  reviews: ProductReview[];
  loyaltyMovements: LoyaltyMovement[];
  customer: CustomerProfile;
}) {
  return (
    <section className="rounded-lg border border-forest/10 bg-cream p-4">
      <h3 className="font-semibold text-forest">Favoris, avis et fidelite</h3>
      <div className="mt-4 space-y-4">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-forest/60">Favoris</h4>
          {favorites.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {favorites.slice(0, 8).map((favorite) => (
                <span key={favorite.id} className="rounded-full border border-forest/10 bg-ivory px-3 py-2 text-xs text-forest">
                  {favorite.productName}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink/55">Aucun favori.</p>
          )}
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-forest/60">Avis internes</h4>
          {reviews.length ? (
            <div className="mt-2 space-y-2">
              {reviews.slice(0, 3).map((review) => (
                <p key={review.id} className="rounded-md bg-ivory px-3 py-2 text-xs text-ink/65">
                  <strong className="text-forest">{review.productName} - {review.rating}/5</strong>
                  <span className="mt-1 block">{review.comment}</span>
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink/55">Aucun avis client.</p>
          )}
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-forest/60">Mouvements fidelite</h4>
          {loyaltyMovements.length || customer.loyaltyHistory?.length ? (
            <div className="mt-2 space-y-2">
              {(customer.loyaltyHistory || []).slice(-3).reverse().map((entry, index) => (
                <p key={`${entry.createdAt || index}-${index}`} className="rounded-md bg-ivory px-3 py-2 text-xs text-ink/65">
                  {entry.reason} : {entry.previousBalance} {"->"} {entry.nextBalance} point(s)
                  <span className="mt-1 block text-ink/45">{formatAdminDate(entry.createdAt)}</span>
                </p>
              ))}
              {!customer.loyaltyHistory?.length &&
                loyaltyMovements.slice(0, 3).map((movement) => (
                  <p key={movement.id} className="rounded-md bg-ivory px-3 py-2 text-xs text-ink/65">
                    {movement.points > 0 ? "+" : ""}
                    {movement.points} point(s) - {movement.note || movement.reason}
                  </p>
                ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink/55">Aucun mouvement fidelite.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function AdminStatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-forest/10 bg-ivory p-4">
      <span className="text-sm text-ink/55">{label}</span>
      <strong className="mt-2 block font-display text-3xl text-forest">{value}</strong>
      <span className="mt-1 block text-xs text-ink/55">{detail}</span>
    </div>
  );
}

function MiniCustomerMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-forest/10 bg-ivory px-3 py-2">
      <span className="block text-[11px] uppercase tracking-[0.12em] text-forest/50">{label}</span>
      <strong className="mt-1 block text-sm text-forest">{value}</strong>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3">
      <dt className="text-ink/45">{label}</dt>
      <dd className="break-words text-forest">{value}</dd>
    </div>
  );
}

type CustomerComputedStats = {
  orderCount: number;
  totalSpent: number;
  averageCart: number;
  lastOrderAt: number;
  lastOrderLabel: string;
  status: { value: NonNullable<CustomerProfile["status"]>; label: string; tone: AdminBadgeTone };
};

function ordersForCustomer(orders: AdminOrderRow[], customer: CustomerProfile) {
  const email = customer.email?.toLowerCase();
  const phone = normalizeCustomerPhone(customer.phone);
  const uid = customer.uid || customer.id;
  return orders.filter((order) => {
    if (order.customerId && uid && order.customerId === uid) return true;
    if (email && order.customerEmail?.toLowerCase() === email) return true;
    if (phone && normalizeCustomerPhone(order.customerPhone) === phone) return true;
    return false;
  });
}

function customerStats(customer: CustomerProfile, orders: AdminOrderRow[]): CustomerComputedStats {
  const orderCount = Math.max(Number(customer.orderCount || 0), orders.length);
  const orderTotal = orders.reduce((sum, order) => sum + parseEuro(order.total), 0);
  const totalSpent = Math.max(Number(customer.totalSpent || 0), orderTotal);
  const lastOrderAt = orders.reduce(
    (latest, order) => Math.max(latest, adminDateValue(order.createdAt)),
    0,
  );
  return {
    orderCount,
    totalSpent,
    averageCart: orderCount ? totalSpent / orderCount : 0,
    lastOrderAt,
    lastOrderLabel: lastOrderAt ? formatAdminDate(lastOrderAt) : "Aucune",
    status: customerStatus(customer, orders),
  };
}

function customerStatus(customer: CustomerProfile, orders: AdminOrderRow[]) {
  if (customer.archived || customer.status === "archived") {
    return { value: "archived" as const, label: "Archive", tone: "muted" as const };
  }
  if (customer.status === "watch") {
    return { value: "watch" as const, label: "A suivre", tone: "warning" as const };
  }
  if (customer.status === "loyal" || Number(customer.orderCount || orders.length) >= 3) {
    return { value: "loyal" as const, label: "Fidele", tone: "gold" as const };
  }
  if (customer.status === "active" || orders.length > 0 || Number(customer.orderCount || 0) > 0) {
    return { value: "active" as const, label: "Actif", tone: "success" as const };
  }
  return { value: "new" as const, label: "Nouveau", tone: "neutral" as const };
}

function sortCustomers(
  left: { customer: CustomerProfile; stats: CustomerComputedStats },
  right: { customer: CustomerProfile; stats: CustomerComputedStats },
  sort: CustomerSort,
) {
  if (sort === "totalSpent") return right.stats.totalSpent - left.stats.totalSpent;
  if (sort === "orderCount") return right.stats.orderCount - left.stats.orderCount;
  if (sort === "loyalty") {
    return Number(right.customer.loyaltyPoints || 0) - Number(left.customer.loyaltyPoints || 0);
  }
  if (sort === "name") {
    return (left.customer.displayName || left.customer.email || "").localeCompare(
      right.customer.displayName || right.customer.email || "",
      "fr",
    );
  }
  return right.stats.lastOrderAt - left.stats.lastOrderAt;
}

function normalizeCustomerPhone(value?: string) {
  return value?.replace(/\D/g, "") || "";
}

function formatAdminDate(value?: string | number | unknown) {
  const timestamp = adminDateValue(value);
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(timestamp));
}

function adminDateValue(value: unknown) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value) || 0;
  if (typeof value === "object" && "seconds" in value) {
    return Number((value as { seconds?: number }).seconds || 0) * 1000;
  }
  return 0;
}

function BillingWarning({ settings }: { settings: BillingSettings }) {
  if (settings.isManuallyValidated && settings.vatMode !== "not_configured") return null;
  return (
    <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-950">
      <strong className="block text-base">Verification facturation requise</strong>
      <p>{settings.validationWarning}</p>
      {settings.vatMode === "not_configured" && (
        <p className="mt-2">Le regime TVA n'est pas confirme.</p>
      )}
    </div>
  );
}

function AdminAnalyticsPanel() {
  const today = new Date().toISOString().slice(0, 10);
  const defaultStart = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - 29);
    return date.toISOString().slice(0, 10);
  }, []);
  const [preset, setPreset] = useState<AdminAnalyticsPreset>("30d");
  const [customStart, setCustomStart] = useState(defaultStart);
  const [customEnd, setCustomEnd] = useState(today);
  const [compare, setCompare] = useState(true);
  const [analytics, setAnalytics] = useState<AdminAnalyticsResponse | null>(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");

  const loadAnalytics = useCallback(async () => {
    setIsLoadingAnalytics(true);
    setAnalyticsError("");
    try {
      const payload = await getAdminAnalytics({
        preset,
        startDate: preset === "custom" ? customStart : undefined,
        endDate: preset === "custom" ? customEnd : undefined,
        compare,
      });
      setAnalytics(payload);
    } catch (error) {
      setAnalyticsError(error instanceof Error ? error.message : "Analytics indisponible.");
    } finally {
      setIsLoadingAnalytics(false);
    }
  }, [compare, customEnd, customStart, preset]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const summary = analytics?.summary;

  return (
    <section className="mt-8 grid gap-6">
      <div className="admin-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-champagne">
              Google Analytics 4
            </p>
            <h2 className="font-display text-3xl text-forest">Analytics</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink/60">
              Donnees agregees uniquement. Les routes admin et les domaines Vercel sont exclus des rapports.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary w-fit"
            onClick={() => void loadAnalytics()}
            disabled={isLoadingAnalytics}
          >
            {isLoadingAnalytics ? "Actualisation..." : "Actualiser"}
          </button>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {[
            { value: "7d", label: "7 jours" },
            { value: "30d", label: "30 jours" },
            { value: "90d", label: "90 jours" },
            { value: "custom", label: "Periode personnalisee" },
          ].map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={preset === filter.value ? "btn-primary min-h-9 px-3 py-1.5 text-xs" : "btn-secondary min-h-9 px-3 py-1.5 text-xs"}
              onClick={() => setPreset(filter.value as AdminAnalyticsPreset)}
            >
              {filter.label}
            </button>
          ))}
          <label className="inline-flex min-h-9 items-center gap-2 rounded-md border border-forest/15 bg-ivory px-3 py-1.5 text-xs font-semibold text-forest">
            <input
              type="checkbox"
              checked={compare}
              onChange={(event) => setCompare(event.target.checked)}
            />
            Comparer a la periode precedente
          </label>
        </div>
        {preset === "custom" && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Input label="Date de debut" type="date" value={customStart} onChange={setCustomStart} />
            <Input label="Date de fin" type="date" value={customEnd} onChange={setCustomEnd} />
          </div>
        )}
        {analytics && (
          <p className="mt-4 text-xs text-ink/55">
            Periode : {analytics.range.label}. Fraicheur standard : {formatDateTime(analytics.freshness.standardFetchedAt)}.
            Temps reel : {formatDateTime(analytics.freshness.realtimeFetchedAt)}.
          </p>
        )}
      </div>

      {analyticsError && (
        <AdminDataError message={analyticsError} onRetry={loadAnalytics} />
      )}

      {isLoadingAnalytics && !analytics && (
        <p className="text-sm text-forest/70">Chargement des donnees Analytics...</p>
      )}

      {analytics && !analytics.configured && (
        <AdminEmptyState
          title="Analytics GA4 non configure."
          description="Renseignez GA4_PROPERTY_ID et les identifiants Google serveur dans les variables Vercel pour afficher les rapports."
        />
      )}

      {analytics && !!analytics.notices.length && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="block">Informations GA4</strong>
          <span className="mt-1 block">{analytics.notices.join(" ")}</span>
        </div>
      )}

      {summary && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <AnalyticsMetricCard label="Utilisateurs actifs" value={formatInteger(summary.activeUsers)} comparison={analytics.comparison?.activeUsers} />
            <AnalyticsMetricCard label="Nouveaux utilisateurs" value={formatInteger(summary.newUsers)} comparison={analytics.comparison?.newUsers} />
            <AnalyticsMetricCard label="Sessions" value={formatInteger(summary.sessions)} comparison={analytics.comparison?.sessions} />
            <AnalyticsMetricCard label="Pages vues" value={formatInteger(summary.pageViews)} comparison={analytics.comparison?.pageViews} />
            <AnalyticsMetricCard label="Taux d'engagement" value={formatRate(summary.engagementRate)} comparison={analytics.comparison?.engagementRate} formatter={formatRate} />
            <AnalyticsMetricCard label="Duree moyenne d'engagement" value={formatDuration(summary.averageEngagementDurationSeconds)} comparison={analytics.comparison?.averageEngagementDurationSeconds} formatter={formatDuration} />
            <AnalyticsMetricCard label="Commandes soumises" value={formatInteger(summary.orderSubmittedCount)} comparison={analytics.comparison?.orderSubmittedCount} />
            <AnalyticsMetricCard label="Session vers commande" value={formatRate(summary.sessionToOrderRate)} comparison={analytics.comparison?.sessionToOrderRate} formatter={formatRate} />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <AnalyticsMetricCard
              label="Valeur des commandes soumises"
              value={formatCurrency(summary.orderSubmittedValue)}
              detail="Evenement order_submitted, non assimile a du chiffre d'affaires encaisse."
              comparison={analytics.comparison?.orderSubmittedValue}
              formatter={formatCurrency}
            />
            <AnalyticsMetricCard
              label="Revenu reellement paye"
              value={summary.purchaseRevenue == null ? "Non disponible" : formatCurrency(summary.purchaseRevenue)}
              detail="Affiche uniquement si l'evenement purchase est disponible."
              comparison={analytics.comparison?.purchaseRevenue ?? undefined}
              formatter={formatCurrency}
            />
          </div>
        </>
      )}

      {analytics && (
        <>
          <AnalyticsRealtimePanel analytics={analytics} />
          <AnalyticsAcquisitionPanel rows={analytics.acquisition} />
          <AnalyticsPagesPanel rows={analytics.pages} />
          <AnalyticsFunnelPanel rows={analytics.funnel} />
          <AnalyticsProductsPanel rows={analytics.products} />
          <AnalyticsContentPanel rows={analytics.content} />
          <AnalyticsDeliveryPanel rows={analytics.delivery} />
          <AnalyticsDevicesPanel rows={analytics.devices} />
        </>
      )}
    </section>
  );
}

function AnalyticsMetricCard({
  label,
  value,
  detail,
  comparison,
  formatter = formatInteger,
}: {
  label: string;
  value: string;
  detail?: string;
  comparison?: number | null;
  formatter?: (value: number) => string;
}) {
  return (
    <article className="admin-card min-h-32 border-forest/10 bg-ivory/95">
      <p className="text-sm text-ink/55">{label}</p>
      <strong className="mt-2 block font-display text-3xl text-forest">{value}</strong>
      <span className="text-xs text-ink/50">
        {detail || (comparison == null ? "Periode selectionnee" : `Precedent : ${formatter(comparison)}`)}
      </span>
    </article>
  );
}

function AnalyticsRealtimePanel({ analytics }: { analytics: AdminAnalyticsResponse }) {
  return (
    <section className="admin-card">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-champagne">Temps reel</p>
          <h2 className="font-display text-3xl text-forest">30 dernieres minutes</h2>
        </div>
        <strong className="font-display text-3xl text-forest">
          {formatInteger(analytics.realtime.activeUsers30Minutes)}
        </strong>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <AnalyticsSimpleList title="Pages actives" rows={analytics.realtime.pages} />
        <AnalyticsSimpleList title="Sources principales" rows={analytics.realtime.sources} />
      </div>
    </section>
  );
}

function AnalyticsSimpleList({
  title,
  rows,
}: {
  title: string;
  rows: { name: string; activeUsers: number }[];
}) {
  return (
    <div className="rounded-md border border-forest/10 bg-cream p-4">
      <h3 className="font-display text-2xl text-forest">{title}</h3>
      {!rows.length ? (
        <p className="mt-2 text-sm text-ink/60">Aucune donnee disponible.</p>
      ) : (
        <ul className="mt-3 grid gap-2 text-sm">
          {rows.map((row) => (
            <li key={row.name} className="flex items-center justify-between gap-3">
              <span className="truncate">{row.name}</span>
              <AdminBadge tone="gold">{formatInteger(row.activeUsers)}</AdminBadge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AnalyticsAcquisitionPanel({
  rows,
}: {
  rows: AdminAnalyticsResponse["acquisition"];
}) {
  return (
    <section className="admin-card">
      <p className="text-xs uppercase tracking-[0.16em] text-champagne">Acquisition</p>
      <h2 className="font-display text-3xl text-forest">Sources de trafic</h2>
      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <AnalyticsNamedTable title="Groupes de canaux" rows={rows.channels} />
        <AnalyticsNamedTable title="Source / support" rows={rows.sourceMediums} />
        <AnalyticsNamedTable title="Campagnes" rows={rows.campaigns} />
      </div>
    </section>
  );
}

function AnalyticsNamedTable({
  title,
  rows,
}: {
  title: string;
  rows: AdminAnalyticsNamedRow[];
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-forest/10">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
          <tr>
            <th className="px-3 py-3 font-medium">{title}</th>
            <th className="px-3 py-3 font-medium">Utilisateurs</th>
            <th className="px-3 py-3 font-medium">Sessions</th>
            <th className="px-3 py-3 font-medium">Commandes</th>
            <th className="px-3 py-3 font-medium">Conversion</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row) => (
            <tr key={row.name} className="border-t border-forest/10">
              <td className="px-3 py-3">{row.name}</td>
              <td className="px-3 py-3">{formatInteger(row.users)}</td>
              <td className="px-3 py-3">{formatInteger(row.sessions)}</td>
              <td className="px-3 py-3">{formatInteger(row.ordersSubmitted)}</td>
              <td className="px-3 py-3">{formatRate(row.conversionRate)}</td>
            </tr>
          )) : (
            <tr><td className="px-3 py-4 text-ink/60" colSpan={5}>Aucune donnee disponible.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AnalyticsPagesPanel({ rows }: { rows: AdminAnalyticsPageRow[] }) {
  return (
    <AnalyticsTableSection title="Pages" eyebrow="Navigation">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
          <tr>
            {["Chemin", "Titre", "Vues", "Utilisateurs", "Engagement", "Duree moyenne"].map((header) => (
              <th key={header} className="px-4 py-3 font-medium">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {analyticsRowsOrEmpty(rows, 6, (row) => (
            <tr key={`${row.path}-${row.title}`} className="border-t border-forest/10">
              <td className="px-4 py-4 font-mono text-xs">{row.path}</td>
              <td className="px-4 py-4">{row.title}</td>
              <td className="px-4 py-4">{formatInteger(row.views)}</td>
              <td className="px-4 py-4">{formatInteger(row.users)}</td>
              <td className="px-4 py-4">{formatRate(row.engagementRate)}</td>
              <td className="px-4 py-4">{formatDuration(row.averageEngagementDurationSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </AnalyticsTableSection>
  );
}

function AnalyticsFunnelPanel({ rows }: { rows: AdminAnalyticsFunnelStep[] }) {
  return (
    <AnalyticsTableSection
      title="Parcours d'evenements"
      eyebrow="Activite non sequentielle"
      description="Chaque ligne est un volume d'evenements independant. Un meme utilisateur peut declencher plusieurs fois une etape : les ratios comparent les volumes, pas des utilisateurs uniques."
    >
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
          <tr>
            {["Etape", "Evenement", "Volume", "Ratio volume precedent", "Ratio volume depart"].map((header) => (
              <th key={header} className="px-4 py-3 font-medium">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {analyticsRowsOrEmpty(rows, 5, (row) => (
            <tr key={row.eventName} className="border-t border-forest/10">
              <td className="px-4 py-4">{row.label}</td>
              <td className="px-4 py-4 font-mono text-xs">{row.eventName}</td>
              <td className="px-4 py-4">{formatInteger(row.count)}</td>
              <td className="px-4 py-4">{formatRate(row.rateFromPrevious)}</td>
              <td className="px-4 py-4">{formatRate(row.rateFromStart)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </AnalyticsTableSection>
  );
}

function AnalyticsProductsPanel({ rows }: { rows: AdminAnalyticsProductRow[] }) {
  return (
    <AnalyticsTableSection
      title="Produits"
      eyebrow="Catalogue"
      description="Volumes GA4 d'articles : pour les produits au poids, une unite ajoutee peut correspondre a un gramme. Ces nombres ne sont donc pas des visiteurs ni des taux de conversion."
    >
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
          <tr>
            {["Produit", "Unites vues", "Unites ajoutees", "Favoris", "Commandes", "Unites achetees"].map((header) => (
              <th key={header} className="px-4 py-3 font-medium">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {analyticsRowsOrEmpty(rows, 6, (row) => (
            <tr key={row.name} className="border-t border-forest/10">
              <td className="px-4 py-4">{row.name}</td>
              <td className="px-4 py-4">{formatInteger(row.views)}</td>
              <td className="px-4 py-4">{formatInteger(row.addToCart)}</td>
              <td className="px-4 py-4">{formatNullableInteger(row.favorites)}</td>
              <td className="px-4 py-4">{formatNullableInteger(row.ordersSubmitted)}</td>
              <td className="px-4 py-4">{formatInteger(row.paidPurchases)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </AnalyticsTableSection>
  );
}

function AnalyticsContentPanel({ rows }: { rows: AdminAnalyticsContentRow[] }) {
  return (
    <AnalyticsTableSection title="Contenus" eyebrow="Blog">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
          <tr>
            {["Article", "Chemin", "Vues", "Article views", "Progression 50 %", "Progression 90 %", "Clics boutique"].map((header) => (
              <th key={header} className="px-4 py-3 font-medium">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {analyticsRowsOrEmpty(rows, 7, (row) => (
            <tr key={row.path} className="border-t border-forest/10">
              <td className="px-4 py-4">{row.title}</td>
              <td className="px-4 py-4 font-mono text-xs">{row.path}</td>
              <td className="px-4 py-4">{formatInteger(row.views)}</td>
              <td className="px-4 py-4">{formatInteger(row.articleViews)}</td>
              <td className="px-4 py-4">{formatNullableInteger(row.progress50)}</td>
              <td className="px-4 py-4">{formatNullableInteger(row.progress90)}</td>
              <td className="px-4 py-4">{formatNullableInteger(row.shopClicks)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </AnalyticsTableSection>
  );
}

function AnalyticsDeliveryPanel({
  rows,
}: {
  rows: AdminAnalyticsResponse["delivery"];
}) {
  return (
    <section className="admin-card">
      <p className="text-xs uppercase tracking-[0.16em] text-champagne">Livraison</p>
      <h2 className="font-display text-3xl text-forest">Choix client</h2>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <AnalyticsCountTable title="Methodes" rows={rows.methods} />
        <AnalyticsCountTable title="Zones locales" rows={rows.localZones} />
        <AnalyticsCountTable title="Reglements selectionnes" rows={rows.paymentMethods} />
      </div>
    </section>
  );
}

function AnalyticsCountTable({ title, rows }: { title: string; rows: AdminAnalyticsDeliveryRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-forest/10">
      <table className="w-full min-w-[360px] text-left text-sm">
        <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
          <tr>
            <th className="px-3 py-3 font-medium">{title}</th>
            <th className="px-3 py-3 font-medium">Volume</th>
          </tr>
        </thead>
        <tbody>
          {analyticsRowsOrEmpty(rows, 2, (row) => (
            <tr key={row.name} className="border-t border-forest/10">
              <td className="px-3 py-3">{row.name}</td>
              <td className="px-3 py-3">{formatInteger(row.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnalyticsDevicesPanel({ rows }: { rows: AdminAnalyticsDeviceRow[] }) {
  return (
    <AnalyticsTableSection title="Appareils" eyebrow="Technique">
      <table className="w-full min-w-[620px] text-left text-sm">
        <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
          <tr>
            {["Appareil", "Utilisateurs", "Sessions", "Engagement"].map((header) => (
              <th key={header} className="px-4 py-3 font-medium">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {analyticsRowsOrEmpty(rows, 4, (row) => (
            <tr key={row.device} className="border-t border-forest/10">
              <td className="px-4 py-4">{row.device}</td>
              <td className="px-4 py-4">{formatInteger(row.users)}</td>
              <td className="px-4 py-4">{formatInteger(row.sessions)}</td>
              <td className="px-4 py-4">{formatRate(row.engagementRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </AnalyticsTableSection>
  );
}

function AnalyticsTableSection({
  title,
  eyebrow,
  description,
  children,
}: {
  title: string;
  eyebrow: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="admin-card">
      <p className="text-xs uppercase tracking-[0.16em] text-champagne">{eyebrow}</p>
      <h2 className="font-display text-3xl text-forest">{title}</h2>
      {description && <p className="mt-2 max-w-4xl text-sm leading-6 text-ink/60">{description}</p>}
      <div className="mt-5 overflow-x-auto">{children}</div>
    </section>
  );
}

function analyticsRowsOrEmpty<T>(
  rows: T[],
  colSpan: number,
  renderRow: (row: T) => ReactNode,
) {
  return rows.length ? rows.map(renderRow) : (
    <tr>
      <td className="px-4 py-4 text-ink/60" colSpan={colSpan}>Aucune donnee disponible.</td>
    </tr>
  );
}

type AccountingPeriodFilter = "week" | "month" | "year" | "custom";
type AccountingTab = "synthese" | "marges" | "achats" | "couts" | "factures" | "facturation";

const accountingTabs: Array<{ value: AccountingTab; label: string }> = [
  { value: "synthese", label: "Synthèse" },
  { value: "marges", label: "Marges par produit" },
  { value: "achats", label: "Achats fournisseurs" },
  { value: "couts", label: "Coûts manuels / g" },
  { value: "factures", label: "Factures" },
  { value: "facturation", label: "Facturation" },
];

function normalizeAccountingTab(value: string | null): AccountingTab {
  return value === "marges" ||
    value === "achats" ||
    value === "couts" ||
    value === "factures" ||
    value === "facturation"
    ? value
    : "synthese";
}

function AccountingPanel({
  products,
  productCosts,
  productCostsSource,
  productCostsError,
  supplierPurchases,
  supplierPurchasesSource,
  supplierPurchasesError,
  orders,
  invoices,
  invoiceSource,
  billingSettings,
  billingSource,
  editingBilling,
  onBillingChange,
  onRetry,
  onCreateManualInvoice,
  onInvoiceStatus,
  onInvoiceDownload,
  onInvoiceSend,
  onBillingSubmit,
  onSaveProductCost,
  onSaveSupplierPurchase,
  onSaveSupplierAlias,
  onDeleteSupplierPurchase,
  onCancelSupplierPurchase,
}: {
  products: Product[];
  productCosts: ProductCost[];
  productCostsSource: string;
  productCostsError: string;
  supplierPurchases: SupplierPurchase[];
  supplierPurchasesSource: string;
  supplierPurchasesError: string;
  orders: AdminOrderRow[];
  invoices: Invoice[];
  invoiceSource: string;
  billingSettings: BillingSettings;
  billingSource: string;
  editingBilling: BillingSettings;
  onBillingChange: (settings: BillingSettings) => void;
  onRetry: () => Promise<void>;
  onCreateManualInvoice: (input: ManualInvoiceInput) => Promise<void>;
  onInvoiceStatus: (invoice: Invoice, status: InvoiceStatus) => Promise<void>;
  onInvoiceDownload: (invoice: Invoice) => Promise<void>;
  onInvoiceSend: (invoice: Invoice) => Promise<void>;
  onBillingSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onSaveProductCost: (productId: string, purchasePricePerGram: number | null) => Promise<void>;
  onSaveSupplierPurchase: (purchase: Partial<SupplierPurchase>) => Promise<void>;
  onSaveSupplierAlias: (alias: { supplierName: string; originalLabel: string; productId: string }) => Promise<void>;
  onDeleteSupplierPurchase: (purchase: SupplierPurchase) => Promise<void>;
  onCancelSupplierPurchase: (purchase: SupplierPurchase) => Promise<void>;
}) {
  const [period, setPeriod] = useState<AccountingPeriodFilter>("month");
  const todayInput = toDateInputValue(new Date());
  const [customStart, setCustomStart] = useState(todayInput);
  const [customEnd, setCustomEnd] = useState(todayInput);
  const [costFilter, setCostFilter] = useState<ProductCostFilter>("all");
  const [editingSupplierPurchase, setEditingSupplierPurchase] =
    useState<Partial<SupplierPurchase> | null>(null);
  const productCostMap = useMemo(
    () => new Map(productCosts.map((cost) => [cost.productId, cost])),
    [productCosts],
  );
  const weightedSupplierCosts = useMemo(
    () => computeWeightedSupplierCosts(supplierPurchases).costByProductId,
    [supplierPurchases],
  );
  const productCostFilters = useMemo(
    () => buildProductCostFilters(products, productCostMap, weightedSupplierCosts),
    [productCostMap, products, weightedSupplierCosts],
  );
  const filteredCostProducts = useMemo(
    () => products.filter((product) => productMatchesProductCostFilter(product, productCostMap, weightedSupplierCosts, costFilter)),
    [costFilter, productCostMap, products, weightedSupplierCosts],
  );
  const activeProductsMissingCost = useMemo(
    () => products.filter((product) => product.isActive && !weightedSupplierCosts.has(product.id) && productCostMap.get(product.id)?.purchasePricePerGram == null),
    [productCostMap, products, weightedSupplierCosts],
  );
  const periodRange = useMemo(
    () => currentLocalPeriodRange(period, customStart, customEnd),
    [customEnd, customStart, period],
  );
  const summary = useMemo(
    () => buildAccountingSummary(orders, products, productCostMap, supplierPurchases, weightedSupplierCosts, periodRange),
    [orders, periodRange, productCostMap, products, supplierPurchases, weightedSupplierCosts],
  );
  const previousSummary = useMemo(
    () => buildAccountingSummary(orders, products, productCostMap, supplierPurchases, weightedSupplierCosts, previousPeriodRange(periodRange)),
    [orders, periodRange, productCostMap, products, supplierPurchases, weightedSupplierCosts],
  );
  const periodFilters: Array<{ value: AccountingPeriodFilter; label: string }> = [
    { value: "week", label: "Semaine en cours" },
    { value: "month", label: "Mois en cours" },
    { value: "year", label: "Année en cours" },
  ];
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedAccountingTab = normalizeAccountingTab(searchParams.get("tab"));

  function setAccountingTab(tab: AccountingTab) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", tab);
    setSearchParams(nextParams);
  }

  function handleAccountingTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const lastIndex = accountingTabs.length - 1;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? lastIndex
          : event.key === "ArrowRight"
            ? currentIndex === lastIndex
              ? 0
              : currentIndex + 1
            : currentIndex === 0
              ? lastIndex
              : currentIndex - 1;
    setAccountingTab(accountingTabs[nextIndex].value);
  }

  return (
    <section className="mt-8 grid gap-6">
      <div className="overflow-x-auto rounded-lg border border-forest/10 bg-ivory p-2">
        <div className="flex min-w-max gap-2" role="tablist" aria-label="Navigation comptabilité">
          {accountingTabs.map((tab, index) => {
            const selected = selectedAccountingTab === tab.value;
            return (
              <button
                key={tab.value}
                id={`accounting-tab-${tab.value}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`accounting-panel-${tab.value}`}
                tabIndex={selected ? 0 : -1}
                className={
                  selected
                    ? "btn-primary min-h-10 px-4 py-2 text-sm"
                    : "btn-secondary min-h-10 px-4 py-2 text-sm"
                }
                onClick={() => setAccountingTab(tab.value)}
                onKeyDown={(event) => handleAccountingTabKeyDown(event, index)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {selectedAccountingTab === "synthese" && (
        <div
          id="accounting-panel-synthese"
          role="tabpanel"
          aria-labelledby="accounting-tab-synthese"
          className="grid gap-6"
        >
      <div className="rounded-lg border border-forest/10 bg-ivory p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-champagne">
              Comptabilité
            </p>
            <h2 className="font-display text-3xl text-forest">Synthèse de période</h2>
            <p className="mt-1 text-sm text-ink/60">{summary.periodLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {periodFilters.concat({ value: "custom", label: "Periode personnalisee" }).map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={period === filter.value ? "btn-primary min-h-9 px-3 py-1.5 text-xs" : "btn-secondary min-h-9 px-3 py-1.5 text-xs"}
                onClick={() => setPeriod(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
        {period === "custom" && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Input label="Date de debut" type="date" value={customStart} onChange={setCustomStart} />
            <Input label="Date de fin" type="date" value={customEnd} onChange={setCustomEnd} />
          </div>
        )}
      </div>

      {!summary.totalOrders && (
        <AdminEmptyState
          title="Aucune commande sur cette période."
          description="Changez de période ou revenez lorsque des commandes seront enregistrées."
        />
      )}

      {!!summary.missingCostProducts.length && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="block">Marge brute incomplète.</strong>
          <span className="mt-1 block">
            Certains produits vendus sur la période n'ont pas de coût d'achat renseigné :{" "}
            {summary.missingCostProducts.join(", ")}.
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.metrics.map((metric) => (
          <article key={metric.label} className="admin-card min-h-32 border-forest/10 bg-ivory/95">
            <p className="text-sm text-ink/55">{metric.label}</p>
            <strong className="mt-2 block font-display text-3xl text-forest">
              {metric.value}
            </strong>
            <span className="text-xs text-ink/50">{metric.detail}</span>
          </article>
        ))}
      </div>

      <section className="admin-card">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-champagne">
              Comparaison
            </p>
            <h2 className="font-display text-3xl text-forest">Periode precedente</h2>
          </div>
          <p className="text-sm text-ink/60">{previousSummary.periodLabel}</p>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summary.comparisonMetrics.map((metric) => (
            <article key={metric.key} className="rounded-md border border-forest/10 bg-cream p-4">
              <p className="text-sm text-ink/55">{metric.label}</p>
              <strong className="mt-2 block text-2xl text-forest">{metric.value}</strong>
              <span className="text-xs text-ink/50">
                Precedent : {formatAccountingValue(metric.key, previousSummary.comparisonValues[metric.key])}
              </span>
            </article>
          ))}
        </div>
      </section>
        </div>
      )}

      {selectedAccountingTab === "marges" && (
      <section
        id="accounting-panel-marges"
        role="tabpanel"
        aria-labelledby="accounting-tab-marges"
        className="admin-card"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-champagne">
              Analyse produits
            </p>
            <h2 className="font-display text-3xl text-forest">Marges par produit</h2>
          </div>
          <p className="text-sm text-ink/60">Commandes payees sur la periode.</p>
        </div>
        {!summary.productRows.length ? (
          <AdminEmptyState
            title="Aucun produit vendu sur cette periode."
            description="Les produits apparaitront ici lorsqu'une commande payee sera comptabilisee."
          />
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
                <tr>
                  {[
                    "Produit",
                    "Quantite vendue",
                    "CA produits net",
                    "Cout des marchandises vendues",
                    "Marge brute",
                    "Taux de marque",
                    "Taux de marge",
                    "Cout historique",
                  ].map((header) => (
                    <th key={header} className="px-4 py-3 font-medium">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.productRows.map((row) => (
                  <tr key={row.productId} className="border-t border-forest/10">
                    <td className="px-4 py-4">
                      <strong className="block text-forest">{row.productName}</strong>
                      <span className="text-xs text-ink/50">{row.productId}</span>
                    </td>
                    <td className="px-4 py-4">{formatQuantity(row.quantitySold)} g</td>
                    <td className="px-4 py-4">{formatCurrency(row.productNetRevenue)}</td>
                    <td className="px-4 py-4">
                      {row.hasMissingCost ? "Incomplet" : formatCurrency(row.purchaseCost)}
                    </td>
                    <td className="px-4 py-4">
                      {row.hasMissingCost ? "Incomplete" : formatCurrency(row.grossMargin)}
                    </td>
                    <td className="px-4 py-4">{formatRate(row.grossMarkupRate)}</td>
                    <td className="px-4 py-4">{formatRate(row.grossMarginRate)}</td>
                    <td className="px-4 py-4">
                      <AdminBadge tone={row.hasMissingCost ? "danger" : row.hasEstimatedCost ? "warning" : "success"}>
                        {row.hasMissingCost ? "Cout manquant" : row.hasEstimatedCost ? costSourceLabel(row.costSources) : "Fige"}
                      </AdminBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {selectedAccountingTab === "achats" && (
      <section
        id="accounting-panel-achats"
        role="tabpanel"
        aria-labelledby="accounting-tab-achats"
        className="admin-card"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-champagne">
              Achats fournisseurs
            </p>
            <h2 className="font-display text-3xl text-forest">Factures d'achat produits</h2>
          </div>
          <p className="text-sm text-ink/60">
            Source <span className="font-mono">supplierPurchases</span> ({supplierPurchasesSource}).
          </p>
        </div>
        <SupplierPurchaseForm
          products={products}
          editingPurchase={editingSupplierPurchase}
          onImportedPurchase={setEditingSupplierPurchase}
          onCancelEdit={() => setEditingSupplierPurchase(null)}
          onSave={async (purchase) => {
            await onSaveSupplierPurchase(purchase);
            setEditingSupplierPurchase(null);
          }}
          onSaveAlias={onSaveSupplierAlias}
        />
        {supplierPurchasesError && (
          <div className="mt-5">
            <AdminDataError message={supplierPurchasesError} onRetry={onRetry} />
          </div>
        )}
        {(!supplierPurchasesError || supplierPurchases.length > 0) && (
          <SupplierPurchasesTable
            purchases={supplierPurchases}
            products={products}
            onEdit={setEditingSupplierPurchase}
            onDelete={onDeleteSupplierPurchase}
            onCancel={onCancelSupplierPurchase}
          />
        )}
      </section>
      )}

      {selectedAccountingTab === "couts" && (
      <section
        id="accounting-panel-couts"
        role="tabpanel"
        aria-labelledby="accounting-tab-couts"
        className="admin-card"
      >
        <SourceLine source={productCostsSource} />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-champagne">
              Coûts manuels / g
            </p>
            <h2 className="font-display text-3xl text-forest">Fallback manuel par gramme</h2>
          </div>
          <p className="text-sm text-ink/60">
            Ces valeurs sont stockées dans <span className="font-mono">productCosts</span> et utilisées uniquement si aucun coût fournisseur pondéré n'existe.
          </p>
        </div>
        {productCostsError && (
          <div className="mt-4">
            <AdminDataError message={productCostsError} onRetry={onRetry} />
          </div>
        )}
        {!productCostsError && !!activeProductsMissingCost.length && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong className="block">Produits actifs sans cout.</strong>
            <span className="mt-1 block">
              {activeProductsMissingCost.map((product) => product.internalReference || product.name).join(", ")}
            </span>
          </div>
        )}
        {(!productCostsError || productCosts.length > 0) && (
        <>
        <div className="mt-4 flex flex-wrap gap-2">
          {productCostFilters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={costFilter === filter.value ? "btn-primary min-h-9 px-3 py-1.5 text-xs" : "btn-secondary min-h-9 px-3 py-1.5 text-xs"}
              onClick={() => setCostFilter(filter.value)}
            >
              {filter.label} · {filter.count}
            </button>
          ))}
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
              <tr>
                {["Produit", "Reference", "Categorie", "Statut", "Fournisseur pondere", "Fallback manuel", "Source utilisee", "Ecart", "Action"].map((header) => (
                  <th key={header} className="px-4 py-3 font-medium">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredCostProducts.map((product) => (
                <ProductCostRow
                  key={product.id}
                  product={product}
                  cost={productCostMap.get(product.id)}
                  supplierCost={weightedSupplierCosts.get(product.id)}
                  onSave={onSaveProductCost}
                />
              ))}
            </tbody>
          </table>
        </div>
        </>
        )}
      </section>
      )}

      {selectedAccountingTab === "factures" && (
      <section
        id="accounting-panel-factures"
        role="tabpanel"
        aria-labelledby="accounting-tab-factures"
        className="grid gap-6"
      >
        <SourceLine source={invoiceSource} />
        <div className="admin-card">
          <p className="text-xs uppercase tracking-[0.16em] text-champagne">
            Factures
          </p>
          <h2 className="font-display text-3xl text-forest">Factures clients</h2>
          <BillingWarning settings={billingSettings} />
        </div>
        <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
          <ManualInvoiceForm onCreate={onCreateManualInvoice} />
          <InvoicesPanel
            invoices={invoices}
            onStatus={onInvoiceStatus}
            onDownload={onInvoiceDownload}
            onSend={onInvoiceSend}
          />
        </div>
      </section>
      )}

      {selectedAccountingTab === "facturation" && (
      <section
        id="accounting-panel-facturation"
        role="tabpanel"
        aria-labelledby="accounting-tab-facturation"
        className="grid gap-6"
      >
        <SourceLine source={billingSource} />
        <BillingSettingsPanel
          settings={editingBilling}
          onChange={onBillingChange}
          onSubmit={onBillingSubmit}
        />
      </section>
      )}
    </section>
  );
}

const emptySupplierLine = (productId = ""): SupplierPurchaseLine => ({
  id: `line-${Date.now()}`,
  productId,
  productName: "",
  quantityGrams: 0,
  grossAmountExVat: 0,
  vatRate: 0,
  lineDiscountAmount: 0,
});

function SupplierPurchaseForm({
  products,
  editingPurchase,
  onImportedPurchase,
  onSave,
  onSaveAlias,
  onCancelEdit,
}: {
  products: Product[];
  editingPurchase: Partial<SupplierPurchase> | null;
  onImportedPurchase: (purchase: Partial<SupplierPurchase>) => void;
  onSave: (purchase: Partial<SupplierPurchase>) => Promise<void>;
  onSaveAlias: (alias: { supplierName: string; originalLabel: string; productId: string }) => Promise<void>;
  onCancelEdit: () => void;
}) {
  const firstProductId = products[0]?.id || "";
  const [supplierName, setSupplierName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(toDateInputValue(new Date()));
  const [internalReference, setInternalReference] = useState("");
  const [globalDiscountExVat, setGlobalDiscountExVat] = useState("0");
  const [shippingExVat, setShippingExVat] = useState("0");
  const [vatRate, setVatRate] = useState("0");
  const [costBase, setCostBase] = useState<"HT" | "TTC">("HT");
  const [status, setStatus] = useState<"draft" | "validated">("draft");
  const [lines, setLines] = useState<SupplierPurchaseLine[]>([emptySupplierLine(firstProductId)]);

  useEffect(() => {
    if (!editingPurchase) return;
    setSupplierName(editingPurchase.supplierName || "");
    setInvoiceNumber(editingPurchase.invoiceNumber || "");
    setInvoiceDate(editingPurchase.invoiceDate || toDateInputValue(new Date()));
    setInternalReference(editingPurchase.internalReference || "");
    setGlobalDiscountExVat(optionalNumberInputValue(editingPurchase.globalDiscountExVat));
    setShippingExVat(optionalNumberInputValue(editingPurchase.shippingExVat));
    setVatRate(optionalNumberInputValue(editingPurchase.vatRate));
    setCostBase(editingPurchase.costBase || "HT");
    setStatus(editingPurchase.status === "validated" ? "validated" : "draft");
    setLines(
      editingPurchase.lines?.length
        ? editingPurchase.lines.map((line, index) => ({
            ...emptySupplierLine(firstProductId),
            ...line,
            id: line.id || `line-${index + 1}`,
          }))
        : [emptySupplierLine(firstProductId)],
    );
  }, [editingPurchase, firstProductId]);

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  let preview: SupplierPurchase | null = null;
  try {
    preview = normalizeSupplierPurchaseInput(buildPayload()) as SupplierPurchase;
  } catch {
    preview = null;
  }

  function buildPayload(): Partial<SupplierPurchase> {
    return {
      id: editingPurchase?.id,
      supplierName,
      invoiceNumber,
      invoiceDate,
      internalReference,
      globalDiscountExVat: Number(globalDiscountExVat || 0),
      shippingExVat: Number(shippingExVat || 0),
      vatRate: Number(vatRate || 0),
      costBase,
      status,
      lines: lines.map((line) => ({
        ...line,
        productName: productById.get(line.productId)?.name || line.productName || "",
        productInternalReference: productById.get(line.productId)?.internalReference || line.productInternalReference || "",
        quantityGrams: Number(line.quantityGrams || 0),
        grossAmountExVat: Number(line.grossAmountExVat || 0),
        vatRate: Number(line.vatRate || vatRate || 0),
        lineDiscountAmount: Number(line.lineDiscountAmount || 0),
      })),
    };
  }

  function updateLine(index: number, patch: Partial<SupplierPurchaseLine>) {
    setLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSave(normalizeSupplierPurchaseInput(buildPayload()) as SupplierPurchase);
    setSupplierName("");
    setInvoiceNumber("");
    setInvoiceDate(toDateInputValue(new Date()));
    setInternalReference("");
    setGlobalDiscountExVat("0");
    setShippingExVat("0");
    setVatRate("0");
    setCostBase("HT");
    setStatus("draft");
    setLines([emptySupplierLine(firstProductId)]);
  }

  return (
    <>
    <SupplierInvoiceImportPanel onUseDraft={onImportedPurchase} />
    <form className="mt-5 rounded-lg border border-forest/10 bg-cream p-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="font-display text-2xl text-forest">
            {editingPurchase?.id ? "Modifier le brouillon fournisseur" : "Nouvel achat fournisseur"}
          </h3>
          <p className="text-sm text-ink/60">
            Uniquement les produits payants lies au catalogue Verdanza.
          </p>
        </div>
        {editingPurchase?.id && (
          <button type="button" className="btn-secondary min-h-9 px-3 py-2 text-xs" onClick={onCancelEdit}>
            Annuler l'edition
          </button>
        )}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Input label="Fournisseur" value={supplierName} onChange={setSupplierName} required />
        <Input label="Numero facture" value={invoiceNumber} onChange={setInvoiceNumber} required />
        <Input label="Date facture" type="date" value={invoiceDate} onChange={setInvoiceDate} required />
        <Input label="Reference interne" value={internalReference} onChange={setInternalReference} />
        <Input label="Remise globale HT" type="number" min="0" step="0.01" value={globalDiscountExVat} onChange={setGlobalDiscountExVat} />
        <Input label="Frais fournisseur HT" type="number" min="0" step="0.01" value={shippingExVat} onChange={setShippingExVat} />
        <Input label="TVA par defaut (%)" type="number" min="0" step="0.01" value={vatRate} onChange={setVatRate} />
        <label className="grid gap-1 text-sm font-medium text-forest">
          Base de cout
          <select className="input-field" value={costBase} onChange={(event) => setCostBase(event.target.value as "HT" | "TTC")}>
            <option value="HT">HT</option>
            <option value="TTC">TTC</option>
          </select>
        </label>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="bg-ivory text-xs uppercase tracking-[0.14em] text-forest/70">
            <tr>
              {["Produit", "Libelle fournisseur", "Quantite g", "Montant HT", "TVA %", "Remise ligne", "Alias", "Action"].map((header) => (
                <th key={header} className="px-3 py-2 font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.id} className="border-t border-forest/10">
                <td className="px-3 py-3">
                  <select className="input-field min-w-56" value={line.productId} onChange={(event) => updateLine(index, { productId: event.target.value })}>
                    <option value="">Selectionner un produit</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.internalReference ? `${product.internalReference} - ` : ""}{product.name}
                      </option>
                    ))}
                  </select>
                  {line.matchConfidence && (
                    <span className="mt-1 block text-xs text-ink/50">
                      {supplierMatchLabel(line.matchConfidence, line.matchSource)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <span className="block min-w-48 text-xs text-ink/60">
                    {line.supplierOriginalLabel || "-"}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <input className="input-field max-w-32" type="number" min="0.001" step="0.001" value={line.quantityGrams || ""} onChange={(event) => updateLine(index, { quantityGrams: Number(event.target.value) })} />
                </td>
                <td className="px-3 py-3">
                  <input className="input-field max-w-32" type="number" min="0" step="0.01" value={line.grossAmountExVat || ""} onChange={(event) => updateLine(index, { grossAmountExVat: Number(event.target.value) })} />
                </td>
                <td className="px-3 py-3">
                  <input className="input-field max-w-28" type="number" min="0" step="0.01" value={line.vatRate || ""} onChange={(event) => updateLine(index, { vatRate: Number(event.target.value) })} />
                </td>
                <td className="px-3 py-3">
                  <input className="input-field max-w-32" type="number" min="0" step="0.01" value={line.lineDiscountAmount || ""} onChange={(event) => updateLine(index, { lineDiscountAmount: Number(event.target.value) })} />
                </td>
                <td className="px-3 py-3">
                  {line.supplierOriginalLabel && line.productId ? (
                    <button
                      type="button"
                      className="btn-secondary min-h-9 px-3 py-2 text-xs"
                      onClick={() => void onSaveAlias({
                        supplierName,
                        originalLabel: line.supplierOriginalLabel || "",
                        productId: line.productId,
                      })}
                    >
                      Memoriser
                    </button>
                  ) : (
                    <span className="text-xs text-ink/45">-</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <button type="button" className="btn-secondary min-h-9 px-3 py-2 text-xs" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} disabled={lines.length <= 1}>
                    Retirer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" className="btn-secondary min-h-9 px-3 py-2 text-xs" onClick={() => setLines((current) => [...current, emptySupplierLine(firstProductId)])}>
          Ajouter une ligne
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {preview && (
            <span className="text-sm text-ink/60">
              Total HT {formatCurrency(preview.totalExVat)} · cout stock {formatCurrency(preview.lines.reduce((sum, line) => sum + Number(line.netCostAmount || 0), 0))}
            </span>
          )}
          <select className="input-field max-w-44" value={status} onChange={(event) => setStatus(event.target.value as "draft" | "validated")}>
            <option value="draft">Brouillon</option>
            <option value="validated">Valider</option>
          </select>
          <button className="btn-primary min-h-10 px-4 py-2" type="submit">
            Enregistrer
          </button>
        </div>
      </div>
    </form>
    </>
  );
}

function SupplierInvoiceImportPanel({
  onUseDraft,
}: {
  onUseDraft: (purchase: Partial<SupplierPurchase>) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<SupplierInvoiceAnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  async function handleAnalyze() {
    if (!file) return;
    setError("");
    setIsAnalyzing(true);
    try {
      const result = await analyzeSupplierInvoicePdfAdmin(file);
      setAnalysis(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analyse PDF impossible.");
      setAnalysis(null);
    } finally {
      setIsAnalyzing(false);
    }
  }

  function handleUseDraft() {
    if (!analysis) return;
    onUseDraft({
      ...analysis.purchase,
      status: "draft",
      sourceFileSha256: analysis.fileSha256,
      importedFromPdfAt: new Date().toISOString(),
    });
  }

  return (
    <div className="mt-5 rounded-lg border border-forest/10 bg-ivory p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-champagne">Import PDF fournisseur</p>
          <h3 className="font-display text-2xl text-forest">Analyser une facture d'achat</h3>
          <p className="mt-1 text-sm text-ink/60">
            PDF texte uniquement, 5 Mo max. L'analyse cree un brouillon, jamais un achat valide.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            className="input-field max-w-72"
            type="file"
            accept="application/pdf"
            onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              setAnalysis(null);
              setError("");
            }}
          />
          <button
            type="button"
            className="btn-secondary min-h-10 px-4 py-2"
            disabled={!file || isAnalyzing}
            onClick={() => void handleAnalyze()}
          >
            {isAnalyzing ? "Analyse..." : "Analyser"}
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {analysis && (
        <div className="mt-4 rounded-md border border-forest/10 bg-cream p-3 text-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <strong className="block text-forest">
                {analysis.purchase.supplierName || "Fournisseur a verifier"} - {analysis.purchase.invoiceNumber || "numero manquant"}
              </strong>
              <span className="text-xs text-ink/55">
                Parseur {analysis.parserName} - SHA-256 {analysis.fileSha256.slice(0, 12)}
              </span>
              {analysis.duplicate?.found && (
                <span className="mt-1 block text-xs font-semibold text-red-700">
                  Doublon detecte ({analysis.duplicate.reason}) : {analysis.duplicate.purchaseId}
                </span>
              )}
            </div>
            <button
              type="button"
              className="btn-primary min-h-9 px-3 py-2 text-xs"
              disabled={analysis.isBlocked || analysis.duplicate?.found}
              onClick={handleUseDraft}
            >
              Utiliser ce brouillon
            </button>
          </div>
          {!!analysis.ignoredFreeLineLabels.length && (
            <p className="mt-2 text-xs text-ink/55">
              Lignes offertes fournisseur exclues : {analysis.ignoredFreeLineLabels.join(", ")}
            </p>
          )}
          {!!analysis.issues.length && (
            <ul className="mt-2 grid gap-1 text-xs text-ink/70">
              {analysis.issues.map((issue) => (
                <li key={`${issue.level}-${issue.message}`}>
                  {issue.level.toUpperCase()} - {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SupplierPurchasesTable({
  purchases,
  products,
  onEdit,
  onDelete,
  onCancel,
}: {
  purchases: SupplierPurchase[];
  products: Product[];
  onEdit: (purchase: SupplierPurchase) => void;
  onDelete: (purchase: SupplierPurchase) => Promise<void>;
  onCancel: (purchase: SupplierPurchase) => Promise<void>;
}) {
  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const sortedPurchases = useMemo(
    () => [...purchases].sort((left, right) => (right.invoiceDate || "").localeCompare(left.invoiceDate || "")),
    [purchases],
  );

  if (!sortedPurchases.length) {
    return (
      <AdminEmptyState
        title="Aucun achat fournisseur."
        description="Ajoutez une facture fournisseur pour calculer les couts moyens ponderes."
      />
    );
  }

  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
          <tr>
            {["Facture", "Date", "Statut", "Lignes", "Total HT", "Cout stock", "Action"].map((header) => (
              <th key={header} className="px-4 py-3 font-medium">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedPurchases.map((purchase) => {
            const stockCost = purchase.lines.reduce((sum, line) => sum + Number(line.netCostAmount || 0), 0);
            return (
              <tr key={purchase.id} className="border-t border-forest/10">
                <td className="px-4 py-4">
                  <strong className="block text-forest">{purchase.invoiceNumber}</strong>
                  <span className="text-xs text-ink/50">{purchase.supplierName}</span>
                </td>
                <td className="px-4 py-4">{purchase.invoiceDate || "-"}</td>
                <td className="px-4 py-4">
                  <AdminBadge tone={purchase.status === "validated" ? "success" : purchase.status === "cancelled" ? "danger" : "warning"}>
                    {purchase.status === "validated" ? "Valide" : purchase.status === "cancelled" ? "Annule" : "Brouillon"}
                  </AdminBadge>
                </td>
                <td className="px-4 py-4">
                  {purchase.lines.map((line) => (
                    <span key={line.id} className="block text-xs text-ink/60">
                      {line.productInternalReference || productById.get(line.productId)?.internalReference || "Sans ref"} · {productById.get(line.productId)?.name || line.productName || line.productId} · {formatQuantity(Number(line.quantityGrams || 0))} g · {formatCurrency(Number(line.effectiveCostPerGram || 0))}/g
                    </span>
                  ))}
                </td>
                <td className="px-4 py-4">{formatCurrency(purchase.totalExVat)}</td>
                <td className="px-4 py-4">{formatCurrency(stockCost)}</td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap gap-2">
                    {purchase.status === "draft" && (
                      <>
                        <button type="button" className="btn-secondary min-h-9 px-3 py-2 text-xs" onClick={() => onEdit(purchase)}>
                          Reprendre
                        </button>
                        <button type="button" className="min-h-9 rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50" onClick={() => void onDelete(purchase)}>
                          Supprimer
                        </button>
                      </>
                    )}
                    {purchase.status === "validated" && (
                      <button type="button" className="min-h-9 rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50" onClick={() => void onCancel(purchase)}>
                        Annuler
                      </button>
                    )}
                    {purchase.status === "cancelled" && (
                      <span className="text-xs text-ink/50">Conserve hors calcul</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProductCostRow({
  product,
  cost,
  supplierCost,
  onSave,
}: {
  product: Product;
  cost?: ProductCost;
  supplierCost?: WeightedSupplierCost;
  onSave: (productId: string, purchasePricePerGram: number | null) => Promise<void>;
}) {
  const [value, setValue] = useState(optionalNumberInputValue(cost?.purchasePricePerGram));

  useEffect(() => {
    setValue(optionalNumberInputValue(cost?.purchasePricePerGram));
  }, [cost?.purchasePricePerGram]);

  const parsed = value.trim() === "" ? null : Number(value);
  const isInvalid = parsed !== null && (!Number.isFinite(parsed) || parsed < 0);
  const manualCost = optionalProductCostValue(cost);
  const supplierUnitCost = supplierCost?.weightedCostPerGram ?? null;
  const usedCost = supplierUnitCost ?? manualCost;
  const usedSource = supplierUnitCost != null
    ? "Fournisseur pondere"
    : manualCost != null
      ? "Fallback manuel"
      : "Cout manquant";
  const gap = supplierUnitCost != null && manualCost != null ? manualCost - supplierUnitCost : null;
  const gapRate = gap != null && supplierUnitCost != null && supplierUnitCost > 0
    ? gap / supplierUnitCost
    : null;

  return (
    <tr className="border-t border-forest/10">
      <td className="px-4 py-4">
        <strong className="block text-forest">{product.name}</strong>
        <span className="text-xs text-ink/50">{product.id}</span>
      </td>
      <td className="px-4 py-4 font-mono text-xs text-ink/60">
        {product.internalReference || "A attribuer"}
      </td>
      <td className="px-4 py-4">{productCategoryLabel(product.category)}</td>
      <td className="px-4 py-4">
        <AdminBadge tone={product.isActive ? "success" : "muted"}>
          {product.isActive ? "Actif" : "Inactif"}
        </AdminBadge>
      </td>
      <td className="px-4 py-4">
        {supplierUnitCost == null ? (
          <span className="text-xs text-ink/45">-</span>
        ) : (
          <>
            <strong className="block text-forest">{formatCurrency(supplierUnitCost)}/g</strong>
            <span className="text-xs text-ink/50">
              {formatQuantity(supplierCost?.totalQuantityGrams || 0)} g achetes
            </span>
          </>
        )}
      </td>
      <td className="px-4 py-4">
        <input
          className="input-field max-w-40"
          type="number"
          min="0"
          step="0.01"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Non renseigné"
        />
        {cost?.purchasePricePerGram == null && (
          <span className="mt-1 block text-xs text-amber-700">Coût non renseigné</span>
        )}
      </td>
      <td className="px-4 py-4">
        <AdminBadge tone={usedCost == null ? "danger" : supplierUnitCost != null ? "success" : "warning"}>
          {usedSource}
        </AdminBadge>
        {usedCost != null && (
          <span className="mt-1 block text-xs text-ink/55">{formatCurrency(usedCost)}/g</span>
        )}
      </td>
      <td className="px-4 py-4">
        {gap == null ? (
          <span className="text-xs text-ink/45">-</span>
        ) : (
          <>
            <span className="block">{formatCurrency(gap)}/g</span>
            <span className="text-xs text-ink/50">{formatRate(gapRate)}</span>
          </>
        )}
      </td>
      <td className="px-4 py-4">
        <button
          className="btn-secondary min-h-9 px-3 py-2"
          disabled={isInvalid}
          onClick={() => void onSave(product.id, parsed)}
        >
          Enregistrer
        </button>
      </td>
    </tr>
  );
}

function BillingSettingsPanel({
  settings,
  onChange,
  onSubmit,
}: {
  settings: BillingSettings;
  onChange: (settings: BillingSettings) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="admin-card mt-8 max-w-5xl" onSubmit={onSubmit}>
      <h2 className="font-display text-3xl text-forest">Parametres de facturation</h2>
      <BillingWarning settings={settings} />
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Input label="Nom commercial" value={settings.tradeName} onChange={(tradeName) => onChange({ ...settings, tradeName })} />
        <Input label="Nom affiche / titulaire provisoire" value={settings.displayName} onChange={(displayName) => onChange({ ...settings, displayName })} />
        <Input label="Raison sociale exacte" value={settings.legalName || ""} onChange={(legalName) => onChange({ ...settings, legalName })} />
        <Input label="Forme juridique" value={settings.legalForm || ""} onChange={(legalForm) => onChange({ ...settings, legalForm })} />
        <Input label="SIREN" value={settings.siren || ""} onChange={(siren) => onChange({ ...settings, siren })} />
        <Input label="SIRET" value={settings.siret || ""} onChange={(siret) => onChange({ ...settings, siret })} />
        <Input label="Téléphone" value={settings.phone} onChange={(phone) => onChange({ ...settings, phone })} />
        <Input label="Email" value={settings.email} onChange={(email) => onChange({ ...settings, email })} />
        <label className="text-sm font-medium text-forest">
          Regime TVA
          <select
            className="input-field mt-2"
            value={settings.vatMode}
            onChange={(event) => onChange({ ...settings, vatMode: event.target.value as BillingSettings["vatMode"] })}
          >
            <option value="not_configured">TVA non configurée</option>
            <option value="vat_exempt">Franchise en base de TVA</option>
            <option value="vat_applicable">TVA applicable</option>
            <option value="other">Autre regime</option>
          </select>
        </label>
        <Input label="Numéro TVA intracommunautaire" value={settings.vatNumber || ""} onChange={(vatNumber) => onChange({ ...settings, vatNumber })} />
        <Input label="Mention TVA applicable" value={settings.vatMention || ""} onChange={(vatMention) => onChange({ ...settings, vatMention })} />
        <Input label="Logo facture" value={settings.logoUrl || ""} onChange={(logoUrl) => onChange({ ...settings, logoUrl })} />
        <label className="md:col-span-2 text-sm font-medium text-forest">
          Adresse de facturation
          <textarea
            className="input-field mt-2 min-h-20"
            value={settings.address || ""}
            onChange={(event) => onChange({ ...settings, address: event.target.value })}
          />
        </label>
        <Textarea label="Conditions de paiement" value={settings.paymentTerms || ""} onChange={(paymentTerms) => onChange({ ...settings, paymentTerms })} />
        <Textarea label="Mentions légales spécifiques" value={settings.legalMentions || ""} onChange={(legalMentions) => onChange({ ...settings, legalMentions })} />
        <label className="md:col-span-2 flex items-center gap-2 text-sm text-forest">
          <input
            type="checkbox"
            checked={settings.isManuallyValidated}
            onChange={(event) => onChange({ ...settings, isManuallyValidated: event.target.checked })}
          />
          Informations validées manuellement
        </label>
      </div>
      <button className="btn-primary mt-6" type="submit">
        Enregistrer la configuration
      </button>
    </form>
  );
}

function ManualInvoiceForm({ onCreate }: { onCreate: (input: ManualInvoiceInput) => Promise<void> }) {
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [label, setLabel] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("Règlement à confirmer");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("to_confirm");
  const [internalNote, setInternalNote] = useState("");

  return (
    <form
      className="admin-card h-fit"
      onSubmit={(event) => {
        event.preventDefault();
        const line: InvoiceLine = {
          id: slugify(label || "ligne"),
          label,
          quantity,
          unitPrice,
          total: quantity * unitPrice,
        };
        void onCreate({
          customerName,
          customerEmail,
          customerPhone,
          lines: [line],
          deliveryFee,
          discountAmount,
          paymentMethod,
          paymentStatus,
          internalNote,
        });
      }}
    >
      <h2 className="font-display text-3xl text-forest">Créer facture manuelle</h2>
      <div className="mt-5 grid gap-4">
        <Input label="Client" value={customerName} onChange={setCustomerName} />
        <Input label="Email client" value={customerEmail} onChange={setCustomerEmail} />
        <Input label="Téléphone client" value={customerPhone} onChange={setCustomerPhone} />
        <Input label="Produit ou prestation" value={label} onChange={setLabel} />
        <div className="grid grid-cols-2 gap-3">
          <NumberInput label="Quantité" value={quantity} onChange={setQuantity} />
          <NumberInput label="Prix unitaire" value={unitPrice} onChange={setUnitPrice} />
          <NumberInput label="Livraison" value={deliveryFee} onChange={setDeliveryFee} />
          <NumberInput label="Remise" value={discountAmount} onChange={setDiscountAmount} />
        </div>
        <Input label="Mode de règlement" value={paymentMethod} onChange={setPaymentMethod} />
        <label className="text-sm font-medium text-forest">
          Statut règlement
          <select
            className="input-field mt-2"
            value={paymentStatus}
            onChange={(event) => setPaymentStatus(event.target.value as PaymentStatus)}
          >
            {["to_confirm", "pending", "paid", "cancelled"].map((status) => (
              <option key={status} value={status}>{paymentStatusLabel(status)}</option>
            ))}
          </select>
        </label>
        <Textarea label="Note interne" value={internalNote} onChange={setInternalNote} />
        <button className="btn-primary" type="submit">Créer le brouillon</button>
      </div>
    </form>
  );
}

function InvoicesPanel({
  invoices,
  onStatus,
  onDownload,
  onSend,
}: {
  invoices: Invoice[];
  onStatus: (invoice: Invoice, status: InvoiceStatus) => Promise<void>;
  onDownload: (invoice: Invoice) => Promise<void>;
  onSend: (invoice: Invoice) => Promise<void>;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-forest/10 bg-ivory">
      {!invoices.length && (
        <p className="border-b border-forest/10 bg-cream px-4 py-4 text-sm text-forest">
          Aucune facture pour le moment.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
            <tr>
              {["Facture", "Client", "Origine", "Statut", "Règlement", "Total", "Actions"].map((header) => (
                <th key={header} className="px-4 py-3 font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id} className="border-t border-forest/10">
                <td className="px-4 py-4">
                  <strong className="block text-forest">{invoice.invoiceNumber}</strong>
                  <span className="text-xs text-ink/55">{invoice.orderId ? `Commande ${invoice.orderId}` : "Vente directe"}</span>
                </td>
                <td className="px-4 py-4">
                  <strong className="block text-forest">{invoice.customerName}</strong>
                  <span className="block text-xs text-ink/55">{invoice.customerEmail}</span>
                  <span className="block text-xs text-ink/55">{invoice.customerPhone}</span>
                </td>
                <td className="px-4 py-4">{invoice.origin === "order" ? "Commande web" : "Manuelle"}</td>
                <td className="px-4 py-4">
                  <select
                    className="input-field"
                    value={invoice.status}
                    onChange={(event) => void onStatus(invoice, event.target.value as InvoiceStatus)}
                  >
                    {["draft", "validated", "sent", "paid", "cancelled", "credit_note_issued"].map((status) => (
                      <option key={status} value={status}>{invoiceStatusLabel(status as InvoiceStatus)}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-4">{paymentStatusLabel(invoice.paymentStatus)}</td>
                <td className="px-4 py-4">{formatEuro(invoice.total)} EUR</td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-secondary min-h-9 px-3 py-2" onClick={() => void onDownload(invoice)}>PDF</button>
                    <button className="btn-primary min-h-9 px-3 py-2" onClick={() => void onSend(invoice)}>Envoyer</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type AdminOrderListItem = {
  id: string;
  orderType?: string;
  customer: string;
  customerEmail?: string;
  customerPhone?: string;
  deliveryAddress?: {
    line1: string;
    line2?: string;
    postalCode: string;
    city: string;
    country: string;
  };
  paymentProvider?: PaymentProvider;
  paymentStatus: string;
  preferredPaymentMethod?: PreferredPaymentMethod;
  finalPaymentMethod?: FinalPaymentMethod;
  paymentConfirmedAt?: string;
  paymentConfirmedBy?: string;
  orderStatus: string;
  deliveryMethod?: string;
  delivery: string;
  deliveryMinimumApplied?: number;
  postalFreeShippingApplied?: boolean;
  deliveryFeeStatus?: string;
  deliveryNote?: string;
  trackingNumber?: string;
  paymentReference?: string;
  paymentLinkUrl?: string;
  paymentLinkLabel?: string;
  paymentLinkAmount?: number;
  paymentLinkCurrency?: "EUR";
  paymentLinkSent?: boolean;
  paymentLinkSentAt?: string;
  paymentLinkSentBy?: string;
  paymentLinkChannel?: PaymentLinkChannel;
  customerMessage?: string;
  items: { name: string; quantity: number }[];
  subtotal?: number;
  subtotalBeforeDiscount?: number;
  discountAmount?: number;
  couponCode?: string;
  promoApplied?: boolean;
  appliedPromotions?: AdminOrderRow["appliedPromotions"];
  discountType?: Coupon["discountType"];
  discountValue?: number;
  total: string;
  internalNote?: string;
  statusHistory?: StatusHistoryEntry[];
  archived?: boolean;
  hidden?: boolean;
  deletedAt?: string;
  archivedAt?: string;
  hiddenAt?: string;
  emails?: AdminOrderRow["emails"];
  analytics?: OrderAnalytics;
};

type AdminOrderUpdateInput = {
  orderStatus?: OrderStatus;
  paymentStatus?: PaymentStatus;
  finalPaymentMethod?: FinalPaymentMethod | "";
  internalNote?: string;
  historyNote?: string;
  paymentReference?: string;
  paymentLinkUrl?: string;
  paymentLinkLabel?: string;
  paymentLinkAmount?: number;
  paymentLinkCurrency?: "EUR";
  paymentLinkSent?: boolean;
  paymentLinkChannel?: PaymentLinkChannel | "";
  trackingNumber?: string;
  archived?: boolean;
  hidden?: boolean;
  restore?: boolean;
};

function AdminOrders({
  orders,
  invoices = [],
  orderSource,
  onCreateInvoice,
  onRefresh,
  onUpdate,
  onDelete,
}: {
  orders: AdminOrderListItem[];
  invoices?: Invoice[];
  orderSource: "firestore" | "empty";
  onCreateInvoice?: (orderId: string) => Promise<void>;
  onRefresh?: () => Promise<void>;
  onUpdate: (orderId: string, data: AdminOrderUpdateInput) => Promise<void>;
  onDelete: (orderId: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState("active");
  const [paymentLinks, setPaymentLinks] = useState<AdminPaymentLink[]>([]);
  const [paymentLinkMessage, setPaymentLinkMessage] = useState("");
  const [emailRetrying, setEmailRetrying] = useState("");
  const invoiceByOrderId = new Map(invoices.map((invoice) => [invoice.orderId, invoice]));
  const filteredOrders = orders.filter((order) => orderMatchesAdminFilter(order, filter));
  const filterGroups = [
    {
      label: "Traitement",
      items: [
        ["active", "Commandes actives"],
        ["new", "Nouvelles"],
        ["contact_required", "À contacter"],
        ["confirmed", "Confirmées"],
        ["preparing", "En préparation"],
        ["out_for_delivery", "En livraison"],
        ["shipped", "Expédiées"],
      ],
    },
    {
      label: "Finalisées",
      items: [
        ["delivered", "Livrées"],
        ["cancelled", "Annulées"],
        ["finished", "Terminées"],
        ["archived", "Archivées"],
      ],
    },
    {
      label: "Type",
      items: [
        ["preorder", "Précommandes"],
        ["local", "Commandes locales"],
        ["postal", "Commandes postales"],
        ["all", "Toutes"],
      ],
    },
  ];

  useEffect(() => {
    let active = true;
    getAdminPaymentLinks()
      .then((links) => {
        if (active) setPaymentLinks(links);
      })
      .catch((error) => {
        if (active) {
          setPaymentLinkMessage(
            error instanceof Error ? error.message : "Liens de paiement indisponibles.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSendPaymentLinkEmail(input: {
    orderId: string;
    paymentLinkUrl: string;
    paymentLinkLabel: string;
    paymentLinkAmount: number;
    paymentLinkCurrency: "EUR";
  }) {
    try {
      await sendOrderPaymentLinkEmail(input);
      setPaymentLinkMessage("Lien de paiement envoyé au client.");
      await onUpdate(input.orderId, {});
    } catch (error) {
      setPaymentLinkMessage(
        error instanceof Error
          ? error.message
          : "Envoi email impossible. Copiez le message manuellement.",
      );
    }
  }

  async function handleRetryPurchaseAnalytics(orderId: string) {
    try {
      const result = await retryOrderPurchaseAnalytics(orderId);
      setPaymentLinkMessage(
        result?.status === "sent"
          ? "Purchase GA4 envoye."
          : `Relance purchase GA4 terminee : ${result?.status || "inconnue"}.`,
      );
      await onUpdate(orderId, {});
    } catch (error) {
      setPaymentLinkMessage(
        error instanceof Error ? error.message : "Relance purchase GA4 impossible.",
      );
    }
  }

  async function handleRetryOrderEmails(
    orderId: string,
    target: RetryOrderEmailTarget,
  ) {
    const targetLabel =
      target === "client"
        ? "la confirmation client"
        : target === "admin"
          ? "les notifications administrateur"
          : "tous les e-mails de la commande";
    if (!window.confirm(`Relancer ${targetLabel} ?`)) return;
    const retryKey = `${orderId}:${target}`;
    setEmailRetrying(retryKey);
    try {
      const result = await retryOrderEmails(orderId, target);
      const details = [
        result.client ? `client : ${result.client}` : "",
        result.admin ? `administrateur : ${result.admin}` : "",
      ]
        .filter(Boolean)
        .join(" ; ");
      setPaymentLinkMessage(
        result.ok
          ? `Relance e-mail terminee (${details}).`
          : `Relance e-mail en echec (${details || result.error || "echec"}).`,
      );
      await onRefresh?.();
    } catch (error) {
      setPaymentLinkMessage(
        error instanceof Error ? error.message : "Relance e-mail impossible.",
      );
    } finally {
      setEmailRetrying("");
    }
  }

  function handlePaymentStatusChange(order: AdminOrderListItem, paymentStatus: PaymentStatus) {
    if (paymentStatus !== "paid") {
      void onUpdate(order.id, { paymentStatus });
      return;
    }
    const finalPaymentMethod = confirmedFinalPaymentMethodForPaid(order);
    if (!finalPaymentMethod) return;
    void onUpdate(order.id, { paymentStatus, finalPaymentMethod });
  }

  return (
    <section className="mt-8 overflow-hidden rounded-lg border border-forest/10 bg-ivory">
      {!orders.length && (
        <AdminEmptyState
          title="Aucune commande pour le moment."
          description="Les nouvelles commandes apparaitront ici des leur creation."
        />
      )}
      {!!orders.length && (
        <div className="grid gap-4 border-b border-forest/10 bg-cream px-4 py-4">
          {filterGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-forest/55">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-2">
                {group.items.map(([value, label]) => (
                  <button
                    key={value}
                    className={
                      filter === value
                        ? "btn-primary min-h-9 px-3 py-1.5 text-xs"
                        : "btn-secondary min-h-9 px-3 py-1.5 text-xs"
                    }
                    onClick={() => setFilter(value)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {paymentLinkMessage && (
        <p className="border-b border-forest/10 bg-cream px-4 py-3 text-sm text-forest">
          {paymentLinkMessage}
        </p>
      )}
      {!!orders.length && !filteredOrders.length && (
        <AdminEmptyState
          title="Aucune commande pour ce filtre."
          description="Changez de filtre ou consultez toutes les commandes."
          action={
            <button
              className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
              type="button"
              onClick={() => setFilter("all")}
            >
              Voir toutes les commandes
            </button>
          }
        />
      )}
      {!!filteredOrders.length && (
        <div className="grid gap-3 p-3 lg:hidden">
          {filteredOrders.map((order) => (
            <article
              key={order.id}
              className="rounded-lg border border-forest/10 bg-ivory p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    <AdminBadge tone={order.orderType === "preorder" ? "gold" : "neutral"}>
                      {order.orderType === "preorder" ? "Précommande" : "Commande"}
                    </AdminBadge>
                    <AdminBadge tone={order.deliveryMethod === "postal" ? "neutral" : "gold"}>
                      {order.deliveryMethod === "postal" ? "Postale" : "Locale"}
                    </AdminBadge>
                  </div>
                  <strong className="mt-3 block break-all text-sm text-forest">
                    {order.id}
                  </strong>
                  <p className="mt-1 text-sm font-semibold text-forest">{order.customer}</p>
                  <p className="text-xs text-ink/55">{order.customerPhone}</p>
                </div>
                <strong className="whitespace-nowrap font-display text-2xl text-forest">
                  {order.total}
                </strong>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-[0.12em] text-forest/60">
                  Statut
                  <select
                    className="input-field mt-2"
                    value={order.orderStatus}
                    disabled={orderSource !== "firestore"}
                    onChange={(event) => {
                      const historyNote =
                        window.prompt("Note historique optionnelle", "") || "";
                      void onUpdate(order.id, {
                        orderStatus: event.target.value as OrderStatus,
                        historyNote,
                      });
                    }}
                  >
                    {[
                      "new",
                      "contact_required",
                      "confirmed",
                      "preparing",
                      "out_for_delivery",
                      "shipped",
                      "delivered",
                      "cancelled",
                    ].map((status) => (
                      <option key={status} value={status}>
                        {orderStatusLabel(status)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.12em] text-forest/60">
                  Règlement
                  <select
                    className="input-field mt-2"
                    value={order.paymentStatus}
                    disabled={orderSource !== "firestore"}
                    onChange={(event) =>
                      handlePaymentStatusChange(order, event.target.value as PaymentStatus)
                    }
                  >
                    {paymentStatusOptions.map((status) => (
                      <option key={status} value={status}>
                        {paymentStatusLabel(status)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <PaymentMethodAdminFields
                order={order}
                orderSource={orderSource}
                onUpdate={onUpdate}
              />
              <div className="mt-4 rounded-md bg-cream p-3 text-xs leading-5 text-ink/65">
                <strong className="block text-forest">{order.delivery}</strong>
                {order.items.length
                  ? order.items.map(formatOrderItemLine).join(", ")
                  : "Produits a renseigner"}
                {order.promoApplied && (
                  <span className="mt-2 block text-forest">
                    {orderPromotionLabel(order)} : -{formatEuro(Number(order.discountAmount || 0))} EUR
                  </span>
                )}
              </div>
              <PaymentLinkActions
                order={order}
                orderSource={orderSource}
                paymentLinks={paymentLinks}
                onUpdate={onUpdate}
                onSendEmail={handleSendPaymentLinkEmail}
              />
              <div className="mt-4 rounded-md border border-forest/10 bg-cream p-3 text-xs text-ink/65">
                <strong className="block text-forest">Notifications</strong>
                <NotificationStatus order={order} />
                <EmailRetryActions
                  orderId={order.id}
                  disabled={orderSource !== "firestore"}
                  retrying={emailRetrying}
                  onRetry={handleRetryOrderEmails}
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <a className="btn-secondary min-h-9 px-3 py-1.5 text-xs" href={telLink(order.customerPhone)}>
                  Appeler
                </a>
                <a
                  className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
                  href={whatsappLink(order)}
                  target="_blank"
                  rel="noreferrer"
                >
                  WhatsApp
                </a>
                <a className="btn-secondary min-h-9 px-3 py-1.5 text-xs" href={smsLink(order)}>
                  SMS
                </a>
                <button
                  className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
                  onClick={() => void copyOrderMessage(order)}
                >
                  Copier
                </button>
                {order.archived || order.hidden ? (
                  <button
                    className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
                    disabled={orderSource !== "firestore"}
                    onClick={() => void onUpdate(order.id, { restore: true })}
                  >
                    Restaurer
                  </button>
                ) : (
                  <button
                    className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
                    disabled={orderSource !== "firestore"}
                    onClick={() => {
                      const confirmed = window.confirm(
                        "Cette action masquera la commande de la vue principale. Elle restera consultable dans les archives.",
                      );
                      if (confirmed) void onUpdate(order.id, { archived: true });
                    }}
                  >
                    Archiver
                  </button>
                )}
                {canRetryPurchaseAnalytics(order) && (
                  <button
                    className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
                    disabled={orderSource !== "firestore"}
                    onClick={() => void handleRetryPurchaseAnalytics(order.id)}
                    type="button"
                  >
                    Relancer GA4
                  </button>
                )}
                {canDeleteCancelledOrder(order) && (
                  <button
                    className="min-h-9 rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                    disabled={orderSource !== "firestore"}
                    onClick={() => {
                      if (confirmPermanentOrderDeletion(order.id)) {
                        void onDelete(order.id);
                      }
                    }}
                    type="button"
                  >
                    Supprimer
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {!!filteredOrders.length && (
        <div className="hidden gap-4 p-4 lg:grid">
          {filteredOrders.map((order) => (
            <DesktopOrderCard
              key={order.id}
              order={order}
              invoice={invoiceByOrderId.get(order.id)}
              orderSource={orderSource}
              paymentLinks={paymentLinks}
              onCreateInvoice={onCreateInvoice}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onSendEmail={handleSendPaymentLinkEmail}
              onRetryOrderEmails={handleRetryOrderEmails}
              emailRetrying={emailRetrying}
              onRetryPurchaseAnalytics={handleRetryPurchaseAnalytics}
            />
          ))}
        </div>
      )}
      <div className="hidden">
        <table className="w-full min-w-[1380px] text-left text-sm">
          <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
            <tr>
              {[
                "Type",
                "Commande",
                "Client",
                "Règlement",
                "Statut commande",
                "Livraison",
                "Produits",
                "Total",
                "Reference / suivi",
                "Facture",
                "Notification",
                "Note interne",
                "Historique",
                "Actions",
              ].map((header) => (
                <th key={header} className="px-4 py-3 font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map((order) => (
              <tr key={order.id} className="border-t border-forest/10">
                <td className="px-4 py-4">
                  <AdminBadge tone={order.orderType === "preorder" ? "gold" : "neutral"}>
                    {order.orderType === "preorder" ? "Précommande" : "Commande"}
                  </AdminBadge>
                </td>
                <td className="px-4 py-4">{order.id}</td>
                <td className="px-4 py-4">
                  <strong className="block text-forest">{order.customer}</strong>
                  <span className="block text-xs text-ink/55">{order.customerEmail}</span>
                  <span className="block text-xs text-ink/55">{order.customerPhone}</span>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a className="btn-secondary min-h-8 px-2 py-1 text-xs" href={telLink(order.customerPhone)}>
                      Appeler
                    </a>
                    <a
                      className="btn-secondary min-h-8 px-2 py-1 text-xs"
                      href={whatsappLink(order)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      WhatsApp
                    </a>
                    <a className="btn-secondary min-h-8 px-2 py-1 text-xs" href={smsLink(order)}>
                      SMS
                    </a>
                    <button
                      className="btn-secondary min-h-8 px-2 py-1 text-xs"
                      onClick={() => void copyOrderMessage(order)}
                    >
                      Copier
                    </button>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <span className="block text-xs text-ink/55">
                    {paymentProviderLabel(order.paymentProvider)}
                  </span>
                  <strong className="mt-1 block text-xs leading-5 text-forest">
                    {preferredPaymentMethodLabel(order.preferredPaymentMethod)}
                  </strong>
                  <div className="mt-2">
                    <AdminBadge tone={paymentStatusTone(order.paymentStatus)}>
                      {paymentStatusLabel(order.paymentStatus)}
                    </AdminBadge>
                  </div>
                  <select
                    className="input-field mt-2"
                    value={order.paymentStatus}
                    disabled={orderSource !== "firestore"}
                    onChange={(event) =>
                      handlePaymentStatusChange(order, event.target.value as PaymentStatus)
                    }
                  >
                    {paymentStatusOptions.map((status) => (
                      <option key={status} value={status}>
                        {paymentStatusLabel(status)}
                      </option>
                    ))}
                  </select>
                  <PaymentMethodAdminFields
                    order={order}
                    orderSource={orderSource}
                    onUpdate={onUpdate}
                  />
                  <PaymentLinkActions
                    order={order}
                    orderSource={orderSource}
                    paymentLinks={paymentLinks}
                    onUpdate={onUpdate}
                    onSendEmail={handleSendPaymentLinkEmail}
                  />
                </td>
                <td className="px-4 py-4">
                  <div className="mb-2">
                    <AdminBadge tone={orderStatusTone(order.orderStatus)}>
                      {orderStatusLabel(order.orderStatus)}
                    </AdminBadge>
                  </div>
                  <select
                    className="input-field"
                    value={order.orderStatus}
                    disabled={orderSource !== "firestore"}
                    onChange={(event) => {
                      const historyNote =
                        window.prompt("Note historique optionnelle", "") || "";
                      void onUpdate(order.id, {
                        orderStatus: event.target.value as OrderStatus,
                        historyNote,
                      });
                    }}
                  >
                    {[
                      "new",
                      "contact_required",
                      "confirmed",
                      "preparing",
                      "out_for_delivery",
                      "shipped",
                      "delivered",
                      "cancelled",
                    ].map((status) => (
                      <option key={status} value={status}>
                        {orderStatusLabel(status)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-4">
                  <strong className="block text-forest">{order.delivery}</strong>
                  <div className="mt-2">
                    <AdminBadge tone={order.deliveryMethod === "postal" ? "neutral" : "gold"}>
                      {order.deliveryMethod === "postal" ? "Postale" : "Locale"}
                    </AdminBadge>
                  </div>
                  <span className="mt-1 block text-xs text-ink/55">
                    Minimum appliqué :{" "}
                    {order.deliveryMinimumApplied ??
                      (order.deliveryMethod === "postal" ? 15 : 20)}{" "}
                    EUR
                  </span>
                  {order.deliveryMethod === "postal" && (
                    <span
                      className={`mt-2 inline-flex rounded-full border px-2 py-1 text-xs ${
                        order.postalFreeShippingApplied
                          ? "border-forest/20 bg-forest text-ivory"
                          : "border-champagne/40 bg-cream text-forest"
                      }`}
                    >
                      {order.postalFreeShippingApplied
                        ? "Livraison offerte"
                        : "Frais postaux à confirmer"}
                    </span>
                  )}
                  {order.deliveryNote && (
                    <span className="mt-2 block text-xs leading-5 text-ink/60">
                      {order.deliveryNote}
                    </span>
                  )}
                  {order.deliveryAddress && (
                    <span className="mt-1 block text-xs leading-5 text-ink/60">
                      {order.deliveryAddress.line1}
                      {order.deliveryAddress.line2 ? `, ${order.deliveryAddress.line2}` : ""}
                      <br />
                      {order.deliveryAddress.postalCode} {order.deliveryAddress.city}
                    </span>
                  )}
                  {order.customerMessage && (
                    <span className="mt-2 block text-xs leading-5 text-forest">
                      Message : {order.customerMessage}
                    </span>
                  )}
                </td>
                <td className="px-4 py-4">
                  {order.items.length
                    ? order.items.map(formatOrderItemLine).join(", ")
                    : "A renseigner"}
                  {order.promoApplied && (
                    <span className="mt-2 block text-xs leading-5 text-forest">
                      {orderPromotionLabel(order)}
                      <br />
                      Remise : -{formatEuro(Number(order.discountAmount || 0))} EUR
                      <br />
                      Avant remise : {formatEuro(Number(order.subtotalBeforeDiscount || order.subtotal || 0))} EUR
                    </span>
                  )}
                </td>
                <td className="px-4 py-4">{order.total}</td>
                <td className="px-4 py-4">
                  <input
                    className="input-field"
                    defaultValue={order.paymentReference || ""}
                    placeholder="Référence règlement"
                    disabled={orderSource !== "firestore"}
                    onBlur={(event) =>
                      void onUpdate(order.id, {
                        paymentReference: event.currentTarget.value,
                      })
                    }
                  />
                  <input
                    className="input-field mt-2"
                    defaultValue={order.trackingNumber || ""}
                    placeholder="Suivi postal"
                    disabled={orderSource !== "firestore"}
                    onBlur={(event) =>
                      void onUpdate(order.id, {
                        trackingNumber: event.currentTarget.value,
                      })
                    }
                  />
                </td>
                <td className="px-4 py-4">
                  {invoiceByOrderId.get(order.id) ? (
                    <>
                      <strong className="block text-forest">
                        {invoiceByOrderId.get(order.id)?.invoiceNumber}
                      </strong>
                      <span className="text-xs text-ink/55">
                        {invoiceStatusLabel(invoiceByOrderId.get(order.id)?.status || "draft")}
                      </span>
                    </>
                  ) : (
                    <button
                      className="btn-secondary min-h-9 whitespace-nowrap px-3 py-2"
                      disabled={!onCreateInvoice || orderSource !== "firestore"}
                      onClick={() => void onCreateInvoice?.(order.id)}
                    >
                      Créer facture
                    </button>
                  )}
                </td>
                <td className="px-4 py-4 text-xs text-ink/60">
                  <NotificationStatus order={order} />
                </td>
                <td className="px-4 py-4">
                  <input
                    className="input-field"
                    defaultValue={order.internalNote || ""}
                    placeholder="Note"
                    disabled={orderSource !== "firestore"}
                    onBlur={(event) =>
                      void onUpdate(order.id, {
                        internalNote: event.currentTarget.value,
                      })
                    }
                  />
                </td>
                <td className="px-4 py-4 text-xs text-ink/60">
                  {order.statusHistory?.length
                    ? order.statusHistory
                        .slice(-3)
                        .map((entry) => orderStatusLabel(entry.status))
                        .join(" -> ")
                    : "Aucun historique"}
                </td>
                <td className="px-4 py-4">
                  <div className="flex min-w-36 flex-col gap-2">
                    {order.archived || order.hidden ? (
                      <button
                        className="btn-secondary min-h-8 px-2 py-1 text-xs"
                        disabled={orderSource !== "firestore"}
                        onClick={() => void onUpdate(order.id, { restore: true })}
                      >
                        Restaurer
                      </button>
                    ) : (
                      <>
                        <button
                          className="btn-secondary min-h-8 px-2 py-1 text-xs"
                          disabled={orderSource !== "firestore"}
                          onClick={() => {
                            const confirmed = window.confirm(
                              "Cette action masquera la commande de la vue principale. Elle restera consultable dans les archives.",
                            );
                            if (confirmed) void onUpdate(order.id, { archived: true });
                          }}
                        >
                          Archiver
                        </button>
                        <button
                          className="btn-secondary min-h-8 px-2 py-1 text-xs"
                          disabled={orderSource !== "firestore"}
                          onClick={() => {
                            const confirmed = window.confirm(
                              "Cette action masquera la commande de la vue principale. Elle restera consultable dans les archives.",
                            );
                            if (confirmed) void onUpdate(order.id, { hidden: true });
                          }}
                        >
                          Masquer
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DesktopOrderCard({
  order,
  invoice,
  orderSource,
  paymentLinks,
  onCreateInvoice,
  onUpdate,
  onDelete,
  onSendEmail,
  onRetryOrderEmails,
  emailRetrying,
  onRetryPurchaseAnalytics,
}: {
  order: AdminOrderListItem;
  invoice?: Invoice;
  orderSource: "firestore" | "empty";
  paymentLinks: AdminPaymentLink[];
  onCreateInvoice?: (orderId: string) => Promise<void>;
  onUpdate: (orderId: string, data: AdminOrderUpdateInput) => Promise<void>;
  onDelete: (orderId: string) => Promise<void>;
  onSendEmail: (input: {
    orderId: string;
    paymentLinkUrl: string;
    paymentLinkLabel: string;
    paymentLinkAmount: number;
    paymentLinkCurrency: "EUR";
  }) => Promise<void>;
  onRetryOrderEmails: (
    orderId: string,
    target: RetryOrderEmailTarget,
  ) => Promise<void>;
  emailRetrying: string;
  onRetryPurchaseAnalytics: (orderId: string) => Promise<void>;
}) {
  const isArchived = order.archived || order.hidden;

  return (
    <article className="rounded-lg border border-forest/10 bg-ivory p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-forest/10 pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <AdminBadge tone={order.orderType === "preorder" ? "gold" : "neutral"}>
              {order.orderType === "preorder" ? "Precommande" : "Commande"}
            </AdminBadge>
            <AdminBadge tone={order.deliveryMethod === "postal" ? "neutral" : "gold"}>
              {order.deliveryMethod === "postal" ? "Postale" : "Locale"}
            </AdminBadge>
            <AdminBadge tone={orderStatusTone(order.orderStatus)}>
              {orderStatusLabel(order.orderStatus)}
            </AdminBadge>
            <AdminBadge tone={paymentStatusTone(order.paymentStatus)}>
              {paymentStatusLabel(order.paymentStatus)}
            </AdminBadge>
          </div>
          <strong className="mt-3 block break-all text-base text-forest">{order.id}</strong>
          <p className="mt-1 text-sm text-ink/55">
            {order.customerEmail || "Email non renseigne"}
          </p>
        </div>
        <div className="text-right">
          <span className="block text-xs uppercase tracking-[0.14em] text-forest/50">
            Total
          </span>
          <strong className="font-display text-4xl leading-none text-forest">
            {order.total}
          </strong>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(220px,0.9fr)_minmax(280px,1.1fr)_minmax(320px,1.2fr)]">
        <section className="rounded-md bg-cream p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-forest/55">Client</p>
          <strong className="mt-2 block text-forest">{order.customer}</strong>
          <span className="block text-sm text-ink/60">{order.customerPhone || "Telephone absent"}</span>
          <div className="mt-4 flex flex-wrap gap-2">
            <a className="btn-secondary min-h-9 px-3 py-1.5 text-xs" href={telLink(order.customerPhone)}>
              Appeler
            </a>
            <a
              className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
              href={whatsappLink(order)}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp
            </a>
            <a className="btn-secondary min-h-9 px-3 py-1.5 text-xs" href={smsLink(order)}>
              SMS
            </a>
            <button
              className="btn-secondary min-h-9 px-3 py-1.5 text-xs"
              onClick={() => void copyOrderMessage(order)}
              type="button"
            >
              Copier
            </button>
          </div>
        </section>

        <section className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-forest/60">
              Statut commande
              <select
                className="input-field mt-2"
                value={order.orderStatus}
                disabled={orderSource !== "firestore"}
                onChange={(event) => {
                  const historyNote = window.prompt("Note historique optionnelle", "") || "";
                  void onUpdate(order.id, {
                    orderStatus: event.target.value as OrderStatus,
                    historyNote,
                  });
                }}
              >
                {[
                  "new",
                  "contact_required",
                  "confirmed",
                  "preparing",
                  "out_for_delivery",
                  "shipped",
                  "delivered",
                  "cancelled",
                ].map((status) => (
                  <option key={status} value={status}>
                    {orderStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.12em] text-forest/60">
              Reglement
              <select
                className="input-field mt-2"
                value={order.paymentStatus}
                disabled={orderSource !== "firestore"}
                onChange={(event) => {
                  const paymentStatus = event.target.value as PaymentStatus;
                  if (paymentStatus !== "paid") {
                    void onUpdate(order.id, { paymentStatus });
                    return;
                  }
                  const finalPaymentMethod = confirmedFinalPaymentMethodForPaid(order);
                  if (!finalPaymentMethod) return;
                  void onUpdate(order.id, { paymentStatus, finalPaymentMethod });
                }}
              >
                {paymentStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {paymentStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <PaymentMethodAdminFields
            order={order}
            orderSource={orderSource}
            onUpdate={onUpdate}
          />

          <div className="rounded-md border border-forest/10 p-3 text-sm leading-6 text-ink/70">
            <strong className="block text-forest">{order.delivery}</strong>
            <span className="text-xs text-ink/55">
              Minimum applique :{" "}
              {order.deliveryMinimumApplied ??
                (order.deliveryMethod === "postal" ? 15 : 20)}{" "}
              EUR
            </span>
            {order.deliveryMethod === "postal" && (
              <span
                className={`mt-2 inline-flex rounded-full border px-2 py-1 text-xs ${
                  order.postalFreeShippingApplied
                    ? "border-forest/20 bg-forest text-ivory"
                    : "border-champagne/40 bg-cream text-forest"
                }`}
              >
                {order.postalFreeShippingApplied
                  ? "Livraison offerte"
                  : "Frais postaux a confirmer"}
              </span>
            )}
            {order.deliveryAddress && (
              <span className="mt-2 block text-xs leading-5 text-ink/60">
                {order.deliveryAddress.line1}
                {order.deliveryAddress.line2 ? `, ${order.deliveryAddress.line2}` : ""}
                <br />
                {order.deliveryAddress.postalCode} {order.deliveryAddress.city}
              </span>
            )}
            {order.customerMessage && (
              <span className="mt-2 block text-xs text-forest">
                Message : {order.customerMessage}
              </span>
            )}
          </div>
        </section>

        <section className="grid gap-3">
          <div className="rounded-md bg-cream p-4 text-sm leading-6 text-ink/70">
            <p className="text-xs uppercase tracking-[0.14em] text-forest/55">Produits</p>
            <strong className="mt-2 block text-forest">
              {order.items.length
                ? order.items.map(formatOrderItemLine).join(", ")
                : "A renseigner"}
            </strong>
            {order.promoApplied && (
              <span className="mt-2 block text-xs text-forest">
                {orderPromotionLabel(order)} : -{formatEuro(Number(order.discountAmount || 0))} EUR
                <br />
                Avant remise : {formatEuro(Number(order.subtotalBeforeDiscount || order.subtotal || 0))} EUR
              </span>
            )}
          </div>
          <PaymentLinkActions
            order={order}
            orderSource={orderSource}
            paymentLinks={paymentLinks}
            onUpdate={onUpdate}
            onSendEmail={onSendEmail}
          />
        </section>
      </div>

      <div className="mt-5 grid gap-3 border-t border-forest/10 pt-4 xl:grid-cols-[1fr_1fr_1fr_auto]">
        <input
          className="input-field"
          defaultValue={order.paymentReference || ""}
          placeholder="Reference reglement"
          disabled={orderSource !== "firestore"}
          onBlur={(event) =>
            void onUpdate(order.id, {
              paymentReference: event.currentTarget.value,
            })
          }
        />
        <input
          className="input-field"
          defaultValue={order.trackingNumber || ""}
          placeholder="Suivi postal"
          disabled={orderSource !== "firestore"}
          onBlur={(event) =>
            void onUpdate(order.id, {
              trackingNumber: event.currentTarget.value,
            })
          }
        />
        <input
          className="input-field"
          defaultValue={order.internalNote || ""}
          placeholder="Note interne"
          disabled={orderSource !== "firestore"}
          onBlur={(event) =>
            void onUpdate(order.id, {
              internalNote: event.currentTarget.value,
            })
          }
        />
        <div className="flex flex-wrap gap-2 xl:justify-end">
          {invoice ? (
            <div className="rounded-md border border-forest/10 px-3 py-2 text-xs text-ink/60">
              <strong className="block text-forest">{invoice.invoiceNumber}</strong>
              {invoiceStatusLabel(invoice.status)}
            </div>
          ) : (
            <button
              className="btn-secondary min-h-10 whitespace-nowrap px-3 py-2 text-xs"
              disabled={!onCreateInvoice || orderSource !== "firestore"}
              onClick={() => void onCreateInvoice?.(order.id)}
              type="button"
            >
              Creer facture
            </button>
          )}
          {isArchived ? (
            <button
              className="btn-secondary min-h-10 px-3 py-2 text-xs"
              disabled={orderSource !== "firestore"}
              onClick={() => void onUpdate(order.id, { restore: true })}
              type="button"
            >
              Restaurer
            </button>
          ) : (
            <>
              <button
                className="btn-secondary min-h-10 px-3 py-2 text-xs"
                disabled={orderSource !== "firestore"}
                onClick={() => {
                  const confirmed = window.confirm(
                    "Cette action masquera la commande de la vue principale. Elle restera consultable dans les archives.",
                  );
                  if (confirmed) void onUpdate(order.id, { archived: true });
                }}
                type="button"
              >
                Archiver
              </button>
              <button
                className="btn-secondary min-h-10 px-3 py-2 text-xs"
                disabled={orderSource !== "firestore"}
                onClick={() => {
                  const confirmed = window.confirm(
                    "Cette action masquera la commande de la vue principale. Elle restera consultable dans les archives.",
                  );
                  if (confirmed) void onUpdate(order.id, { hidden: true });
                }}
                type="button"
              >
                Masquer
              </button>
            </>
          )}
          {canRetryPurchaseAnalytics(order) && (
            <button
              className="btn-secondary min-h-10 px-3 py-2 text-xs"
              disabled={orderSource !== "firestore"}
              onClick={() => void onRetryPurchaseAnalytics(order.id)}
              type="button"
            >
              Relancer GA4
            </button>
          )}
          {canDeleteCancelledOrder(order) && (
            <button
              className="min-h-10 rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              disabled={orderSource !== "firestore"}
              onClick={() => {
                if (confirmPermanentOrderDeletion(order.id)) {
                  void onDelete(order.id);
                }
              }}
              type="button"
            >
              Supprimer
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-xs text-ink/60 xl:grid-cols-2">
        <div>
          <strong className="block text-forest">Notifications</strong>
          <NotificationStatus order={order} />
          <EmailRetryActions
            orderId={order.id}
            disabled={orderSource !== "firestore"}
            retrying={emailRetrying}
            onRetry={onRetryOrderEmails}
          />
        </div>
        <div>
          <strong className="block text-forest">Historique</strong>
          {order.statusHistory?.length
            ? order.statusHistory
                .slice(-4)
                .map((entry) => orderStatusLabel(entry.status))
                .join(" -> ")
            : "Aucun historique"}
        </div>
      </div>
    </article>
  );
}

function orderMatchesAdminFilter(
  order: {
    orderType?: string;
    deliveryMethod?: string;
    orderStatus: string;
    archived?: boolean;
    hidden?: boolean;
    deletedAt?: string;
  },
  filter: string,
) {
  const removedFromMainView = order.archived === true || order.hidden === true || Boolean(order.deletedAt);
  if (filter === "active") {
    return (
      !removedFromMainView &&
      !["delivered", "cancelled"].includes(order.orderStatus)
    );
  }
  if (filter === "archived") return removedFromMainView;
  if (filter === "finished") return ["delivered", "cancelled"].includes(order.orderStatus);
  if (filter === "all") return true;
  if (filter === "preorder") return order.orderType === "preorder";
  if (filter === "local") return order.deliveryMethod === "local_express";
  if (filter === "postal") return order.deliveryMethod === "postal";
  if (removedFromMainView) return false;
  return order.orderStatus === filter;
}

function canRetryPurchaseAnalytics(order: AdminOrderListItem) {
  return (
    order.paymentStatus === "paid" &&
    order.analytics?.consentGrantedAtSubmission === true &&
    !order.analytics.consentRevokedAt &&
    Boolean(order.analytics.clientId) &&
    ["pending", "failed"].includes(order.analytics.purchaseStatus)
  );
}

function PaymentMethodAdminFields({
  order,
  orderSource,
  onUpdate,
}: {
  order: AdminOrderListItem;
  orderSource: "firestore" | "empty";
  onUpdate: (orderId: string, data: AdminOrderUpdateInput) => Promise<void>;
}) {
  return (
    <div className="mt-3 rounded-md border border-forest/10 bg-ivory p-3 text-xs leading-5 text-ink/65">
      <span className="block text-ink/55">Paiement souhaité par le client</span>
      <strong className="block text-forest">
        {preferredPaymentMethodLabel(order.preferredPaymentMethod)}
      </strong>
      <label className="mt-3 block font-semibold uppercase tracking-[0.12em] text-forest/60">
        Paiement final confirmé
        <select
          className="input-field mt-2"
          value={order.finalPaymentMethod || ""}
          disabled={orderSource !== "firestore" || order.paymentStatus === "paid"}
          onChange={(event) =>
            void onUpdate(order.id, {
              finalPaymentMethod: event.target.value as FinalPaymentMethod | "",
            })
          }
        >
          <option value="">À choisir avant paiement</option>
          {allowedFinalPaymentMethods(order).map((method) => (
            <option key={method} value={method}>
              {finalPaymentMethodLabel(method)}
            </option>
          ))}
        </select>
      </label>
      {order.paymentConfirmedAt && (
        <span className="mt-2 block text-ink/55">
          Confirmé le {order.paymentConfirmedAt}
          {order.paymentConfirmedBy ? ` par ${order.paymentConfirmedBy}` : ""}
        </span>
      )}
    </div>
  );
}

function PaymentLinkActions({
  order,
  orderSource,
  paymentLinks,
  onUpdate,
  onSendEmail,
}: {
  order: {
    id: string;
    customer: string;
    customerPhone?: string;
    customerEmail?: string;
    deliveryMethod?: string;
    delivery: string;
    total: string;
    paymentLinkUrl?: string;
    paymentLinkLabel?: string;
    paymentLinkAmount?: number;
    paymentLinkCurrency?: "EUR";
    paymentLinkSent?: boolean;
    paymentLinkSentAt?: string;
    paymentLinkChannel?: PaymentLinkChannel;
  };
  orderSource: "firestore" | "empty";
  paymentLinks: AdminPaymentLink[];
  onUpdate: (
    orderId: string,
    data: {
      paymentLinkUrl?: string;
      paymentLinkLabel?: string;
      paymentLinkAmount?: number;
      paymentLinkCurrency?: "EUR";
      paymentLinkSent?: boolean;
      paymentLinkChannel?: PaymentLinkChannel | "";
      paymentStatus?: PaymentStatus;
    },
  ) => Promise<void>;
  onSendEmail: (input: {
    orderId: string;
    paymentLinkUrl: string;
    paymentLinkLabel: string;
    paymentLinkAmount: number;
    paymentLinkCurrency: "EUR";
  }) => Promise<void>;
}) {
  const matchingLink = paymentLinks.find((link) => link.amount === parseEuro(order.total));
  const savedKnownLink = paymentLinks.find((link) => link.url === order.paymentLinkUrl);
  const initialUrl = order.paymentLinkUrl
    ? savedKnownLink?.url || "custom"
    : matchingLink?.url || "";
  const [selectedUrl, setSelectedUrl] = useState(initialUrl);
  const [customUrl, setCustomUrl] = useState(savedKnownLink ? "" : order.paymentLinkUrl || "");
  const [customAmount, setCustomAmount] = useState(order.paymentLinkAmount || parseEuro(order.total));
  const selectedLink = paymentLinks.find((link) => link.url === selectedUrl);
  const customLink =
    selectedUrl === "custom" && customUrl.trim() && customAmount > 0
      ? {
          label: `Paiement CB ${formatEuro(customAmount)} EUR`,
          url: customUrl.trim(),
          amount: customAmount,
          currency: "EUR" as const,
        }
      : null;
  const activeLink = selectedLink || customLink;
  const disabled = orderSource !== "firestore" || !activeLink;
  const exactMatchMissing = Boolean(paymentLinks.length && !order.paymentLinkUrl && !matchingLink);

  useEffect(() => {
    const knownLink = paymentLinks.find((link) => link.url === order.paymentLinkUrl);
    setSelectedUrl(order.paymentLinkUrl ? knownLink?.url || "custom" : matchingLink?.url || "");
    setCustomUrl(knownLink ? "" : order.paymentLinkUrl || "");
    setCustomAmount(order.paymentLinkAmount || parseEuro(order.total));
  }, [order.id, order.paymentLinkAmount, order.paymentLinkUrl, order.total, matchingLink?.url, paymentLinks]);

  async function markSent(channel: PaymentLinkChannel) {
    if (!activeLink) return;
    await onUpdate(order.id, {
      paymentLinkUrl: activeLink.url,
      paymentLinkLabel: activeLink.label,
      paymentLinkAmount: activeLink.amount,
      paymentLinkCurrency: activeLink.currency,
      paymentLinkSent: true,
      paymentLinkChannel: channel,
      paymentStatus: "payment_link_sent",
    });
  }

  return (
    <div className="mt-3 rounded-md border border-forest/10 bg-cream p-3 text-xs text-forest">
      <div className="flex items-center justify-between gap-2">
        <strong>Lien de paiement CB</strong>
        <AdminBadge tone={order.paymentLinkSent ? "success" : "warning"}>
          {order.paymentLinkSent ? "Lien CB envoyé" : "Lien CB non envoyé"}
        </AdminBadge>
      </div>
      <p className="mt-2 text-[11px] text-ink/60">
        Montant recommandé de la commande : {order.total}
      </p>
      <p className="mt-1 text-[11px] text-ink/60">
        Choisissez le lien correspondant au montant à demander au client.
      </p>
      <select
        className="input-field mt-2"
        value={selectedUrl}
        disabled={orderSource !== "firestore" || !paymentLinks.length}
        onChange={(event) => setSelectedUrl(event.target.value)}
      >
        {!paymentLinks.length && <option value="">Aucun lien disponible</option>}
        {!!paymentLinks.length && <option value="">Choisir manuellement</option>}
        {paymentLinks.map((link) => (
          <option key={link.id} value={link.url}>
            {link.label}
          </option>
        ))}
        <option value="custom">Lien montant exact personnalisé</option>
      </select>
      {selectedUrl === "custom" && (
        <div className="mt-3 grid gap-2">
          <input
            className="input-field"
            value={customUrl}
            onChange={(event) => setCustomUrl(event.target.value)}
            placeholder="Coller le lien de paiement exact"
          />
          <label className="text-[11px] text-ink/60">
            Montant du lien personnalisé
            <input
              className="input-field mt-1"
              min="0"
              step="0.01"
              type="number"
              value={customAmount}
              onChange={(event) => setCustomAmount(Number(event.target.value))}
            />
          </label>
        </div>
      )}
      {exactMatchMissing && (
        <p className="mt-2 text-[11px] leading-5 text-amber-800">
          Aucun lien ne correspond exactement au total. Choisissez un lien existant ou collez un lien au montant exact.
        </p>
      )}
      <p className="mt-2 break-all text-[11px] text-ink/55">
        {activeLink
          ? `${activeLink.label} - ${activeLink.amount} ${activeLink.currency}`
          : order.paymentLinkLabel || "Aucun lien sélectionné"}
      </p>
      {order.paymentLinkSent && (
        <p className="mt-1 text-[11px] text-ink/55">
          Montant du lien envoyé :{" "}
          {order.paymentLinkAmount
            ? `${order.paymentLinkAmount} ${order.paymentLinkCurrency || "EUR"} - `
            : ""}
          Envoyé via {paymentChannelLabel(order.paymentLinkChannel)}
          {order.paymentLinkSentAt ? ` - ${order.paymentLinkSentAt}` : ""}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="btn-secondary min-h-8 px-2 py-1 text-xs"
          disabled={disabled}
          onClick={() => activeLink && void navigator.clipboard.writeText(activeLink.url)}
          type="button"
        >
          Copier lien
        </button>
        <button
          className="btn-secondary min-h-8 px-2 py-1 text-xs"
          disabled={disabled}
          onClick={() =>
            activeLink &&
            void navigator.clipboard.writeText(
              paymentLinkMessage({
                ...order,
                paymentLinkUrl: activeLink.url,
                paymentLinkAmount: activeLink.amount,
                paymentLinkCurrency: activeLink.currency,
              }),
            )
          }
          type="button"
        >
          Copier message
        </button>
        <a
          className={
            disabled
              ? "btn-secondary pointer-events-none min-h-8 px-2 py-1 text-xs opacity-50"
              : "btn-secondary min-h-8 px-2 py-1 text-xs"
          }
          href={
            activeLink
              ? whatsappPaymentLink({
                  ...order,
                  paymentLinkUrl: activeLink.url,
                  paymentLinkAmount: activeLink.amount,
                  paymentLinkCurrency: activeLink.currency,
                })
              : "#"
          }
          target="_blank"
          rel="noreferrer"
          onClick={() => activeLink && void markSent("whatsapp")}
        >
          WhatsApp
        </a>
        <a
          className={
            disabled
              ? "btn-secondary pointer-events-none min-h-8 px-2 py-1 text-xs opacity-50"
              : "btn-secondary min-h-8 px-2 py-1 text-xs"
          }
          href={
            activeLink
              ? smsPaymentLink({
                  ...order,
                  paymentLinkUrl: activeLink.url,
                  paymentLinkAmount: activeLink.amount,
                  paymentLinkCurrency: activeLink.currency,
                })
              : "#"
          }
          onClick={() => activeLink && void markSent("sms")}
        >
          SMS
        </a>
        <button
          className="btn-secondary min-h-8 px-2 py-1 text-xs"
          disabled={disabled || !order.customerEmail}
          onClick={() =>
            activeLink &&
            void onSendEmail({
              orderId: order.id,
              paymentLinkUrl: activeLink.url,
              paymentLinkLabel: activeLink.label,
              paymentLinkAmount: activeLink.amount,
              paymentLinkCurrency: activeLink.currency,
            })
          }
          type="button"
        >
          Email
        </button>
        <button
          className="btn-secondary min-h-8 px-2 py-1 text-xs"
          disabled={disabled}
          onClick={() => void markSent("other")}
          type="button"
        >
          Marquer envoyé
        </button>
      </div>
    </div>
  );
}

function EmailRetryActions({
  orderId,
  disabled,
  retrying,
  onRetry,
}: {
  orderId: string;
  disabled: boolean;
  retrying: string;
  onRetry: (orderId: string, target: RetryOrderEmailTarget) => Promise<void>;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {([
        ["client", "Relancer client"],
        ["admin", "Relancer admins"],
        ["all", "Tout relancer"],
      ] as const).map(([target, label]) => (
        <button
          key={target}
          className="btn-secondary min-h-8 px-2 py-1 text-xs"
          disabled={disabled || Boolean(retrying)}
          onClick={() => void onRetry(orderId, target)}
          type="button"
        >
          {retrying === `${orderId}:${target}` ? "Relance..." : label}
        </button>
      ))}
    </div>
  );
}

function NotificationStatus({
  order,
}: {
  order: { emails?: AdminOrderRow["emails"] };
}) {
  const clientStatus = order.emails?.orderConfirmationStatus;
  const adminStatus = order.emails?.adminNotificationStatus;
  const recipients = order.emails?.adminNotificationRecipients || {};
  if (!clientStatus && !adminStatus) return <span>Aucune donnée</span>;
  const hasWarning = [clientStatus, adminStatus].some(
    (status) => status && status !== "sent",
  );
  return (
    <div
      className={`mt-1 grid gap-1 rounded-md p-2 ${
        hasWarning ? "border border-red-200 bg-red-50 text-red-800" : "text-forest"
      }`}
    >
      <span>Client : {emailStatusLabel(clientStatus)}</span>
      <span>Administrateurs : {emailStatusLabel(adminStatus)}</span>
      {Object.entries(recipients).map(([email, result]) => (
        <span key={email}>
          {email} : {result.status}
          {result.reason ? ` (${result.reason})` : ""}
        </span>
      ))}
    </div>
  );
}

function emailStatusLabel(status?: string) {
  if (status === "sent") return "envoyé";
  if (status === "partial") return "partiel";
  if (status === "failed") return "échec";
  if (status === "skipped") return "ignoré";
  return "en attente";
}

function SourceCard({
  label,
  value,
  count,
}: {
  label: string;
  value: string;
  count: number;
}) {
  return (
    <article className="admin-card">
      <p className="text-sm text-ink/55">{label}</p>
      <strong className="mt-2 block text-forest">{count} entrée(s)</strong>
      <span className="text-xs text-ink/50">Source : {sourceLabel(value)}</span>
    </article>
  );
}

function SourceLine(props: { source: string }) {
  void props;
  return null;
}

function sourceLabel(source: string) {
  if (source === "firestore") return "base en ligne";
  if (source === "local") return "secours local";
  if (source === "empty") return "aucune donnée";
  return source;
}

function AdminFavoritesPanel({ products }: { products: Product[] }) {
  const [stats, setStats] = useState<FavoriteProductStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getAdminFavoriteStats()
      .then(setStats)
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return <p className="mt-8 text-forest/70">Chargement des favoris...</p>;
  }

  return (
    <section className="mt-8">
      <p className="text-sm text-ink/60">
        Statistiques agrégées, sans données personnelles client.
      </p>
      {!stats.length && (
        <AdminEmptyState
          title="Aucun favori enregistré."
          description="Les produits ajoutés aux favoris apparaîtront ici."
        />
      )}
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {stats.map((stat) => {
          const product = products.find((entry) => entry.id === stat.productId);
          return (
            <article key={stat.productId} className="admin-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-champagne">
                    {stat.productCategory === "flowers" ? "Fleur CBD" : "Résine CBD"}
                  </p>
                  <h2 className="mt-1 font-display text-2xl text-forest">
                    {stat.productName}
                  </h2>
                </div>
                <AdminBadge tone="gold">{`${stat.count} favori(s)`}</AdminBadge>
              </div>
              {product && (
                <div className="mt-4 grid grid-cols-3 gap-2 text-sm text-ink/65">
                  <span>{product.price.toFixed(2).replace(".", ",")} EUR/g</span>
                  <span>{product.stock} g</span>
                  <span>{product.isActive ? "Actif" : "Inactif"}</span>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AdminReviewsPanel() {
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [filter, setFilter] = useState<"all" | ReviewStatus>("all");
  const [isLoading, setIsLoading] = useState(true);

  async function loadReviews() {
    setIsLoading(true);
    setReviews(await getAdminProductReviews());
    setIsLoading(false);
  }

  useEffect(() => {
    void loadReviews();
  }, []);

  const visibleReviews = reviews.filter(
    (review) => filter === "all" || review.status === filter,
  );

  if (isLoading) {
    return <p className="mt-8 text-forest/70">Chargement des avis...</p>;
  }

  return (
    <section className="mt-8">
      <div className="flex flex-wrap gap-2">
        {[
          ["all", "Tous"],
          ["pending", "Nouveaux"],
          ["internal", "Lus"],
          ["approved", "Validés en interne"],
          ["rejected", "Rejetés"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={filter === value ? "btn-primary" : "btn-secondary"}
            onClick={() => setFilter(value as "all" | ReviewStatus)}
          >
            {label}
          </button>
        ))}
      </div>
      {!visibleReviews.length && (
        <AdminEmptyState
          title="Aucun avis pour ce filtre."
          description="Les avis déposés après une commande livrée apparaîtront ici."
        />
      )}
      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        {visibleReviews.map((review) => (
          <article key={review.id} className="admin-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl text-forest">
                  {review.productName}
                </h2>
                <p className="mt-1 text-sm text-ink/55">
                  Commande {review.orderId.slice(0, 8).toUpperCase()}
                </p>
              </div>
              <div className="flex gap-2">
                <AdminBadge tone="gold">{`${review.rating}/5`}</AdminBadge>
                <AdminBadge tone="neutral">Interne</AdminBadge>
              </div>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-ink/75">
              {review.comment}
            </p>
            <p className="mt-3 text-xs text-ink/50">
              Statut : {reviewStatusLabel(review.status)} · Visible publiquement : non
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {review.status === "pending" && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={async () => {
                    await updateReviewStatus(review.id, "internal");
                    await loadReviews();
                  }}
                >
                  Marquer comme lu
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={async () => {
                  await updateReviewStatus(review.id, "approved");
                  await loadReviews();
                }}
              >
                Valider en interne
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={async () => {
                  await updateReviewStatus(review.id, "rejected");
                  await loadReviews();
                }}
              >
                Rejeter
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function reviewStatusLabel(status: ReviewStatus) {
  if (status === "pending") return "Nouveau";
  if (status === "internal") return "Lu";
  if (status === "approved") return "Validé en interne";
  return "Rejeté";
}

type ProductCategoryFilter = ProductCategory | "all" | "other" | "active" | "inactive";
type StockFilter =
  | ProductCategoryFilter
  | "stock_ok"
  | "low_stock"
  | "out_of_stock";
type DeliveryZoneFilter = "all" | "active" | "inactive" | "open" | "closed";
type AdminFilterOption<T extends string> = {
  value: T;
  label: string;
  count: number;
};

function productCategoryLabel(category: ProductCategory) {
  const labels: Record<ProductCategory, string> = {
    flowers: "Fleurs CBD",
    resins: "Resines CBD",
    oils: "Huiles CBD",
    packs: "Autres produits CBD",
  };
  return labels[category] || "Autres produits CBD";
}

function categoryTone(category: ProductCategory): AdminBadgeTone {
  if (category === "flowers") return "success";
  if (category === "resins") return "gold";
  return "neutral";
}

function isOtherProductCategory(category: ProductCategory) {
  return !["flowers", "resins"].includes(category);
}

function productMatchesCategoryFilter(product: Product, filter: ProductCategoryFilter) {
  if (filter === "all") return true;
  if (filter === "active") return product.isActive === true;
  if (filter === "inactive") return product.isActive === false;
  if (filter === "other") return isOtherProductCategory(product.category);
  return product.category === filter;
}

function productMatchesAdminSearch(product: Product, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [
    product.name,
    product.slug,
    product.id,
    product.internalReference,
    ...(product.legacyInternalReferences || []),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function buildProductCategoryFilters(products: Product[]): AdminFilterOption<ProductCategoryFilter>[] {
  const count = (value: ProductCategoryFilter) =>
    products.filter((product) => productMatchesCategoryFilter(product, value)).length;

  return [
    { value: "all" as const, label: "Tous", count: products.length },
    { value: "active" as const, label: "Actifs", count: count("active") },
    { value: "inactive" as const, label: "Inactifs", count: count("inactive") },
    { value: "flowers" as const, label: "Fleurs CBD", count: count("flowers") },
    { value: "resins" as const, label: "Resines CBD", count: count("resins") },
    { value: "other" as const, label: "Autres", count: count("other") },
  ];
}

function buildStockFilters(products: Product[]): AdminFilterOption<StockFilter>[] {
  return [
    ...buildProductCategoryFilters(products),
    {
      value: "stock_ok" as const,
      label: "Stock OK",
      count: products.filter((product) => product.stock > product.lowStockThreshold).length,
    },
    {
      value: "low_stock" as const,
      label: "Stock bas",
      count: products.filter(
        (product) => product.stock > 0 && product.stock <= product.lowStockThreshold,
      ).length,
    },
    {
      value: "out_of_stock" as const,
      label: "Rupture",
      count: products.filter((product) => product.stock <= 0).length,
    },
  ];
}

function productMatchesStockFilter(product: Product, filter: StockFilter) {
  if (filter === "stock_ok") return product.stock > product.lowStockThreshold;
  if (filter === "low_stock") return product.stock > 0 && product.stock <= product.lowStockThreshold;
  if (filter === "out_of_stock") return product.stock <= 0;
  if (filter === "all") return true;
  if (filter === "active") return product.isActive === true;
  if (filter === "inactive") return product.isActive === false;
  if (filter === "other") return isOtherProductCategory(product.category);
  return product.category === filter;
}

function stockLabel(product: Product) {
  if (product.stock <= 0) return "Rupture";
  if (product.stock <= product.lowStockThreshold) return "Stock bas";
  return "Stock OK";
}

function stockTone(product: Product): "success" | "warning" | "danger" {
  if (product.stock <= 0) return "danger";
  if (product.stock <= product.lowStockThreshold) return "warning";
  return "success";
}

function buildDeliveryZoneFilters(zones: DeliveryZone[]): AdminFilterOption<DeliveryZoneFilter>[] {
  const closedStatuses: DeliveryZoneStatus[] = ["temporarily_closed", "coming_soon", "disabled"];
  return [
    { value: "all" as const, label: "Toutes", count: zones.length },
    { value: "active" as const, label: "Actives", count: zones.filter((zone) => zone.isActive).length },
    { value: "inactive" as const, label: "Inactives", count: zones.filter((zone) => !zone.isActive).length },
    {
      value: "open" as const,
      label: "Ouvertes",
      count: zones.filter((zone) => zone.isActive && (zone.status || "open") === "open").length,
    },
    {
      value: "closed" as const,
      label: "Fermees",
      count: zones.filter((zone) => !zone.isActive || closedStatuses.includes(zone.status || "disabled")).length,
    },
  ];
}

function deliveryZoneMatchesFilter(zone: DeliveryZone, filter: DeliveryZoneFilter) {
  const status = zone.status || (zone.isActive ? "open" : "disabled");
  if (filter === "active") return zone.isActive;
  if (filter === "inactive") return !zone.isActive;
  if (filter === "open") return zone.isActive && status === "open";
  if (filter === "closed") return !zone.isActive || status !== "open";
  return true;
}

function deliveryStatusLabel(status: DeliveryZoneStatus, isActive: boolean) {
  if (!isActive) return "Desactivee";
  if (status === "open") return "Ouverte";
  if (status === "temporarily_closed") return "Fermee";
  if (status === "coming_soon") return "Bientot";
  return "Desactivee";
}

function deliveryStatusTone(status: DeliveryZoneStatus, isActive: boolean): AdminBadgeTone {
  if (!isActive || status === "disabled") return "muted";
  if (status === "open") return "success";
  if (status === "temporarily_closed") return "warning";
  return "gold";
}

function orderStatusTone(
  status: string,
): "success" | "warning" | "danger" | "neutral" | "gold" | "muted" {
  if (["delivered", "finished"].includes(status)) return "success";
  if (status === "cancelled") return "danger";
  if (["new", "contact_required"].includes(status)) return "warning";
  if (["out_for_delivery", "shipped"].includes(status)) return "gold";
  return "neutral";
}

function paymentStatusTone(
  status: string,
): "success" | "warning" | "danger" | "neutral" | "gold" | "muted" {
  if (status === "paid") return "success";
  if (status === "cancelled") return "danger";
  if (status === "payment_link_sent") return "gold";
  if (["to_confirm", "pending"].includes(status)) return "warning";
  return "neutral";
}

type AccountingPeriodRange = {
  start: Date;
  end: Date;
};

type AccountingMetricKey =
  | "productNetRevenue"
  | "deliveryRevenue"
  | "collectedRevenue"
  | "supplierPurchasesTotal"
  | "estimatedProductCost"
  | "estimatedStockValue"
  | "grossMargin";

type AccountingProductRow = {
  productId: string;
  productName: string;
  quantitySold: number;
  productNetRevenue: number;
  purchaseCost: number;
  grossMargin: number;
  grossMarkupRate: number | null;
  grossMarginRate: number | null;
  hasEstimatedCost: boolean;
  hasMissingCost: boolean;
  costSources: Set<string>;
};

type ProductCostFilter =
  | "all"
  | "supplier"
  | "manual_fallback"
  | "missing"
  | "large_gap";

function buildAccountingSummary(
  orders: AdminOrderRow[],
  products: Product[],
  productCostMap: Map<string, ProductCost>,
  supplierPurchases: SupplierPurchase[],
  weightedSupplierCosts: Map<string, WeightedSupplierCost>,
  range: AccountingPeriodRange,
) {
  const productNameById = new Map(products.map((product) => [product.id, product.name]));
  const supplierPurchasesTotal = supplierPurchases
    .filter((purchase) => purchase.status === "validated")
    .filter((purchase) => {
      const date = parseAdminDate(purchase.validatedAt || purchase.invoiceDate);
      return Boolean(date && date >= range.start && date < range.end);
    })
    .reduce((sum, purchase) => sum + Number(purchase.totalExVat || 0), 0);
  const estimatedStockValue = estimateStockValue(products, weightedSupplierCosts);
  const periodOrders = orders.filter((order) => {
    if (isCancelledOrDeletedOrder(order)) return false;
    const date = accountingDate(order);
    return Boolean(date && date >= range.start && date < range.end);
  });
  const paidOrders = periodOrders.filter((order) => order.paymentStatus === "paid");
  const receivableOrders = periodOrders.filter((order) =>
    ["to_confirm", "payment_link_sent", "pending"].includes(order.paymentStatus),
  );
  const collectedRevenue = paidOrders.reduce((sum, order) => sum + orderTotalAmount(order), 0);
  const receivableAmount = receivableOrders.reduce((sum, order) => sum + orderTotalAmount(order), 0);
  const discounts = paidOrders.reduce((sum, order) => sum + orderDiscountAmount(order), 0);
  const productNetRevenue = paidOrders.reduce((sum, order) => sum + orderProductNetRevenue(order), 0);
  const deliveryRevenue = paidOrders.reduce((sum, order) => sum + Number(order.deliveryFee || 0), 0);
  const missingCostIds = new Set<string>();
  const productRowsById = new Map<string, AccountingProductRow>();
  let hasUnfrozenHistoricalCosts = false;
  let estimatedProductCost = 0;

  paidOrders.forEach((order) => {
    const orderProductRevenue = orderProductNetRevenue(order);
    const grossLinesTotal = order.items.reduce(
      (sum, item) => sum + orderItemLineTotal(item),
      0,
    );

    order.items.forEach((item) => {
      const quantity = Number(item.quantity || 0);
      const grossLineRevenue = orderItemLineTotal(item);
      const lineProductNetRevenue = grossLinesTotal > 0
        ? orderProductRevenue * (grossLineRevenue / grossLinesTotal)
        : 0;
      const costResult = orderItemPurchaseCost(item, weightedSupplierCosts, productCostMap);

      if (costResult.status === "missing") missingCostIds.add(item.productId);
      if (costResult.status === "estimated") hasUnfrozenHistoricalCosts = true;
      estimatedProductCost += costResult.cost;

      const existing = productRowsById.get(item.productId) ?? {
        productId: item.productId,
        productName: productNameById.get(item.productId) || item.name || item.productId,
        quantitySold: 0,
        productNetRevenue: 0,
        purchaseCost: 0,
        grossMargin: 0,
        grossMarkupRate: null,
        grossMarginRate: null,
        hasEstimatedCost: false,
        hasMissingCost: false,
        costSources: new Set<string>(),
      };
      existing.quantitySold += quantity;
      existing.productNetRevenue += lineProductNetRevenue;
      existing.purchaseCost += costResult.cost;
      existing.hasEstimatedCost ||= costResult.status === "estimated";
      existing.hasMissingCost ||= costResult.status === "missing";
      if (costResult.source) existing.costSources.add(costResult.source);
      productRowsById.set(item.productId, existing);
    });
  });

  const grossMargin = productNetRevenue - estimatedProductCost;
  const grossMarkupRate = productNetRevenue > 0 ? grossMargin / productNetRevenue : null;
  const grossMarginRate = estimatedProductCost > 0 ? grossMargin / estimatedProductCost : null;
  const localOrders = periodOrders.filter((order) => order.deliveryMethod === "local_express").length;
  const postalOrders = periodOrders.filter((order) => order.deliveryMethod === "postal").length;
  const missingCostProducts = [...missingCostIds].map(
    (productId) => productNameById.get(productId) || productId,
  );
  const productRows = [...productRowsById.values()]
    .map((row) => {
      const productGrossMargin = row.productNetRevenue - row.purchaseCost;
      return {
        ...row,
        quantitySold: roundAccounting(row.quantitySold),
        productNetRevenue: roundAccounting(row.productNetRevenue),
        purchaseCost: roundAccounting(row.purchaseCost),
        grossMargin: roundAccounting(productGrossMargin),
        grossMarkupRate: row.hasMissingCost || row.productNetRevenue <= 0
          ? null
          : productGrossMargin / row.productNetRevenue,
        grossMarginRate: row.hasMissingCost || row.purchaseCost <= 0
          ? null
          : productGrossMargin / row.purchaseCost,
      };
    })
    .sort((left, right) => right.productNetRevenue - left.productNetRevenue);
  const comparisonValues: Record<AccountingMetricKey, number> = {
    productNetRevenue,
    deliveryRevenue,
    collectedRevenue,
    supplierPurchasesTotal,
    estimatedProductCost,
    estimatedStockValue,
    grossMargin,
  };

  return {
    periodLabel: `${formatLocalDate(range.start)} - ${formatLocalDate(new Date(range.end.getTime() - 1))}`,
    totalOrders: periodOrders.length,
    missingCostProducts,
    hasUnfrozenHistoricalCosts,
    productRows,
    comparisonValues,
    comparisonMetrics: [
      { key: "productNetRevenue" as const, label: "CA produits net", value: formatCurrency(productNetRevenue) },
      { key: "collectedRevenue" as const, label: "CA total encaisse", value: formatCurrency(collectedRevenue) },
      { key: "estimatedProductCost" as const, label: "Cout des marchandises vendues", value: formatCurrency(estimatedProductCost) },
      { key: "grossMargin" as const, label: "Marge brute", value: formatCurrency(grossMargin) },
    ],
    metrics: [
      { label: "CA produits net encaisse", value: formatCurrency(productNetRevenue), detail: "Hors frais de livraison, apres remises" },
      { label: "Frais de livraison encaisses", value: formatCurrency(deliveryRevenue), detail: "Commandes payees uniquement" },
      { label: "Remises accordees", value: formatCurrency(discounts), detail: "Remises sur commandes payees" },
      { label: "CA total encaisse", value: formatCurrency(collectedRevenue), detail: "Produits + livraison, commandes payees" },
      { label: "Achats fournisseurs valides", value: formatCurrency(supplierPurchasesTotal), detail: "Factures fournisseur validees sur la periode" },
      { label: "Commandes totales", value: String(periodOrders.length), detail: "Commandes non annulees sur la periode" },
      { label: "Commandes payees", value: String(paidOrders.length), detail: "paymentStatus paid" },
      { label: "Panier moyen paye", value: formatCurrency(paidOrders.length ? collectedRevenue / paidOrders.length : 0), detail: "Commandes payees uniquement" },
      { label: "Reste a encaisser", value: formatCurrency(receivableAmount), detail: "A confirmer, lien envoye ou en attente" },
      { label: "Cout des marchandises vendues", value: formatCurrency(estimatedProductCost), detail: missingCostProducts.length ? "Incomplet : couts manquants" : "Cout des quantites vendues sur la periode" },
      { label: "Valeur stock estimee", value: formatCurrency(estimatedStockValue), detail: "Stock admin actuel x cout fournisseur pondere" },
      { label: "Marge brute", value: formatCurrency(grossMargin), detail: missingCostProducts.length ? "Incomplete" : "CA produits net - couts d'achat" },
      { label: "Taux de marque brute", value: formatRate(grossMarkupRate), detail: "Marge brute / CA produits net" },
      { label: "Taux de marge brute", value: formatRate(grossMarginRate), detail: "Marge brute / cout d'achat" },
      { label: "Local / postal", value: `${localOrders} / ${postalOrders}`, detail: "Repartition des commandes" },
    ],
  };
}

function currentLocalPeriodRange(
  period: AccountingPeriodFilter,
  customStart?: string,
  customEnd?: string,
): AccountingPeriodRange {
  const now = new Date();
  if (period === "custom") {
    const start = parseDateInput(customStart) || new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endBase = parseDateInput(customEnd) || start;
    const end = new Date(endBase.getFullYear(), endBase.getMonth(), endBase.getDate() + 1);
    if (end <= start) {
      return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1) };
    }
    return { start, end };
  }
  if (period === "year") {
    return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear() + 1, 0, 1) };
  }
  if (period === "week") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) };
  }
  return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
}

function previousPeriodRange(range: AccountingPeriodRange): AccountingPeriodRange {
  const duration = Math.max(1, range.end.getTime() - range.start.getTime());
  return { start: new Date(range.start.getTime() - duration), end: new Date(range.start.getTime()) };
}

function parseDateInput(value?: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function orderItemPurchaseCost(
  item: AdminOrderRow["items"][number],
  weightedSupplierCosts: Map<string, WeightedSupplierCost>,
  productCostMap: Map<string, ProductCost>,
): { cost: number; status: "fixed" | "estimated" | "missing"; source: string | null } {
  return resolveOrderItemPurchaseCost(item, weightedSupplierCosts, productCostMap);
}

function roundAccounting(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatRate(value: number | null) {
  return value == null ? "-" : `${(value * 100).toFixed(1).replace(".", ",")} %`;
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value || 0);
}

function formatNullableInteger(value: number | null) {
  return value == null ? "-" : formatInteger(value);
}

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.round(value || 0));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes} min ${remainingSeconds} s` : `${minutes} min`;
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(".", ",");
}

function formatOrderItemLine(item: {
  name: string;
  quantity: number;
  productInternalReference?: string;
  purchaseMode?: "gram" | "fixed_price";
  fixedPriceQuantity?: number;
  fixedPriceGrams?: number;
  fixedPriceTotal?: number;
}) {
  const reference = item.productInternalReference ? `${item.productInternalReference} - ` : "";
  if (item.purchaseMode === "fixed_price") {
    const format = item.fixedPriceTotal
      ? ` - format ${formatCurrency(item.fixedPriceTotal)}`
      : "";
    return `${reference}${item.name}${format} x ${orderItemQuantityLabel(item)}`;
  }
  return `${reference}${item.name} x${item.quantity} g`;
}

function formatAccountingValue(key: AccountingMetricKey, value: number) {
  void key;
  return formatCurrency(value);
}

function costSourceLabel(sources: Set<string>) {
  if (sources.has("supplier_weighted")) return "Fournisseur pondere";
  if (sources.has("manual_fallback")) return "Fallback manuel";
  return "Estime";
}

function buildProductCostFilters(
  products: Product[],
  productCostMap: Map<string, ProductCost>,
  supplierCostMap: Map<string, WeightedSupplierCost>,
): AdminFilterOption<ProductCostFilter>[] {
  const count = (filter: ProductCostFilter) =>
    products.filter((product) => productMatchesProductCostFilter(product, productCostMap, supplierCostMap, filter)).length;
  return [
    { value: "all", label: "Tous", count: products.length },
    { value: "supplier", label: "Fournisseur", count: count("supplier") },
    { value: "manual_fallback", label: "Fallback manuel", count: count("manual_fallback") },
    { value: "missing", label: "Cout manquant", count: count("missing") },
    { value: "large_gap", label: "Ecart important", count: count("large_gap") },
  ];
}

function productMatchesProductCostFilter(
  product: Product,
  productCostMap: Map<string, ProductCost>,
  supplierCostMap: Map<string, WeightedSupplierCost>,
  filter: ProductCostFilter,
) {
  const supplierCost = supplierCostMap.get(product.id)?.weightedCostPerGram ?? null;
  const manualCost = optionalProductCostValue(productCostMap.get(product.id));
  if (filter === "all") return true;
  if (filter === "supplier") return supplierCost != null;
  if (filter === "manual_fallback") return supplierCost == null && manualCost != null;
  if (filter === "missing") return supplierCost == null && manualCost == null;
  if (filter === "large_gap") {
    if (supplierCost == null || manualCost == null || supplierCost <= 0) return false;
    return Math.abs((manualCost - supplierCost) / supplierCost) >= 0.15;
  }
  return true;
}

function optionalProductCostValue(cost?: ProductCost) {
  const value = cost?.purchasePricePerGram;
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function supplierMatchLabel(
  confidence?: SupplierPurchaseLine["matchConfidence"],
  source?: SupplierPurchaseLine["matchSource"],
) {
  if (confidence === "confirmed") return `Correspondance confirmee (${source || "manuel"})`;
  if (confidence === "suggested") return `Suggestion (${source || "nom"})`;
  if (confidence === "ambiguous") return "Ambigu : selection manuelle requise";
  if (confidence === "missing") return "Aucune correspondance";
  return "";
}
function accountingDate(order: AdminOrderRow) {
  return parseAdminDate(
    order.paymentStatus === "paid"
      ? order.paymentConfirmedAt || order.updatedAt || order.createdAt
      : order.updatedAt || order.createdAt,
  );
}

function parseAdminDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "object") {
    const candidate = value as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof candidate.toDate === "function") return candidate.toDate();
    const seconds = candidate.seconds ?? candidate._seconds;
    if (typeof seconds === "number") return new Date(seconds * 1000);
  }
  return null;
}

function isCancelledOrDeletedOrder(order: AdminOrderRow) {
  return order.orderStatus === "cancelled" || Boolean(order.deletedAt);
}

function orderTotalAmount(order: AdminOrderRow) {
  return parseEuro(order.total);
}

function orderDiscountAmount(order: AdminOrderRow) {
  return Number(order.discountAmount ?? order.promotionDiscountTotal ?? 0);
}

function orderProductNetRevenue(order: AdminOrderRow) {
  const subtotalAfterPromotion = Number(order.subtotalAfterPromotion);
  if (Number.isFinite(subtotalAfterPromotion) && subtotalAfterPromotion > 0) {
    return subtotalAfterPromotion;
  }
  const subtotal = Number(order.subtotalBeforePromotion ?? order.subtotalBeforeDiscount ?? order.subtotal ?? 0);
  if (Number.isFinite(subtotal) && subtotal > 0) {
    return Math.max(0, subtotal - orderDiscountAmount(order));
  }
  return Math.max(0, orderTotalAmount(order) - Number(order.deliveryFee || 0));
}

function formatCurrency(value: number) {
  return `${formatEuro(value)} EUR`;
}

function formatLocalDate(date: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function buildDashboardMetrics(
  products: Product[],
  orders: {
    paymentStatus: string;
    orderStatus: string;
    delivery: string;
    total: string;
  }[],
): AdminMetric[] {
  const activeOrders = orders.filter((order) => order.orderStatus !== "cancelled");
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

function parseEuro(value: string) {
  return Number(value.replace("EUR", "").replace(",", ".").trim()) || 0;
}

function formatEuro(value: number) {
  return value.toFixed(2).replace(".", ",");
}

function dateInputValue(value?: string) {
  if (!value) return "";
  return value.includes("T") ? value.slice(0, 10) : value;
}

function couponPreview(coupon: CouponInput) {
  const code = coupon.code || "CODE";
  const minimum = Number(coupon.minimumOrder || 0);
  const minimumText = minimum > 0 ? ` à partir de ${formatEuro(minimum)} EUR d'achat` : "";
  if (coupon.promotionType === "threshold_extra_discount") {
    return `Le client paie ${formatEuro(
      Number(coupon.paidThresholdAmount || 0),
    )} EUR sur la catégorie choisie, puis reçoit jusqu'à ${formatEuro(
      Number(coupon.maxGiftAmount || 0),
    )} EUR offerts avec le code ${code}.`;
  }
  if (coupon.discountType === "free_shipping") {
    return `Le client bénéficiera de la livraison postale offerte avec le code ${code}${minimumText}.`;
  }
  if (coupon.discountType === "fixed") {
    return `Le client obtiendra ${formatEuro(Number(coupon.discountValue || 0))} EUR de réduction avec le code ${code}${minimumText}.`;
  }
  return `Le client obtiendra ${Number(coupon.discountValue || 0)} % de réduction avec le code ${code}${minimumText}.`;
}
function couponTypeLabel(type: Coupon["discountType"]) {
  if (type === "fixed") return "Montant fixe";
  if (type === "free_shipping") return "Livraison postale offerte";
  return "Pourcentage";
}

function couponValueLabel(coupon: Pick<Coupon, "discountType" | "discountValue">) {
  if (coupon.discountType === "free_shipping") return "Livraison offerte";
  if (coupon.discountType === "fixed") return `${formatEuro(Number(coupon.discountValue || 0))} EUR`;
  return `${Number(coupon.discountValue || 0)} %`;
}

function couponDescription(coupon: Coupon) {
  if (coupon.promotionType === "threshold_extra_discount") {
    return `Offert après seuil : ${formatEuro(
      Number(coupon.paidThresholdAmount || 0),
    )} EUR payés, jusqu'à ${formatEuro(Number(coupon.maxGiftAmount || 0))} EUR offerts.`;
  }
  const minimum = Number(coupon.minimumOrder || 0);
  const minimumText = minimum > 0 ? ` à partir de ${formatEuro(minimum)} EUR` : " sans minimum";
  return `${couponTypeLabel(coupon.discountType)} : ${couponValueLabel(coupon)}${minimumText}.`;
}
function inferAdminPromotionType(coupon: CouponInput): PromotionRuleType {
  const category = coupon.eligibleCategory || coupon.categories?.[0];
  if (coupon.discountType === "free_shipping") return "free_shipping";
  if (coupon.discountType === "percent") {
    return category ? "percentage_category_discount" : "percentage_cart_discount";
  }
  return category ? "fixed_category_discount" : "fixed_cart_discount";
}

function couponStatus(coupon: Coupon): { label: string; tone: AdminBadgeTone } {
  const now = Date.now();
  const startsAt = coupon.startsAt ? Date.parse(coupon.startsAt) : 0;
  const endsAt = coupon.endsAt ? Date.parse(coupon.endsAt) : 0;
  if (coupon.isArchived) return { label: "Archivé", tone: "muted" };
  if (!coupon.isActive) return { label: "Inactif", tone: "muted" };
  if (startsAt && now < startsAt) return { label: "Programmé", tone: "gold" };
  if (endsAt && now > endsAt) return { label: "Expiré", tone: "danger" };
  if (coupon.maxUses && Number(coupon.usedCount || 0) >= Number(coupon.maxUses)) {
    return { label: "Limite atteinte", tone: "warning" };
  }
  return { label: "Actif", tone: "success" };
}

const bannerPlacementOptions: Array<{ value: PromoBannerPlacement; label: string }> = [
  { value: "all_public", label: "Toutes les pages publiques" },
  { value: "home", label: "Accueil" },
  { value: "shop", label: "Boutique" },
  { value: "flowers", label: "Fleurs CBD" },
  { value: "resins", label: "Resines CBD" },
  { value: "cart", label: "Panier" },
  { value: "checkout", label: "Checkout" },
];

function isTemplateCoupon(coupon: Coupon) {
  return Boolean(coupon.isTemplate || coupon.internalNote?.toLowerCase().includes("modele"));
}

function promoBannerTypeLabel(type: PromoBannerType) {
  if (type === "top_bar") return "Bandeau haut de page";
  if (type === "shop_card") return "Encadre boutique";
  if (type === "checkout_notice") return "Encart panier / checkout";
  return "Modale legere";
}

function promoBannerPlacementLabel(placement: PromoBannerPlacement) {
  const labels: Record<PromoBannerPlacement, string> = {
    home: "Accueil",
    shop: "Boutique",
    flowers: "Fleurs CBD",
    resins: "Resines CBD",
    cart: "Panier",
    checkout: "Checkout",
    all_public: "Toutes les pages publiques",
    draft: "Aucun / brouillon",
  };
  return labels[placement] || placement;
}

function promoBannerPlacementsLabel(banner: Pick<PromoBanner, "placement" | "placements">) {
  const placements = getBannerPlacements(banner);
  if (placements.includes("all_public")) return "Toutes les pages publiques";
  return placements.map((placement) => promoBannerPlacementLabel(placement)).join(", ");
}

function bannerInputPlacements(banner: Pick<PromoBannerInput, "placement" | "placements">) {
  return getBannerPlacements({
    placement: banner.placement,
    placements: banner.placements,
  });
}

function priorityBucket(priority: number) {
  const normalized = Number(priority || 10);
  if (normalized >= 100) return 100;
  if (normalized >= 50) return 50;
  return 10;
}

function promoBannerPriorityLabel(priority: number) {
  const bucket = priorityBucket(priority);
  if (bucket === 100) return "Tres importante";
  if (bucket === 50) return "Importante";
  return "Normale";
}

function findLinkedCoupon(coupons: Coupon[], banner: PromoBanner) {
  if (banner.linkedCouponId) {
    return coupons.find((coupon) => coupon.id === banner.linkedCouponId);
  }
  const code = (banner.linkedPromoCode || "").trim().toUpperCase();
  if (!code) return undefined;
  return coupons.find((coupon) => coupon.code.trim().toUpperCase() === code);
}

function orderPromotionLabel(
  order: Pick<AdminOrderRow, "couponCode" | "appliedPromotions">,
) {
  if (order.couponCode) return `Code promo ${order.couponCode}`;
  return order.appliedPromotions?.[0]?.label || "Offre automatique";
}

function adminBannerPreviewClass(variant: PromoBannerVariant) {
  if (variant === "promo") return "border-champagne/50 bg-champagne/15";
  if (variant === "delivery") return "border-forest/15 bg-forest/5";
  if (variant === "warning") return "border-red-200 bg-red-50";
  if (variant === "info") return "border-forest/10 bg-ivory";
  return "border-forest/10 bg-ivory";
}

function invoiceStatusLabel(status: InvoiceStatus) {
  const labels: Record<InvoiceStatus, string> = {
    draft: "Brouillon",
    validated: "Validée",
    sent: "Envoyée",
    paid: "Payée",
    cancelled: "Annulée",
    credit_note_issued: "Avoir émis",
  };
  return labels[status] || status;
}

function normalizePhone(value?: string) {
  const raw = (value || "").replace(/[^\d+]/g, "");
  if (raw.startsWith("+")) return raw;
  if (raw.startsWith("0")) return `+33${raw.slice(1)}`;
  return raw;
}

function telLink(phone?: string) {
  return phone ? `tel:${normalizePhone(phone)}` : "#";
}

function whatsappLink(order: {
  customerPhone?: string;
  customer: string;
  id: string;
  orderType?: string;
  orderStatus: string;
  delivery: string;
  total: string;
  trackingNumber?: string;
}) {
  const phone = normalizePhone(order.customerPhone).replace("+", "");
  return `https://wa.me/${phone}?text=${encodeURIComponent(orderMessage(order))}`;
}

function smsLink(order: {
  customerPhone?: string;
  customer: string;
  id: string;
  orderType?: string;
  orderStatus: string;
  delivery: string;
  total: string;
  trackingNumber?: string;
}) {
  return `sms:${normalizePhone(order.customerPhone)}?body=${encodeURIComponent(orderMessage(order))}`;
}

function whatsappPaymentLink(order: {
  customerPhone?: string;
  customer: string;
  id: string;
  deliveryMethod?: string;
  paymentLinkUrl?: string;
  total?: string;
  paymentLinkAmount?: number;
  paymentLinkCurrency?: "EUR";
}) {
  if (!order.customerPhone || !order.paymentLinkUrl) return "#";
  const phone = normalizePhone(order.customerPhone).replace("+", "");
  return `https://wa.me/${phone}?text=${encodeURIComponent(paymentLinkMessage(order))}`;
}

function smsPaymentLink(order: {
  customerPhone?: string;
  customer: string;
  id: string;
  deliveryMethod?: string;
  paymentLinkUrl?: string;
  total?: string;
  paymentLinkAmount?: number;
  paymentLinkCurrency?: "EUR";
}) {
  return `sms:${normalizePhone(order.customerPhone)}?body=${encodeURIComponent(paymentLinkMessage(order))}`;
}

async function copyOrderMessage(order: {
  customerPhone?: string;
  customer: string;
  id: string;
  orderType?: string;
  orderStatus: string;
  delivery: string;
  total: string;
  trackingNumber?: string;
}) {
  await navigator.clipboard.writeText(orderMessage(order));
}

function paymentLinkMessage(order: {
  customer: string;
  id: string;
  deliveryMethod?: string;
  paymentLinkUrl?: string;
  total?: string;
  paymentLinkAmount?: number;
  paymentLinkCurrency?: "EUR";
}) {
  const firstName = order.customer.split(" ")[0] || "Bonjour";
  const shortId = order.id.slice(0, 8).toUpperCase();
  const link = order.paymentLinkUrl || "[LIEN_DE_PAIEMENT]";
  const amount = order.paymentLinkAmount
    ? `${order.paymentLinkAmount} ${order.paymentLinkCurrency || "EUR"}`
    : order.total || "le montant confirme";
  if (order.deliveryMethod === "postal") {
    return `Bonjour ${firstName}, votre commande Verdanza n°${shortId} est confirmée. Pour finaliser l'expédition, vous pouvez régler ${amount} par carte bancaire via ce lien : ${link}. Dès réception du paiement, votre commande sera préparée.`;
  }
  if (order.deliveryMethod === "local_express") {
    return `Bonjour ${firstName}, votre commande Verdanza n°${shortId} est confirmée. Vous pouvez régler ${amount} par carte bancaire via ce lien : ${link}, ou confirmer avec nous le mode de règlement souhaité.`;
  }
  return `Bonjour ${firstName}, votre commande Verdanza n°${shortId} est confirmée. Vous pouvez régler ${amount} par carte bancaire via ce lien : ${link}. Dès réception du paiement, nous préparerons votre commande. Merci, Verdanza.`;
}

function paymentChannelLabel(channel?: PaymentLinkChannel) {
  if (channel === "email") return "email";
  if (channel === "whatsapp") return "WhatsApp";
  if (channel === "sms") return "SMS";
  if (channel === "other") return "autre canal";
  return "canal non renseigné";
}

function orderMessage(order: {
  customer: string;
  id: string;
  orderType?: string;
  orderStatus: string;
  delivery: string;
  total: string;
  trackingNumber?: string;
}) {
  const firstName = order.customer.split(" ")[0] || "Bonjour";
  const shortId = order.id.slice(0, 8).toUpperCase();
  if (order.orderType === "preorder") {
    return `Bonjour ${firstName}, votre précommande Verdanza n°${shortId} a bien été reçue. Nous vous contacterons rapidement pour confirmer les disponibilités, la livraison et le règlement. Total estimé : ${order.total}.`;
  }
  const common = `Bonjour ${firstName}, votre commande Verdanza n°${shortId}`;
  if (order.orderStatus === "confirmed") {
    return `${common} est confirmée. Mode de livraison : ${order.delivery}. Total estimé : ${order.total}. Nous vous tenons informé de la suite.`;
  }
  if (order.orderStatus === "preparing") {
    return `${common} est en préparation.`;
  }
  if (order.orderStatus === "out_for_delivery") {
    return `${common} est en cours de livraison. Le livreur arrive prochainement à l'adresse indiquée.`;
  }
  if (order.orderStatus === "shipped") {
    return `${common} a été expédiée. Numéro de suivi : ${order.trackingNumber || "à venir"}.`;
  }
  if (order.orderStatus === "delivered") {
    return `${common} est indiquée comme livrée. Merci pour votre commande.`;
  }
  if (order.orderStatus === "cancelled") {
    return `${common} a été annulée. Contactez-nous si besoin au 07 80 81 41 37.`;
  }
  return `${common} a bien été reçue. Nous vérifions les disponibilités et revenons vers vous rapidement. Total estimé : ${order.total}.`;
}

function preferredPaymentMethodLabel(method?: PreferredPaymentMethod) {
  if (method === "card_payment_link") {
    return "Carte bancaire via lien de paiement après confirmation";
  }
  if (method === "cash_on_delivery") return "Espèces à la livraison locale";
  if (method === "bank_transfer") return "Virement bancaire";
  if (method === "local_delivery_payment") return "Paiement à la livraison locale";
  return "À confirmer avec Verdanza";
}

function finalPaymentMethodLabel(method?: FinalPaymentMethod | "") {
  if (method === "card_payment_link") return "Carte bancaire via lien";
  if (method === "cash_on_delivery") return "Espèces à la livraison locale";
  if (method === "bank_transfer") return "Virement bancaire";
  if (method === "other") return "Autre moyen confirmé";
  return "À choisir avant paiement";
}

function allowedFinalPaymentMethods(order: { deliveryMethod?: string }) {
  return finalPaymentMethodOptions.filter(
    (method) => method !== "cash_on_delivery" || order.deliveryMethod === "local_express",
  );
}

function canDeleteCancelledOrder(order: AdminOrderListItem) {
  return order.orderStatus === "cancelled" && order.paymentStatus === "cancelled";
}

function confirmPermanentOrderDeletion(orderId: string) {
  const confirmed = window.prompt(
    `Suppression definitive de la commande ${orderId}. Cette action est irreversible et la commande ne s'affichera plus nulle part. Tapez SUPPRIMER pour confirmer.`,
    "",
  );
  return confirmed === "SUPPRIMER";
}

function confirmedFinalPaymentMethodForPaid(order: AdminOrderListItem) {
  if (order.finalPaymentMethod) return order.finalPaymentMethod;
  const selected = window.prompt(
    "Paiement final confirmé ? card_payment_link, cash_on_delivery, bank_transfer ou other",
    order.deliveryMethod === "local_express" ? "cash_on_delivery" : "card_payment_link",
  );
  if (!selected) return null;
  if (!finalPaymentMethodOptions.includes(selected as FinalPaymentMethod)) {
    window.alert("Méthode finale invalide.");
    return null;
  }
  if (selected === "cash_on_delivery" && order.deliveryMethod !== "local_express") {
    window.alert("Les espèces sont réservées à la livraison locale.");
    return null;
  }
  return selected as FinalPaymentMethod;
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  min,
  step,
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  min?: string;
  step?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="text-sm font-medium text-forest">
      {label}
      <input
        className="input-field mt-2"
        type={type}
        min={min}
        step={step}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-sm font-medium text-forest">
      {label}
      <input
        className="input-field mt-2"
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function optionalNumberInputValue(value?: number | null) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? String(value) : "";
}

function optionalPositiveNumberFromInput(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function Textarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm font-medium text-forest">
      {label}
      <textarea
        className="input-field mt-2 min-h-24"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function normalizeList(value: string[] | string) {
  if (Array.isArray(value)) return value;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
