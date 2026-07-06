import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAdminData } from "../../hooks/useAdminData";
import {
  updateProductFlags,
  updateProductStock,
  upsertProduct,
  type ProductInput,
} from "../../services/productsService";
import { updateOrderAdminFields } from "../../services/ordersService";
import { updateDeliveryZoneAdmin } from "../../services/deliveryZonesService";
import {
  archiveCoupon,
  updateCouponStatus,
  upsertCoupon,
  type CouponInput,
} from "../../services/couponsService";
import {
  adjustCustomerLoyalty,
  updateCustomerInternalNote,
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
import {
  getAdminPaymentLinks,
  sendOrderPaymentLinkEmail,
  type AdminPaymentLink,
} from "../../services/paymentLinksService";
import type {
  AdminMetric,
  BillingSettings,
  Coupon,
  CustomerProfile,
  DeliveryZone,
  DeliveryZoneStatus,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  OrderStatus,
  PaymentProvider,
  PreferredPaymentMethod,
  PaymentLinkChannel,
  PaymentStatus,
  Product,
  ProductCategory,
  StatusHistoryEntry,
} from "../../types";
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

const emptyProduct: ProductInput = {
  slug: "",
  name: "",
  category: "flowers",
  price: 0,
  shortDescription: "",
  longDescription: "",
  image: "/verdanza-label.png",
  cbdRate: "A renseigner",
  cbgRate: "A renseigner",
  thcRate: "< 0,3 %",
  origin: "A renseigner",
  cultureType: "A renseigner",
  aromas: [],
  tags: [],
  stock: 0,
  lowStockThreshold: 5,
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
  usedCount: 0,
  isActive: true,
  productIds: [],
  categories: [],
};

const paymentStatusOptions: PaymentStatus[] = [
  "to_confirm",
  "payment_link_sent",
  "pending",
  "paid",
  "cancelled",
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
    customers,
    customerSource,
    invoices,
    invoiceSource,
    billingSettings,
    billingSource,
    isLoading,
    refresh,
  } = useAdminData();
  const [message, setMessage] = useState("");
  const [editingProduct, setEditingProduct] = useState<ProductInput>(emptyProduct);
  const [editingCoupon, setEditingCoupon] = useState<CouponInput>(emptyCoupon);
  const [editingBilling, setEditingBilling] = useState<BillingSettings>(billingSettings);

  useEffect(() => {
    setEditingBilling(billingSettings);
  }, [billingSettings]);

  const lowStockProducts = useMemo(
    () => products.filter((product) => product.stock <= product.lowStockThreshold),
    [products],
  );
  const dashboardMetrics = useMemo(
    () => buildDashboardMetrics(products, orders),
    [orders, products],
  );

  async function handleProductSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    await upsertProduct({
      ...editingProduct,
      slug: editingProduct.slug || slugify(editingProduct.name),
      aromas: normalizeList(editingProduct.aromas),
      tags: normalizeList(editingProduct.tags),
    });
    setEditingProduct(emptyProduct);
    setMessage("Produit enregistre.");
    await refresh();
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
    data: Pick<
      DeliveryZone,
      | "name"
      | "isActive"
      | "isOpen"
      | "status"
      | "fee"
      | "minimumOrder"
      | "minimumOrderAmount"
      | "estimatedDelay"
      | "customerMessage"
      | "adminNote"
      | "sortOrder"
    >,
  ) {
    await updateDeliveryZoneAdmin(zone.id, data);
    setMessage(`Zone ${zone.name} mise a jour.`);
    await refresh();
  }

  async function handleCouponSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await upsertCoupon({
      ...editingCoupon,
      productIds: normalizeList(editingCoupon.productIds ?? []),
      categories: normalizeList(editingCoupon.categories ?? []) as ProductCategory[],
    });
    setEditingCoupon(emptyCoupon);
    setMessage("Code promo enregistre.");
    await refresh();
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

  async function handleLoyaltyAdjustment(customer: CustomerProfile) {
    const rawPoints = window.prompt("Nombre de points a ajouter ou retirer", "0");
    const points = Number(rawPoints);
    if (!Number.isFinite(points) || points === 0) return;
    const note = window.prompt("Motif de l'ajustement", "") || "";
    await adjustCustomerLoyalty(customer, points, note);
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
        <p className="mt-4 rounded-md border border-champagne/30 bg-cream px-4 py-3 text-sm text-forest">
          {message}
        </p>
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

      {section === "Produits" && (
        <div className="mt-8 grid gap-6 xl:grid-cols-[420px_1fr]">
          <ProductForm
            product={editingProduct}
            onChange={setEditingProduct}
            onSubmit={handleProductSubmit}
          />
          <section>
            <SourceLine source={productSource} />
            <ProductTable
              products={products}
              onEdit={setEditingProduct}
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
            invoices={invoices}
            orderSource={orderSource}
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
          <DeliveryZonesPanel zones={deliveryZones} onSave={handleDeliveryZoneSave} />
        </>
      )}

      {section === "Coupons" && (
        <div className="mt-8 grid gap-6 xl:grid-cols-[420px_1fr]">
          <CouponForm
            coupon={editingCoupon}
            onChange={setEditingCoupon}
            onSubmit={handleCouponSubmit}
          />
          <section>
            <SourceLine source={couponSource} />
            <CouponsTable
              coupons={coupons}
              onEdit={setEditingCoupon}
              onToggle={handleCouponToggle}
              onArchive={handleCouponArchive}
            />
          </section>
        </div>
      )}

      {section === "Clients" && (
        <>
          <SourceLine source={customerSource} />
          <CustomersTable
            customers={customers}
            onAdjustPoints={handleLoyaltyAdjustment}
            onNote={async (customer, note) => {
              await updateCustomerInternalNote(customer.id, note);
              await refresh();
            }}
          />
        </>
      )}

      {section === "Factures" && (
        <>
          <SourceLine source={invoiceSource} />
          <BillingWarning settings={billingSettings} />
          <div className="mt-8 grid gap-6 xl:grid-cols-[420px_1fr]">
            <ManualInvoiceForm
              onCreate={async (input) => {
                const result = await createManualInvoice(input);
                setMessage(`Facture brouillon ${result.invoiceNumber} creee.`);
                await refresh();
              }}
            />
            <InvoicesPanel
              invoices={invoices}
              onStatus={async (invoice, status) => {
                await updateInvoiceStatus(invoice.id, status);
                setMessage(`Facture ${invoice.invoiceNumber} mise a jour.`);
                await refresh();
              }}
              onDownload={async (invoice) => {
                await downloadInvoicePdf(invoice.id, invoice.invoiceNumber);
              }}
              onSend={async (invoice) => {
                if (!billingSettings.isManuallyValidated) {
                  const confirmed = window.confirm(billingSettings.validationWarning);
                  if (!confirmed) return;
                }
                await sendInvoiceEmail(invoice.id);
                setMessage(`Facture ${invoice.invoiceNumber} envoyee.`);
                await refresh();
              }}
            />
          </div>
        </>
      )}

      {(section === "Parametres de facturation" || section === "Paramètres de facturation") && (
        <>
          <SourceLine source={billingSource} />
          <BillingSettingsPanel
            settings={editingBilling}
            onChange={setEditingBilling}
            onSubmit={async (event) => {
              event.preventDefault();
              await saveBillingSettings(editingBilling);
              setMessage("Paramètres de facturation enregistrés.");
              await refresh();
            }}
          />
        </>
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
}: {
  product: ProductInput;
  onChange: (product: ProductInput) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
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
        <Input label="Image" value={product.image} onChange={(image) => onChange({ ...product, image })} />
        <Input label="Aromes, separes par virgule" value={product.aromas.join(", ")} onChange={(aromas) => onChange({ ...product, aromas: normalizeList(aromas) })} />
        <Input label="Tags, separes par virgule" value={product.tags.join(", ")} onChange={(tags) => onChange({ ...product, tags: normalizeList(tags) })} />
        <Input label="SEO title" value={product.seoTitle} onChange={(seoTitle) => onChange({ ...product, seoTitle })} />
        <Textarea label="SEO description" value={product.seoDescription} onChange={(seoDescription) => onChange({ ...product, seoDescription })} />
        <div className="flex gap-4 text-sm text-forest">
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
        </div>
        <button className="btn-primary" type="submit">
          Enregistrer
        </button>
      </div>
    </form>
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

function ProductTable({
  products,
  onEdit,
  onFlagChange,
}: {
  products: Product[];
  onEdit: (product: Product) => void;
  onFlagChange: (product: Product, key: "isActive" | "isFeatured") => Promise<void>;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-forest/10 bg-ivory">
      {!products.length && (
        <AdminEmptyState
          title="Aucun produit pour le moment."
          description="Ajoutez un produit ou rafraichissez les donnees connectees."
        />
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
            <tr>
              {["Produit", "Categorie", "Prix", "Stock", "Actif", "Mis en avant", "Action"].map((header) => (
                <th key={header} className="px-4 py-3 font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-t border-forest/10">
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <img
                      src={product.image || "/verdanza-label.png"}
                      alt=""
                      className="h-14 w-14 rounded-md border border-forest/10 object-cover"
                      loading="lazy"
                    />
                    <div>
                      <strong className="block text-forest">{product.name}</strong>
                      <span className="text-xs text-ink/50">{product.slug}</span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <AdminBadge tone="neutral">{product.category}</AdminBadge>
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
  return (
    <section className="mt-8 grid gap-4">
      {products.map((product) => (
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
    <article className="admin-card grid gap-4 md:grid-cols-[1fr_120px_140px_auto] md:items-end">
      <div className="flex items-center gap-3">
        <img
          src={product.image || "/verdanza-label.png"}
          alt=""
          className="h-16 w-16 rounded-md border border-forest/10 object-cover"
          loading="lazy"
        />
        <div>
          <h2 className="font-display text-2xl leading-tight text-forest">{product.name}</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <AdminBadge tone={product.isActive ? "success" : "muted"}>
              {product.isActive ? "Actif" : "Inactif"}
            </AdminBadge>
            <AdminBadge tone={stockTone(product)}>{stockLabel(product)}</AdminBadge>
          </div>
        </div>
      </div>
      <NumberInput label="Stock" value={stock} onChange={setStock} />
      <NumberInput label="Seuil" value={threshold} onChange={setThreshold} />
      <button
        className="btn-primary"
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
      <article className="admin-card">
        <p className="text-xs uppercase tracking-[0.16em] text-champagne">Locale</p>
        <strong className="mt-2 block font-display text-3xl text-forest">
          {LOCAL_DELIVERY_MINIMUM} EUR
        </strong>
        <span className="text-xs text-ink/55">Minimum Aix-en-Provence et alentours</span>
      </article>
      <article className="admin-card">
        <p className="text-xs uppercase tracking-[0.16em] text-champagne">Postale</p>
        <strong className="mt-2 block font-display text-3xl text-forest">
          {POSTAL_DELIVERY_MINIMUM} EUR
        </strong>
        <span className="text-xs text-ink/55">Minimum France</span>
      </article>
      <article className="admin-card">
        <p className="text-xs uppercase tracking-[0.16em] text-champagne">Offerte</p>
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
}: {
  zones: DeliveryZone[];
  onSave: (
    zone: DeliveryZone,
    data: Pick<
      DeliveryZone,
      | "name"
      | "isActive"
      | "isOpen"
      | "status"
      | "fee"
      | "minimumOrder"
      | "minimumOrderAmount"
      | "estimatedDelay"
      | "customerMessage"
      | "adminNote"
      | "sortOrder"
    >,
  ) => Promise<void>;
}) {
  return (
    <section className="mt-8 grid gap-4">
      {zones.map((zone) => (
        <DeliveryZoneRow key={zone.id} zone={zone} onSave={onSave} />
      ))}
    </section>
  );
}

function DeliveryZoneRow({
  zone,
  onSave,
}: {
  zone: DeliveryZone;
  onSave: (
    zone: DeliveryZone,
    data: Pick<
      DeliveryZone,
      | "name"
      | "isActive"
      | "isOpen"
      | "status"
      | "fee"
      | "minimumOrder"
      | "minimumOrderAmount"
      | "estimatedDelay"
      | "customerMessage"
      | "adminNote"
      | "sortOrder"
    >,
  ) => Promise<void>;
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
  const [customerMessage, setCustomerMessage] = useState(zone.customerMessage || "");
  const [adminNote, setAdminNote] = useState(zone.adminNote || "");
  const [sortOrder, setSortOrder] = useState(zone.sortOrder || 0);
  const isOpen = status === "open" && isActive;

  return (
    <article className="admin-card grid gap-4 xl:grid-cols-[1fr_120px_140px_120px_1.2fr_auto] xl:items-end">
      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-champagne">
          {zone.method === "postal" ? "Postale" : "Locale"}
        </p>
        <Input label="Nom" value={name} onChange={setName} />
      </div>
      <NumberInput label="Frais" value={fee} onChange={setFee} />
      <NumberInput label="Minimum" value={minimumOrder} onChange={setMinimumOrder} />
      <NumberInput label="Ordre" value={sortOrder} onChange={setSortOrder} />
      <Input label="Délai" value={estimatedDelay} onChange={setEstimatedDelay} />
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
      <button
        className="btn-primary xl:col-start-6"
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
            customerMessage,
            adminNote,
            sortOrder,
          })
        }
      >
        Enregistrer
      </button>
    </article>
  );
}

function CouponForm({
  coupon,
  onChange,
  onSubmit,
}: {
  coupon: CouponInput;
  onChange: (coupon: CouponInput) => void;
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
        <div className="rounded-md border border-champagne/30 bg-cream p-3 text-sm leading-6 text-forest">
          <strong className="block">Aperçu</strong>
          {preview}
        </div>
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
}: {
  coupons: Coupon[];
  onEdit: (coupon: CouponInput) => void;
  onToggle: (coupon: Coupon) => Promise<void>;
  onArchive: (coupon: Coupon) => Promise<void>;
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
          description="Créez un code simple comme WELCOME10, BIENVENUE5 ou POSTALOFFERT."
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
                  <AdminBadge tone={status.tone}>{status.label}</AdminBadge>
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

function CustomersTable({
  customers,
  onAdjustPoints,
  onNote,
}: {
  customers: CustomerProfile[];
  onAdjustPoints: (customer: CustomerProfile) => Promise<void>;
  onNote: (customer: CustomerProfile, note: string) => Promise<void>;
}) {
  return (
    <section className="mt-8 overflow-hidden rounded-lg border border-forest/10 bg-ivory">
      {!customers.length && (
        <p className="border-b border-forest/10 bg-cream px-4 py-4 text-sm text-forest">
          Aucun client pour le moment.
        </p>
      )}
      {!!customers.length && (
        <div className="hidden gap-4 p-4 lg:grid xl:grid-cols-2 2xl:grid-cols-3">
          {customers.map((customer) => (
            <article
              key={customer.id}
              className="rounded-lg border border-forest/10 bg-cream p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <strong className="block truncate text-forest">
                    {customer.displayName || "Client"}
                  </strong>
                  <span className="mt-1 block break-all text-xs text-ink/60">
                    {customer.email || "Email non renseigne"}
                  </span>
                  <span className="block text-xs text-ink/60">
                    {customer.phone || "Telephone non renseigne"}
                  </span>
                </div>
                <AdminBadge tone={customer.orderCount ? "success" : "muted"}>
                  {`${customer.orderCount || 0} commande(s)`}
                </AdminBadge>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-md border border-forest/10 bg-ivory p-3">
                  <span className="block text-[11px] uppercase tracking-[0.12em] text-forest/50">
                    Total
                  </span>
                  <strong className="mt-1 block text-forest">
                    {formatEuro(Number(customer.totalSpent || 0))} EUR
                  </strong>
                </div>
                <div className="rounded-md border border-forest/10 bg-ivory p-3">
                  <span className="block text-[11px] uppercase tracking-[0.12em] text-forest/50">
                    Fidelite
                  </span>
                  <strong className="mt-1 block text-forest">
                    {customer.loyaltyPoints || 0} point(s)
                  </strong>
                </div>
              </div>

              <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.12em] text-forest/60">
                Note interne
                <input
                  className="input-field mt-2"
                  defaultValue={customer.internalNote || ""}
                  placeholder="Note"
                  onBlur={(event) => void onNote(customer, event.currentTarget.value)}
                />
              </label>

              <button
                className="btn-secondary mt-4 min-h-10 px-3 py-2 text-xs"
                onClick={() => void onAdjustPoints(customer)}
                type="button"
              >
                Ajuster points
              </button>
            </article>
          ))}
        </div>
      )}
      <div className="overflow-x-auto lg:hidden">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
            <tr>
              {["Client", "Commandes", "Total", "Points", "Note interne", "Action"].map((header) => (
                <th key={header} className="px-4 py-3 font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id} className="border-t border-forest/10">
                <td className="px-4 py-4">
                  <strong className="block text-forest">{customer.displayName || "Client"}</strong>
                  <span className="block text-xs text-ink/55">{customer.email}</span>
                  <span className="block text-xs text-ink/55">{customer.phone}</span>
                </td>
                <td className="px-4 py-4">{customer.orderCount || 0}</td>
                <td className="px-4 py-4">{formatEuro(Number(customer.totalSpent || 0))} EUR</td>
                <td className="px-4 py-4">{customer.loyaltyPoints || 0}</td>
                <td className="px-4 py-4">
                  <input
                    className="input-field"
                    defaultValue={customer.internalNote || ""}
                    placeholder="Note"
                    onBlur={(event) => void onNote(customer, event.currentTarget.value)}
                  />
                </td>
                <td className="px-4 py-4">
                  <button
                    className="btn-secondary whitespace-nowrap"
                    onClick={() => void onAdjustPoints(customer)}
                  >
                    Ajuster points
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
  emails?: {
    adminNotificationStatus?: string;
    adminNotificationRecipients?: Record<string, { status: string; reason?: string }>;
  };
};

type AdminOrderUpdateInput = {
  orderStatus?: OrderStatus;
  paymentStatus?: PaymentStatus;
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
  onUpdate,
}: {
  orders: AdminOrderListItem[];
  invoices?: Invoice[];
  orderSource: "firestore" | "empty";
  onCreateInvoice?: (orderId: string) => Promise<void>;
  onUpdate: (orderId: string, data: AdminOrderUpdateInput) => Promise<void>;
}) {
  const [filter, setFilter] = useState("active");
  const [paymentLinks, setPaymentLinks] = useState<AdminPaymentLink[]>([]);
  const [paymentLinkMessage, setPaymentLinkMessage] = useState("");
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
                      void onUpdate(order.id, {
                        paymentStatus: event.target.value as PaymentStatus,
                      })
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
              <div className="mt-4 rounded-md bg-cream p-3 text-xs leading-5 text-ink/65">
                <strong className="block text-forest">{order.delivery}</strong>
                {order.items.length
                  ? order.items.map((item) => `${item.name} x${item.quantity} g`).join(", ")
                  : "Produits a renseigner"}
                {order.promoApplied && (
                  <span className="mt-2 block text-forest">
                    Code promo {order.couponCode} : -{formatEuro(Number(order.discountAmount || 0))} EUR
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
              onSendEmail={handleSendPaymentLinkEmail}
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
                      void onUpdate(order.id, {
                        paymentStatus: event.target.value as PaymentStatus,
                      })
                    }
                  >
                    {paymentStatusOptions.map((status) => (
                      <option key={status} value={status}>
                        {paymentStatusLabel(status)}
                      </option>
                    ))}
                  </select>
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
                    ? order.items.map((item) => `${item.name} x${item.quantity} g`).join(", ")
                    : "A renseigner"}
                  {order.promoApplied && (
                    <span className="mt-2 block text-xs leading-5 text-forest">
                      Code promo {order.couponCode}
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
  onSendEmail,
}: {
  order: AdminOrderListItem;
  invoice?: Invoice;
  orderSource: "firestore" | "empty";
  paymentLinks: AdminPaymentLink[];
  onCreateInvoice?: (orderId: string) => Promise<void>;
  onUpdate: (orderId: string, data: AdminOrderUpdateInput) => Promise<void>;
  onSendEmail: (input: {
    orderId: string;
    paymentLinkUrl: string;
    paymentLinkLabel: string;
    paymentLinkAmount: number;
    paymentLinkCurrency: "EUR";
  }) => Promise<void>;
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
                onChange={(event) =>
                  void onUpdate(order.id, {
                    paymentStatus: event.target.value as PaymentStatus,
                  })
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
                ? order.items.map((item) => `${item.name} x${item.quantity} g`).join(", ")
                : "A renseigner"}
            </strong>
            {order.promoApplied && (
              <span className="mt-2 block text-xs text-forest">
                Code promo {order.couponCode} : -{formatEuro(Number(order.discountAmount || 0))} EUR
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
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-xs text-ink/60 xl:grid-cols-2">
        <div>
          <strong className="block text-forest">Notifications</strong>
          <NotificationStatus order={order} />
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

function NotificationStatus({
  order,
}: {
  order: {
    emails?: {
      adminNotificationStatus?: string;
      adminNotificationRecipients?: Record<string, { status: string; reason?: string }>;
    };
  };
}) {
  const status = order.emails?.adminNotificationStatus;
  const recipients = order.emails?.adminNotificationRecipients || {};
  if (!status) return <span>Aucune donnée</span>;
  const label =
    status === "sent"
      ? "Envoyée"
      : status === "partial"
        ? "Partielle"
        : status === "failed"
          ? "Échouée"
          : "Ignorée";
  return (
    <div className="grid gap-1">
      <strong className="text-forest">{label}</strong>
      {Object.entries(recipients).map(([email, result]) => (
        <span key={email}>
          {email} : {result.status}
          {result.reason ? ` (${result.reason})` : ""}
        </span>
      ))}
    </div>
  );
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

function SourceLine({ source }: { source: string }) {
  return (
    <p className="mb-4 rounded-md border border-forest/10 bg-cream px-4 py-3 text-sm text-forest">
      Source actuelle : {sourceLabel(source)}. Les données de secours ne sont
      utilisées que si la base en ligne est indisponible.
    </p>
  );
}

function sourceLabel(source: string) {
  if (source === "firestore") return "base en ligne";
  if (source === "local") return "secours local";
  if (source === "empty") return "aucune donnée";
  return source;
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
  const estimatedTotal = activeOrders.reduce((sum, order) => sum + parseEuro(order.total), 0);
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
  const averageCart = activeOrders.length ? estimatedTotal / activeOrders.length : 0;
  const activeProducts = products.filter((product) => product.isActive);
  const totalStock = activeProducts.reduce(
    (sum, product) => sum + Number(product.stock || 0),
    0,
  );

  return [
    {
      label: "Total estimé",
      value: `${formatEuro(estimatedTotal)} EUR`,
      detail: `${activeOrders.length} commande(s) active(s)`,
    },
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
      label: "Panier moyen",
      value: `${formatEuro(averageCart)} EUR`,
      detail: "Commandes actives",
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
  const minimum = Number(coupon.minimumOrder || 0);
  const minimumText = minimum > 0 ? ` à partir de ${formatEuro(minimum)} EUR` : " sans minimum";
  return `${couponTypeLabel(coupon.discountType)} : ${couponValueLabel(coupon)}${minimumText}.`;
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
  if (method === "bank_transfer") return "Virement bancaire";
  if (method === "local_delivery_payment") return "Paiement à la livraison locale";
  return "À confirmer avec Verdanza";
}

function Input({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="text-sm font-medium text-forest">
      {label}
      <input
        className="input-field mt-2"
        type={type}
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
