import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ProductInput } from "../../../services/productsService";
import {
  deleteProductImageByPath,
  uploadProductImageAsset,
  type ProductImageUploadProgress,
} from "../../../services/productImagesService";
import type { Product, ProductCategory, ProductImageAsset, FixedPriceMode, FixedPriceOption } from "../../../types";
import { BRAND_PRODUCT_PLACEHOLDER } from "../../../lib/brandAssets";
import {
  FIXED_PRICE_POLICY_VERSION,
  fixedPriceOptionsForMode,
  fixedPriceEffectiveUnitPrice,
  fixedPriceOptionLabel,
  isFixedPriceAdvantageous,
  normalizeFixedPriceMode,
  resolveFixedPriceOptions,
  validateManualFixedPriceOptions,
} from "../../../lib/fixedPriceOptions";
import { PRODUCT_IMAGE_MAX_COUNT, ensureSinglePrimary, normalizeProductImages } from "../../../lib/productImages";

export function ProductEditor({
  product,
  onChange,
  onSubmit,
  onImageStoragePathRemoved,
  onDeleteProduct,
  formId,
  pending,
  onUploadBusyChange,
}: {
  formId: string;
  pending: boolean;
  onUploadBusyChange: (busy: boolean) => void;
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
    <form id={formId} onSubmit={onSubmit} className="min-w-0">
      <fieldset disabled={pending} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Input label="Nom" value={product.name} onChange={(name) => onChange({ ...product, name })} />
        <Input
          label="Slug"
          value={product.slug}
          onChange={(slug) => onChange({ ...product, slug })}
        />
        <label className="text-sm font-medium text-forest">
          Categorie
          <select
            aria-label="Categorie"
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
        <div className="grid grid-cols-2 gap-3 sm:col-span-2 lg:grid-cols-4">
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
            disabled={Boolean(product.id)}
            value={product.stock}
            onChange={(stock) => onChange({ ...product, stock })}
          />
          <NumberInput
            label="Seuil faible"
            disabled={Boolean(product.id)}
            value={product.lowStockThreshold}
            onChange={(lowStockThreshold) =>
              onChange({ ...product, lowStockThreshold })
            }
          />
        </div>
        {product.id && <p className="text-xs leading-5 text-ink/60 sm:col-span-2">Le stock et son seuil se modifient dans Admin → Stocks, avec motif et confirmation.</p>}
        <div className="sm:col-span-2">
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
        <div className="grid grid-cols-3 gap-3 sm:col-span-2">
          <Input label="CBD" value={product.cbdRate} onChange={(cbdRate) => onChange({ ...product, cbdRate })} />
          <Input label="CBG" value={product.cbgRate} onChange={(cbgRate) => onChange({ ...product, cbgRate })} />
          <Input label="THC" value={product.thcRate} onChange={(thcRate) => onChange({ ...product, thcRate })} />
        </div>
        <Input label="Origine" value={product.origin} onChange={(origin) => onChange({ ...product, origin })} />
        <Input label="Culture" value={product.cultureType} onChange={(cultureType) => onChange({ ...product, cultureType: cultureType as Product["cultureType"] })} />
        <div className="sm:col-span-2">
          <ProductImagesEditor
            product={product}
            onChange={(patch) => onChange({ ...product, ...patch })}
            onStoragePathRemoved={onImageStoragePathRemoved}
            disabled={pending}
            onBusyChange={onUploadBusyChange}
          />
        </div>
        <Input label="Aromes, separes par virgule" value={product.aromas.join(", ")} onChange={(aromas) => onChange({ ...product, aromas: normalizeList(aromas) })} />
        <Input label="Tags, separes par virgule" value={product.tags.join(", ")} onChange={(tags) => onChange({ ...product, tags: normalizeList(tags) })} />
        <div className="rounded-xl border border-forest/10 bg-cream/40 p-4 sm:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-forest">Informations SEO</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="SEO title" value={product.seoTitle} onChange={(seoTitle) => onChange({ ...product, seoTitle })} />
            <Textarea label="SEO description" value={product.seoDescription} onChange={(seoDescription) => onChange({ ...product, seoDescription })} />
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-forest sm:col-span-2">
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
        {product.id && (
          <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900 sm:col-span-2">
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
      </fieldset>
    </form>
  );
}

function ProductImagesEditor({
  product,
  onChange,
  onStoragePathRemoved,
  disabled,
  onBusyChange,
}: {
  product: ProductInput;
  onChange: (patch: Pick<ProductInput, "images" | "image" | "imageAlt">) => void;
  onStoragePathRemoved: (path: string) => void;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [uploadProgress, setUploadProgress] = useState<ProductImageUploadProgress | null>(null);
  const [error, setError] = useState("");
  const uploading = useRef(false);
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
      image: primary?.url || BRAND_PRODUCT_PLACEHOLDER,
      imageAlt: primary?.alt || product.name || "Produit Verdanza",
    });
  }

  async function handleFiles(files: FileList | null) {
    if (disabled || uploading.current) return;
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
    uploading.current = true;
    onBusyChange(true);
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
    } finally {
      uploading.current = false;
      onBusyChange(false);
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
                  <span className="rounded-full bg-forest/10 px-2 py-1 text-xs font-semibold text-forest">
                    {image.isPrimary ? "Principale" : `Image ${index + 1}`}
                  </span>
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

function Input({
  label,
  value,
  onChange,
  type = "text",
  min,
  max,
  step,
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  min?: string;
  max?: string;
  step?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block min-w-0 text-sm font-medium text-forest">
      {label}
      <input
        aria-label={label}
        className="input-field mt-2"
        type={type}
        min={min}
        max={max}
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
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block min-w-0 text-sm font-medium text-forest">
      {label}
      <input
        aria-label={label}
        className="input-field mt-2"
        type="number"
        disabled={disabled}
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
    <label className="block min-w-0 text-sm font-medium text-forest">
      {label}
      <textarea
        aria-label={label}
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
