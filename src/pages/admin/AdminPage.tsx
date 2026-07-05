import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAdminData } from "../../hooks/useAdminData";
import { runManualInitialSeed } from "../../services/seedService";
import {
  updateProductFlags,
  updateProductStock,
  upsertProduct,
  type ProductInput,
} from "../../services/productsService";
import { updateOrderAdminFields } from "../../services/ordersService";
import { updateDeliveryZoneAdmin } from "../../services/deliveryZonesService";
import {
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
import type {
  AdminMetric,
  BillingSettings,
  Coupon,
  CustomerProfile,
  DeliveryZone,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  OrderStatus,
  PaymentProvider,
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

  async function handleSeed() {
    setMessage("");
    const confirmed = window.confirm(
      "Mettre a jour le catalogue Verdanza et les zones de livraison ? Operation non destructive. Les anciens produits absents du catalogue seront desactives.",
    );
    if (!confirmed) return;
    const result = await runManualInitialSeed();
    setMessage(
      `Seed termine : ${result.products.upserted} produits, ${result.products.deactivated} anciens produits desactives, ${result.deliveryZones} zones.`,
    );
    await refresh();
  }

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
    data: Pick<DeliveryZone, "isActive" | "fee" | "minimumOrder" | "estimatedDelay">,
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

  async function handleLoyaltyAdjustment(customer: CustomerProfile) {
    const rawPoints = window.prompt("Nombre de points a ajouter ou retirer", "0");
    const points = Number(rawPoints);
    if (!Number.isFinite(points) || points === 0) return;
    const note = window.prompt("Motif de l'ajustement", "") || "";
    await adjustCustomerLoyalty(customer, points, note);
    await refresh();
  }

  return (
    <div className="p-5 md:p-8">
      <div className="flex flex-col justify-between gap-4 border-b border-forest/10 pb-6 md:flex-row md:items-end">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-champagne">
            Verdanza
          </p>
          <h1 className="font-display text-5xl text-forest">{section}</h1>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <button className="btn-secondary" onClick={() => void refresh()}>
            Rafraichir
          </button>
          <button className="btn-primary" onClick={() => void handleSeed()}>
            Seed catalogue
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
          <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {dashboardMetrics.map((metric) => (
              <article key={metric.label} className="admin-card">
                <p className="text-sm text-ink/55">{metric.label}</p>
                <strong className="mt-2 block font-display text-4xl text-forest">
                  {metric.value}
                </strong>
                <span className="text-xs text-ink/50">{metric.detail}</span>
              </article>
            ))}
          </section>
          <section className="mt-6 grid gap-4 md:grid-cols-3">
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
                <td className="px-4 py-4">{product.category}</td>
                <td className="px-4 py-4">{product.price.toFixed(2)} EUR/g</td>
                <td className="px-4 py-4">{product.stock} g</td>
                <td className="px-4 py-4">
                  <button className="tag" onClick={() => void onFlagChange(product, "isActive")}>
                    {product.isActive ? "Actif" : "Inactif"}
                  </button>
                </td>
                <td className="px-4 py-4">
                  <button className="tag" onClick={() => void onFlagChange(product, "isFeatured")}>
                    {product.isFeatured ? "Oui" : "Non"}
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
      <div>
        <h2 className="font-display text-2xl text-forest">{product.name}</h2>
        <p className="text-sm text-ink/55">
          {product.stock <= product.lowStockThreshold ? "Stock faible" : "Stock OK"}
        </p>
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

function DeliveryZonesPanel({
  zones,
  onSave,
}: {
  zones: DeliveryZone[];
  onSave: (
    zone: DeliveryZone,
    data: Pick<DeliveryZone, "isActive" | "fee" | "minimumOrder" | "estimatedDelay">,
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
    data: Pick<DeliveryZone, "isActive" | "fee" | "minimumOrder" | "estimatedDelay">,
  ) => Promise<void>;
}) {
  const [isActive, setIsActive] = useState(zone.isActive);
  const [fee, setFee] = useState(zone.fee);
  const [minimumOrder, setMinimumOrder] = useState(zone.minimumOrder);
  const [estimatedDelay, setEstimatedDelay] = useState(zone.estimatedDelay);

  return (
    <article className="admin-card grid gap-4 xl:grid-cols-[1fr_120px_140px_1.2fr_110px_auto] xl:items-end">
      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-champagne">
          {zone.method === "postal" ? "Postale" : "Locale"}
        </p>
        <h2 className="font-display text-2xl text-forest">{zone.name}</h2>
      </div>
      <NumberInput label="Frais" value={fee} onChange={setFee} />
      <NumberInput label="Minimum" value={minimumOrder} onChange={setMinimumOrder} />
      <Input label="Delai" value={estimatedDelay} onChange={setEstimatedDelay} />
      <label className="text-sm font-medium text-forest">
        Statut
        <select
          className="input-field mt-2"
          value={isActive ? "active" : "inactive"}
          onChange={(event) => setIsActive(event.target.value === "active")}
        >
          <option value="active">Actif</option>
          <option value="inactive">Inactif</option>
        </select>
      </label>
      <button
        className="btn-primary"
        onClick={() =>
          void onSave(zone, {
            isActive,
            fee,
            minimumOrder,
            estimatedDelay,
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
  return (
    <form onSubmit={onSubmit} className="admin-card h-fit">
      <h2 className="font-display text-3xl text-forest">
        {coupon.id ? "Éditer promo" : "Créer promo"}
      </h2>
      <div className="mt-5 grid gap-4">
        <Input label="Code" value={coupon.code} onChange={(code) => onChange({ ...coupon, code: code.toUpperCase() })} />
        <Input label="Libelle" value={coupon.label} onChange={(label) => onChange({ ...coupon, label })} />
        <label className="text-sm font-medium text-forest">
          Type
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
            <option value="free_shipping">Livraison offerte</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <NumberInput
            label="Valeur"
            value={coupon.discountValue}
            onChange={(discountValue) => onChange({ ...coupon, discountValue })}
          />
          <NumberInput
            label="Minimum"
            value={coupon.minimumOrder}
            onChange={(minimumOrder) => onChange({ ...coupon, minimumOrder })}
          />
          <NumberInput
            label="Limite utilisations"
            value={coupon.maxUses || 0}
            onChange={(maxUses) => onChange({ ...coupon, maxUses: maxUses || undefined })}
          />
          <NumberInput
            label="Deja utilise"
            value={coupon.usedCount || 0}
            onChange={(usedCount) => onChange({ ...coupon, usedCount })}
          />
        </div>
        <Input
          label="Debut ISO optionnel"
          value={coupon.startsAt || ""}
          onChange={(startsAt) => onChange({ ...coupon, startsAt: startsAt || undefined })}
        />
        <Input
          label="Fin ISO optionnelle"
          value={coupon.endsAt || ""}
          onChange={(endsAt) => onChange({ ...coupon, endsAt: endsAt || undefined })}
        />
        <Input
          label="IDs produits optionnels"
          value={(coupon.productIds ?? []).join(", ")}
          onChange={(productIds) => onChange({ ...coupon, productIds: normalizeList(productIds) })}
        />
        <Input
          label="Categories optionnelles"
          value={(coupon.categories ?? []).join(", ")}
          onChange={(categories) =>
            onChange({ ...coupon, categories: normalizeList(categories) as ProductCategory[] })
          }
        />
        <label className="flex items-center gap-2 text-sm text-forest">
          <input
            type="checkbox"
            checked={coupon.isActive}
            onChange={(event) => onChange({ ...coupon, isActive: event.target.checked })}
          />
          Actif
        </label>
        <button className="btn-primary" type="submit">
          Enregistrer promo
        </button>
      </div>
    </form>
  );
}

function CouponsTable({
  coupons,
  onEdit,
  onToggle,
}: {
  coupons: Coupon[];
  onEdit: (coupon: CouponInput) => void;
  onToggle: (coupon: Coupon) => Promise<void>;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-forest/10 bg-ivory">
      {!coupons.length && (
        <p className="border-b border-forest/10 bg-cream px-4 py-4 text-sm text-forest">
          Aucun code promo pour le moment.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
            <tr>
              {["Code", "Type", "Valeur", "Minimum", "Utilisations", "Statut", "Action"].map((header) => (
                <th key={header} className="px-4 py-3 font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coupons.map((coupon) => (
              <tr key={coupon.id} className="border-t border-forest/10">
                <td className="px-4 py-4">
                  <strong className="block text-forest">{coupon.code}</strong>
                  <span className="text-xs text-ink/55">{coupon.label}</span>
                </td>
                <td className="px-4 py-4">{coupon.discountType}</td>
                <td className="px-4 py-4">{coupon.discountValue}</td>
                <td className="px-4 py-4">{coupon.minimumOrder} EUR</td>
                <td className="px-4 py-4">
                  {coupon.usedCount}
                  {coupon.maxUses ? ` / ${coupon.maxUses}` : ""}
                </td>
                <td className="px-4 py-4">
                  <button className="tag" onClick={() => void onToggle(coupon)}>
                    {coupon.isActive ? "Actif" : "Inactif"}
                  </button>
                </td>
                <td className="px-4 py-4">
                  <button className="btn-secondary min-h-9 px-3 py-2" onClick={() => onEdit(coupon)}>
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
      <div className="overflow-x-auto">
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

function AdminOrders({
  orders,
  invoices = [],
  orderSource,
  onCreateInvoice,
  onUpdate,
}: {
  orders: {
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
    orderStatus: string;
    deliveryMethod?: string;
    delivery: string;
    trackingNumber?: string;
    paymentReference?: string;
    customerMessage?: string;
    items: { name: string; quantity: number }[];
    total: string;
    internalNote?: string;
    statusHistory?: StatusHistoryEntry[];
  }[];
  invoices?: Invoice[];
  orderSource: "firestore" | "empty";
  onCreateInvoice?: (orderId: string) => Promise<void>;
  onUpdate: (
    orderId: string,
    data: {
      orderStatus?: OrderStatus;
      paymentStatus?: PaymentStatus;
      internalNote?: string;
      historyNote?: string;
      paymentReference?: string;
      trackingNumber?: string;
    },
  ) => Promise<void>;
}) {
  const [filter, setFilter] = useState("all");
  const invoiceByOrderId = new Map(invoices.map((invoice) => [invoice.orderId, invoice]));
  const filteredOrders = orders.filter((order) => orderMatchesAdminFilter(order, filter));
  const filters = [
    ["all", "Toutes"],
    ["preorder", "Précommandes"],
    ["local", "Commandes locales"],
    ["postal", "Commandes postales"],
    ["contact_required", "ì contacter"],
    ["confirmed", "Confirmées"],
    ["preparing", "En préparation"],
    ["out_for_delivery", "En livraison"],
    ["delivered", "Livrées"],
    ["cancelled", "Annulées"],
  ];

  return (
    <section className="mt-8 overflow-hidden rounded-lg border border-forest/10 bg-ivory">
      {!orders.length && (
        <p className="border-b border-forest/10 bg-cream px-4 py-4 text-sm text-forest">
          Aucune commande pour le moment.
        </p>
      )}
      {!!orders.length && (
        <div className="flex flex-wrap gap-2 border-b border-forest/10 bg-cream px-4 py-4">
          {filters.map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? "btn-primary min-h-8 px-3 py-1 text-xs" : "btn-secondary min-h-8 px-3 py-1 text-xs"}
              onClick={() => setFilter(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {!!orders.length && !filteredOrders.length && (
        <p className="border-b border-forest/10 px-4 py-4 text-sm text-forest">
          Aucune commande pour ce filtre.
        </p>
      )}
      <div className="overflow-x-auto">
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
                "Note interne",
                "Historique",
              ].map((header) => (
                <th key={header} className="px-4 py-3 font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map((order) => (
              <tr key={order.id} className="border-t border-forest/10">
                <td className="px-4 py-4">
                  <span className="rounded-full border border-champagne/40 px-2 py-1 text-xs text-forest">
                    {order.orderType === "preorder" ? "Précommande" : "Commande"}
                  </span>
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
                    {["to_confirm", "pending", "paid", "cancelled"].map((status) => (
                      <option key={status} value={status}>
                        {paymentStatusLabel(status)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-4">
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function orderMatchesAdminFilter(
  order: {
    orderType?: string;
    deliveryMethod?: string;
    orderStatus: string;
  },
  filter: string,
) {
  if (filter === "all") return true;
  if (filter === "preorder") return order.orderType === "preorder";
  if (filter === "local") return order.deliveryMethod === "local_express";
  if (filter === "postal") return order.deliveryMethod === "postal";
  return order.orderStatus === filter;
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
    ["to_confirm", "pending"].includes(order.paymentStatus),
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
function Input({
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
      <input
        className="input-field mt-2"
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
