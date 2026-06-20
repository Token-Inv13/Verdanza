import { FormEvent, useMemo, useState } from "react";
import { adminMetrics } from "../../data/adminMock";
import { useAdminData } from "../../hooks/useAdminData";
import { runManualInitialSeed } from "../../services/seedService";
import {
  updateProductFlags,
  updateProductStock,
  upsertProduct,
  type ProductInput,
} from "../../services/productsService";
import { updateOrderAdminFields } from "../../services/ordersService";
import type { OrderStatus, Product, ProductCategory } from "../../types";

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

export function AdminPage({ section }: { section: string }) {
  const {
    products,
    productSource,
    orders,
    orderSource,
    deliveryZones,
    deliverySource,
    isLoading,
    refresh,
  } = useAdminData();
  const [message, setMessage] = useState("");
  const [editingProduct, setEditingProduct] = useState<ProductInput>(emptyProduct);

  const lowStockProducts = useMemo(
    () => products.filter((product) => product.stock <= product.lowStockThreshold),
    [products],
  );

  async function handleSeed() {
    setMessage("");
    const confirmed = window.confirm(
      "Seeder les produits et zones Phase 1 dans Firestore ? Operation non destructive avec merge.",
    );
    if (!confirmed) return;
    const result = await runManualInitialSeed();
    setMessage(
      `Seed termine : ${result.products} produits, ${result.deliveryZones} zones.`,
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
    setMessage("Produit enregistre dans Firestore.");
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
            Seed manuel Phase 1
          </button>
        </div>
      </div>

      {message && (
        <p className="mt-4 rounded-md border border-champagne/30 bg-cream px-4 py-3 text-sm text-forest">
          {message}
        </p>
      )}

      {isLoading && <p className="mt-8 text-forest/70">Chargement Firestore...</p>}

      {section === "Dashboard" && (
        <>
          <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {adminMetrics.map((metric) => (
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
              if (orderSource === "mock") {
                setMessage("Les commandes mockees ne sont pas modifiables.");
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
                  Stock {product.stock}, seuil {product.lowStockThreshold}.
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
            orderSource={orderSource}
            onUpdate={async (orderId, data) => {
              if (orderSource === "mock") {
                setMessage("Les commandes mockees ne sont pas modifiables.");
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
          <AdminTable
            headers={["Zone", "Frais", "Minimum", "Delai", "Statut"]}
            rows={deliveryZones
              .filter((zone) => zone.method === "local_express")
              .map((zone) => [
                zone.name,
                `${zone.fee.toFixed(2)} EUR`,
                `${zone.minimumOrder} EUR`,
                zone.estimatedDelay,
                zone.isActive ? "Active" : "Inactive",
              ])}
          />
        </>
      )}

      {["Clients", "Coupons", "Parametres"].includes(section) && (
        <section className="mt-8 grid gap-4 lg:grid-cols-3">
          {[
            "Collection preparee",
            "Ecriture admin uniquement",
            "Connexion UI detaillee Phase 3",
          ].map((item) => (
            <article key={item} className="admin-card">
              <h2 className="font-display text-3xl text-forest">{item}</h2>
              <p className="mt-3 text-sm leading-6 text-ink/60">
                Module {section.toLowerCase()} structure pour Firestore, sans
                logique metier avancee dans cette phase.
              </p>
            </article>
          ))}
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
        {product.id ? "Editer produit" : "Creer produit"}
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
            label="Prix"
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
          Enregistrer dans Firestore
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
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
            <tr>
              {["Nom", "Categorie", "Prix", "Stock", "Actif", "Mis en avant", "Action"].map((header) => (
                <th key={header} className="px-4 py-3 font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-t border-forest/10">
                <td className="px-4 py-4 text-forest">{product.name}</td>
                <td className="px-4 py-4">{product.category}</td>
                <td className="px-4 py-4">{product.price.toFixed(2)} EUR</td>
                <td className="px-4 py-4">{product.stock}</td>
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

function AdminOrders({
  orders,
  orderSource,
  onUpdate,
}: {
  orders: {
    id: string;
    customer: string;
    customerEmail?: string;
    customerPhone?: string;
    paymentStatus: string;
    orderStatus: string;
    delivery: string;
    items: { name: string; quantity: number }[];
    total: string;
    internalNote?: string;
  }[];
  orderSource: "firestore" | "mock";
  onUpdate: (
    orderId: string,
    data: { orderStatus?: OrderStatus; internalNote?: string },
  ) => Promise<void>;
}) {
  return (
    <section className="mt-8 overflow-hidden rounded-lg border border-forest/10 bg-ivory">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] text-left text-sm">
          <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
            <tr>
              {[
                "Commande",
                "Client",
                "Paiement",
                "Statut commande",
                "Livraison",
                "Produits",
                "Total",
                "Note interne",
              ].map((header) => (
                <th key={header} className="px-4 py-3 font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-t border-forest/10">
                <td className="px-4 py-4">{order.id}</td>
                <td className="px-4 py-4">
                  <strong className="block text-forest">{order.customer}</strong>
                  <span className="block text-xs text-ink/55">{order.customerEmail}</span>
                  <span className="block text-xs text-ink/55">{order.customerPhone}</span>
                </td>
                <td className="px-4 py-4">{order.paymentStatus}</td>
                <td className="px-4 py-4">
                  <select
                    className="input-field"
                    value={order.orderStatus}
                    disabled={orderSource === "mock"}
                    onChange={(event) =>
                      void onUpdate(order.id, {
                        orderStatus: event.target.value as OrderStatus,
                      })
                    }
                  >
                    {[
                      "pending",
                      "paid",
                      "preparing",
                      "ready",
                      "shipped",
                      "out_for_delivery",
                      "delivered",
                      "cancelled",
                      "refunded",
                    ].map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-4">{order.delivery}</td>
                <td className="px-4 py-4">
                  {order.items.length
                    ? order.items.map((item) => `${item.name} x${item.quantity}`).join(", ")
                    : "A renseigner"}
                </td>
                <td className="px-4 py-4">{order.total}</td>
                <td className="px-4 py-4">
                  <input
                    className="input-field"
                    defaultValue={order.internalNote || ""}
                    placeholder="Note"
                    disabled={orderSource === "mock"}
                    onBlur={(event) =>
                      void onUpdate(order.id, {
                        internalNote: event.currentTarget.value,
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
      <strong className="mt-2 block text-forest">{count} entree(s)</strong>
      <span className="text-xs text-ink/50">Source : {value}</span>
    </article>
  );
}

function SourceLine({ source }: { source: string }) {
  return (
    <p className="mb-4 rounded-md border border-forest/10 bg-cream px-4 py-3 text-sm text-forest">
      Source actuelle : {source}. Si Firestore est vide ou indisponible, les
      donnees locales Phase 1 restent utilisees.
    </p>
  );
}

function AdminTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <section className="mt-8 overflow-hidden rounded-lg border border-forest/10 bg-ivory">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-cream text-xs uppercase tracking-[0.14em] text-forest/70">
            <tr>
              {headers.map((header) => (
                <th key={header} className="px-4 py-3 font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.join("-")} className="border-t border-forest/10">
                {row.map((cell) => (
                  <td key={cell} className="px-4 py-4 text-ink/75">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
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
