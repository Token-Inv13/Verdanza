import { Check, ShoppingBag } from "lucide-react";
import React, { type RefObject } from "react";
import {
  isFixedPriceAdvantageous,
  resolveFixedPriceOptions,
} from "../../lib/fixedPriceOptions";
import {
  formatProductPrice,
  productPurchaseCtaLabel,
  type ProductPurchaseOption,
} from "../../lib/productPurchaseOptions";
import type { Product, ProductImageAsset } from "../../types";
import { ProductImage } from "../ProductImage";

function productImageAlt(product: Product) {
  return product.imageAlt || `${product.name} - ${
    product.category === "flowers" ? "Fleur CBD" : "Résine CBD"
  } Verdanza`;
}

type ProductGalleryProps = {
  product: Product;
  images: ProductImageAsset[];
  selectedImage?: ProductImageAsset;
  onSelectImage: (imageId: string) => void;
};

export function ProductGallery({
  product,
  images,
  selectedImage,
  onSelectImage,
}: ProductGalleryProps) {
  const hasMultipleImages = images.length > 1;

  return (
    <section
      className="min-w-0 lg:col-start-1 lg:row-span-3 lg:row-start-1"
      aria-label={`Visuels de ${product.name}`}
      data-product-gallery
      data-image-count={images.length}
    >
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[1rem] border border-champagne/35 bg-[#fcfbf7] p-6 shadow-[0_18px_50px_rgba(11,61,46,0.06)] sm:p-10 lg:aspect-square">
        <ProductImage
          key={selectedImage?.id || "primary"}
          variant="detail"
          src={selectedImage?.url || product.image}
          alt={selectedImage?.alt || productImageAlt(product)}
          loading="eager"
          fetchPriority="high"
          className="product-page-v2__image mx-auto h-full w-full object-contain"
        />
      </div>

      {hasMultipleImages && (
        <div
          className="mt-3 grid grid-cols-3 gap-3"
          aria-label={`Choisir un visuel de ${product.name}`}
          data-product-thumbnails
        >
          {images.map((image) => {
            const selected = image.id === selectedImage?.id;
            return (
              <button
                key={image.id}
                type="button"
                className={`product-page-v2__thumbnail aspect-[4/3] min-h-14 overflow-hidden rounded-[0.65rem] border bg-[#fcfbf7] p-2.5 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 motion-reduce:transition-none ${
                  selected
                    ? "border-forest shadow-[inset_0_0_0_1px_rgba(11,61,46,0.12)]"
                    : "border-forest/10 hover:border-forest/35"
                }`}
                aria-label={`Afficher ${image.alt}`}
                aria-pressed={selected}
                data-product-thumbnail
                onClick={() => onSelectImage(image.id)}
              >
                <ProductImage
                  variant="card"
                  src={image.url}
                  alt=""
                  className="h-full w-full object-contain"
                />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

type ProductPurchasePanelProps = {
  product: Product;
  purchaseOptions: ProductPurchaseOption[];
  selectedPurchaseOption?: ProductPurchaseOption;
  availabilityLabel: string;
  stockLabel: string;
  purchaseBlockRef?: RefObject<HTMLDivElement>;
  onSelectPurchaseOption: (optionId: string) => void;
  onAddToCart: () => void;
};

export function ProductPurchasePanel({
  product,
  purchaseOptions,
  selectedPurchaseOption,
  availabilityLabel,
  stockLabel,
  purchaseBlockRef,
  onSelectPurchaseOption,
  onAddToCart,
}: ProductPurchasePanelProps) {
  const fixedPriceOptions = resolveFixedPriceOptions(product);

  return (
    <div
      ref={purchaseBlockRef}
      className="rounded-[0.9rem] border border-champagne/40 bg-ivory p-5 shadow-[0_14px_38px_rgba(11,61,46,0.07)] sm:p-6"
      data-product-purchase
    >
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-champagne/25 pb-4">
        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-ink/45">
            Prix
          </p>
          <p className="mt-1 font-display text-[2rem] leading-none text-forest sm:text-4xl">
            {formatProductPrice(product.price)}/g
          </p>
        </div>
        <span
          className={`text-sm font-semibold ${
            selectedPurchaseOption ? "text-forest/65" : "text-red-700"
          }`}
          data-product-availability
        >
          {availabilityLabel}
        </span>
      </div>

      {purchaseOptions.length > 0 && (
        <fieldset className="mt-5">
          <legend className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-forest/65">
            Choisir un format
          </legend>
          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {purchaseOptions.map((option) => {
              const selected = option.id === selectedPurchaseOption?.id;
              const unitPrice = option.totalPrice / option.quantityGrams;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`relative min-h-20 rounded-[0.65rem] border px-3 py-3 text-left transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 motion-reduce:transition-none ${
                    selected
                      ? "border-forest bg-sage/25 text-forest shadow-[inset_0_0_0_1px_rgba(11,61,46,0.08)]"
                      : "border-forest/15 bg-[#fcfbf7] text-forest hover:border-forest/35"
                  } disabled:cursor-not-allowed disabled:border-forest/10 disabled:bg-cream/45 disabled:text-ink/35 disabled:opacity-100`}
                  aria-label={`${option.quantityGrams} g, ${formatProductPrice(option.totalPrice)}${
                    option.available ? "" : ", indisponible"
                  }`}
                  aria-pressed={selected}
                  disabled={!option.available}
                  data-purchase-option={option.id}
                  data-purchase-option-available={option.available ? "true" : "false"}
                  onClick={() => onSelectPurchaseOption(option.id)}
                >
                  {selected && (
                    <Check
                      size={15}
                      className="absolute right-2.5 top-2.5 text-forest/70"
                      aria-hidden="true"
                    />
                  )}
                  <span className="block font-semibold">{option.quantityGrams} g</span>
                  <span className="mt-1 block text-sm text-forest/70">
                    {formatProductPrice(option.totalPrice)}
                  </span>
                  {option.quantityGrams > 1 && (
                    <span className="mt-1 block text-[0.7rem] leading-tight text-forest/50">
                      {formatProductPrice(unitPrice)}/g
                    </span>
                  )}
                  {!option.available && (
                    <span className="mt-1 block text-[0.7rem] leading-tight text-red-700">
                      Indisponible
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {fixedPriceOptions.some((option) => isFixedPriceAdvantageous(product, option)) && (
        <p className="mt-3 text-xs leading-5 text-forest/55">
          Le prix au gramme varie selon le format choisi.
        </p>
      )}

      <button
        type="button"
        className="btn-primary mt-5 min-h-11 w-full disabled:cursor-not-allowed disabled:bg-forest/45 disabled:text-ivory/80"
        disabled={!selectedPurchaseOption}
        onClick={onAddToCart}
      >
        <ShoppingBag size={18} aria-hidden="true" />
        {selectedPurchaseOption
          ? `Ajouter ${productPurchaseCtaLabel(selectedPurchaseOption)}`
          : stockLabel !== "Disponible"
            ? stockLabel
            : "Stock restant insuffisant"}
      </button>
    </div>
  );
}
