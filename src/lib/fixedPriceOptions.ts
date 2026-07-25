import type { CartItem, FixedPriceMode, FixedPriceOption, Product } from "../types/index.js";

export const FIXED_PRICE_POLICY_VERSION = 1;

export type CartLineIdentity = {
  productId: string;
  purchaseMode?: CartItem["purchaseMode"];
  fixedPriceOptionId?: string;
};

export type FixedPriceResolvedOption = FixedPriceOption & {
  source: "automatic" | "manual";
  policyVersion?: number;
  effectivePricePerGram: number;
  savingAmount: number;
  savingRate: number;
};

export type FixedPriceValidationIssue = {
  optionId?: string;
  severity: "warning" | "error";
  message: string;
};

type FixedPriceTierPolicy = {
  name: "entry" | "middle" | "upper";
  amountMin: number;
  amountMax: number;
  savingMin: number;
  savingMax: number;
  savingTarget: number;
};

const FIXED_PRICE_POLICY = {
  maxOptions: 3,
  maxGramsPerFormat: 25,
  amountStep: 5,
  maxSavingRate: 0.1,
  version: FIXED_PRICE_POLICY_VERSION,
  tiers: [
    {
      name: "entry",
      amountMin: 20,
      amountMax: 40,
      savingMin: 0.02,
      savingMax: 0.05,
      savingTarget: 0.04,
    },
    {
      name: "middle",
      amountMin: 30,
      amountMax: 60,
      savingMin: 0.05,
      savingMax: 0.08,
      savingTarget: 0.07,
    },
    {
      name: "upper",
      amountMin: 40,
      amountMax: 100,
      savingMin: 0.08,
      savingMax: 0.1,
      savingTarget: 0.09,
    },
  ] satisfies FixedPriceTierPolicy[],
};

export function normalizeFixedPriceMode(
  value: unknown,
  category?: Product["category"],
): FixedPriceMode {
  if (value === "manual" || value === "disabled" || value === "automatic") return value;
  return isGramSoldCategory(category) ? "automatic" : "disabled";
}

export function isGramSoldCategory(category?: Product["category"] | null) {
  return category === "flowers" || category === "resins";
}

export function normalizeFixedPriceOptions(value: unknown): FixedPriceOption[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((entry, index) => normalizeFixedPriceOption(entry, index))
    .filter((entry): entry is FixedPriceOption => Boolean(entry))
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .sort((left, right) => {
      const leftOrder = Number(left.sortOrder ?? Number.MAX_SAFE_INTEGER);
      const rightOrder = Number(right.sortOrder ?? Number.MAX_SAFE_INTEGER);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      if (left.totalPrice !== right.totalPrice) return left.totalPrice - right.totalPrice;
      return left.quantityGrams - right.quantityGrams;
    });
}

export function fixedPriceOptionsForMode(
  mode: FixedPriceMode,
  options: unknown,
): FixedPriceOption[] {
  return mode === "manual" ? normalizeFixedPriceOptions(options) : [];
}

export function serializeFixedPriceOptionsForFirestore(options: unknown): FixedPriceOption[] {
  return normalizeFixedPriceOptions(options).map((option) => {
    const serialized: FixedPriceOption = {
      id: option.id,
      totalPrice: finiteMoney(option.totalPrice, `fixedPriceOptions.${option.id}.totalPrice`),
      quantityGrams: positiveFiniteInteger(
        option.quantityGrams,
        `fixedPriceOptions.${option.id}.quantityGrams`,
      ),
      isActive: option.isActive !== false,
    };
    const sortOrder = Number(option.sortOrder);
    if (Number.isFinite(sortOrder)) serialized.sortOrder = sortOrder;
    if (option.source === "manual" || option.source === "automatic") {
      serialized.source = option.source;
    }
    const policyVersion = Number(option.policyVersion);
    if (Number.isFinite(policyVersion)) serialized.policyVersion = policyVersion;
    const label = typeof option.label === "string" ? option.label.trim() : "";
    if (label) serialized.label = label;
    return serialized;
  });
}

export function serializeFixedPriceOptionsForMode(
  mode: FixedPriceMode,
  options: unknown,
): FixedPriceOption[] {
  return mode === "manual" ? serializeFixedPriceOptionsForFirestore(options) : [];
}

export function assertNoUndefinedDeep(value: unknown, path = "payload") {
  if (value === undefined) {
    throw new Error(`Valeur undefined interdite dans ${path}.`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`Valeur numerique non finie interdite dans ${path}.`);
  }
  if (typeof value === "function") {
    throw new Error(`Fonction interdite dans ${path}.`);
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoUndefinedDeep(entry, `${path}.${index}`));
    return;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    assertNoUndefinedDeep(entry, `${path}.${key}`);
  });
}

export function resolveFixedPriceOptions(product?: Product | null): FixedPriceResolvedOption[] {
  if (!product || product.isActive === false) return [];
  const mode = normalizeFixedPriceMode(product.fixedPriceMode, product.category);
  if (mode === "disabled" || !isGramSoldCategory(product.category)) return [];
  if (mode === "manual") {
    return normalizeFixedPriceOptions(product.fixedPriceOptions)
      .filter((option) => option.isActive)
      .map((option) => enrichFixedPriceOption(product, option, "manual"))
      .filter((option): option is FixedPriceResolvedOption => Boolean(option));
  }
  return generateAutomaticFixedPriceOptions(product);
}

export function activeFixedPriceOptions(product?: Product | null) {
  return resolveFixedPriceOptions(product);
}

export function validateManualFixedPriceOptions(product: Product): FixedPriceValidationIssue[] {
  const mode = normalizeFixedPriceMode(product.fixedPriceMode, product.category);
  if (mode !== "manual") return [];

  const issues: FixedPriceValidationIssue[] = [];
  const activeOptions = normalizeFixedPriceOptions(product.fixedPriceOptions).filter(
    (option) => option.isActive,
  );
  const seenTotals = new Set<number>();
  const seenGrams = new Set<number>();
  let previous: FixedPriceResolvedOption | null = null;

  for (const option of activeOptions) {
    const resolved = enrichFixedPriceOption(product, option, "manual");
    if (!resolved) {
      issues.push({
        optionId: option.id,
        severity: "error",
        message: "Format manuel invalide.",
      });
      continue;
    }
    if (resolved.savingAmount <= 0 || resolved.savingRate <= 0) {
      issues.push({
        optionId: option.id,
        severity: "error",
        message: "Le format doit rester moins cher que l'achat au gramme.",
      });
    }
    if (resolved.savingRate > FIXED_PRICE_POLICY.maxSavingRate) {
      issues.push({
        optionId: option.id,
        severity: "error",
        message: "L'economie ne doit pas depasser 10 %.",
      });
    }
    if (seenTotals.has(resolved.totalPrice)) {
      issues.push({
        optionId: option.id,
        severity: "error",
        message: "Un autre format actif utilise deja ce montant.",
      });
    }
    if (seenGrams.has(resolved.quantityGrams)) {
      issues.push({
        optionId: option.id,
        severity: "error",
        message: "Un autre format actif utilise deja cette quantite.",
      });
    }
    if (previous) {
      if (resolved.totalPrice <= previous.totalPrice) {
        issues.push({
          optionId: option.id,
          severity: "error",
          message: "Les montants actifs doivent progresser.",
        });
      }
      if (resolved.quantityGrams <= previous.quantityGrams) {
        issues.push({
          optionId: option.id,
          severity: "error",
          message: "Les grammes actifs doivent progresser.",
        });
      }
      if (resolved.savingRate <= previous.savingRate) {
        issues.push({
          optionId: option.id,
          severity: "error",
          message: "L'economie doit progresser entre les formats actifs.",
        });
      }
      if (resolved.effectivePricePerGram >= previous.effectivePricePerGram) {
        issues.push({
          optionId: option.id,
          severity: "error",
          message: "Le prix effectif au gramme doit diminuer.",
        });
      }
    }
    seenTotals.add(resolved.totalPrice);
    seenGrams.add(resolved.quantityGrams);
    previous = resolved;
  }

  return issues;
}

export function fixedPriceOptionLabel(option: FixedPriceOption) {
  const configured = String(option.label || "").trim();
  if (configured) return configured;
  return `${formatMoney(option.totalPrice)} - ${option.quantityGrams} g`;
}

export function fixedPriceOptionPublicLabel(option: FixedPriceOption) {
  return `${formatPublicMoney(option.totalPrice)} · ${option.quantityGrams} g`;
}

export function fixedPriceUnitPricePublicLabel(option: FixedPriceOption) {
  return `${formatPublicMoney(fixedPriceEffectiveUnitPrice(option))}/g`;
}

export function fixedPriceCartLineLabel(option: FixedPriceOption, quantity = 1) {
  const count = positiveInteger(quantity);
  if (count === 1) return `Format ${fixedPriceOptionPublicLabel(option)}`;
  return `${count} × format ${formatPublicMoney(option.totalPrice)} · ${fixedPriceQuantityGrams(option, count)} g au total`;
}

export function fixedPriceEffectiveUnitPrice(option: FixedPriceOption) {
  return option.quantityGrams > 0
    ? roundMoney(Number(option.totalPrice || 0) / option.quantityGrams)
    : 0;
}

export function fixedPriceLineTotal(option: FixedPriceOption, quantity: number) {
  return roundMoney(Number(option.totalPrice || 0) * positiveInteger(quantity));
}

export function fixedPriceQuantityGrams(option: FixedPriceOption, quantity: number) {
  return Number(option.quantityGrams || 0) * positiveInteger(quantity);
}

export function isFixedPriceAdvantageous(product: Product, option: FixedPriceOption) {
  return fixedPriceEffectiveUnitPrice(option) < Number(product.price || 0);
}

export function cartItemKey(item: CartLineIdentity) {
  const mode = item.purchaseMode === "fixed_price" ? "fixed_price" : "gram";
  return mode === "fixed_price"
    ? `${item.productId}:fixed_price:${item.fixedPriceOptionId || ""}`
    : `${item.productId}:gram`;
}

export function sameCartLine(left: CartLineIdentity, right: CartLineIdentity) {
  return cartItemKey(left) === cartItemKey(right);
}

export function normalizeCartItems(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): CartItem | null => {
      if (!entry || typeof entry !== "object") return null;
      const input = entry as Partial<CartItem>;
      const productId = String(input.productId || "").trim();
      const quantity = positiveInteger(input.quantity);
      if (!productId || quantity <= 0) return null;
      const purchaseMode = input.purchaseMode === "fixed_price" ? "fixed_price" : "gram";
      if (purchaseMode === "fixed_price") {
        const fixedPriceOptionId = String(input.fixedPriceOptionId || "").trim();
        if (!fixedPriceOptionId) return null;
        return { productId, quantity, purchaseMode, fixedPriceOptionId };
      }
      return { productId, quantity, purchaseMode: "gram" };
    })
    .filter((entry): entry is CartItem => Boolean(entry));
}

export function positiveInteger(value: unknown) {
  const parsed = Math.floor(Number(value || 0));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function finiteMoney(value: unknown, path: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Valeur monetaire invalide pour ${path}.`);
  }
  return roundMoney(number);
}

function positiveFiniteInteger(value: unknown, path: string) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Quantite invalide pour ${path}.`);
  }
  return number;
}

function generateAutomaticFixedPriceOptions(product: Product): FixedPriceResolvedOption[] {
  const unitPrice = Number(product.price || 0);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return [];

  const selected: FixedPriceResolvedOption[] = [];
  for (const tier of FIXED_PRICE_POLICY.tiers) {
    const previous = selected.length > 0 ? selected[selected.length - 1] : undefined;
    const candidates = automaticTierCandidates(product, tier, previous).sort(
      (left, right) => {
        const leftTargetDistance = Math.abs(left.savingRate - tier.savingTarget);
        const rightTargetDistance = Math.abs(right.savingRate - tier.savingTarget);
        if (leftTargetDistance !== rightTargetDistance) {
          return leftTargetDistance - rightTargetDistance;
        }
        if (left.totalPrice !== right.totalPrice) return left.totalPrice - right.totalPrice;
        return left.quantityGrams - right.quantityGrams;
      },
    );
    const candidate = candidates[0];
    if (candidate) selected.push({ ...candidate, sortOrder: selected.length });
    if (selected.length >= FIXED_PRICE_POLICY.maxOptions) break;
  }

  return selected;
}

function automaticTierCandidates(
  product: Product,
  tier: FixedPriceTierPolicy,
  previous?: FixedPriceResolvedOption,
) {
  const unitPrice = Number(product.price || 0);
  const candidates: FixedPriceResolvedOption[] = [];
  for (
    let totalPrice = tier.amountMin;
    totalPrice <= tier.amountMax;
    totalPrice += FIXED_PRICE_POLICY.amountStep
  ) {
    for (let grams = 1; grams <= FIXED_PRICE_POLICY.maxGramsPerFormat; grams += 1) {
      const normalValue = roundMoney(unitPrice * grams);
      const savingAmount = roundMoney(normalValue - totalPrice);
      if (savingAmount <= 0) continue;
      const savingRate = normalValue > 0 ? roundMoney(savingAmount / normalValue) : 0;
      if (savingRate < tier.savingMin || savingRate > tier.savingMax) continue;
      if (savingRate > FIXED_PRICE_POLICY.maxSavingRate) continue;
      const effectivePricePerGram = fixedPriceEffectiveUnitPrice({
        id: "",
        totalPrice,
        quantityGrams: grams,
        isActive: true,
      });
      if (previous) {
        if (totalPrice <= previous.totalPrice) continue;
        if (grams <= previous.quantityGrams) continue;
        if (savingRate <= previous.savingRate) continue;
        if (effectivePricePerGram >= previous.effectivePricePerGram) continue;
      }
      candidates.push({
        id: automaticFixedPriceOptionId(totalPrice, grams),
        totalPrice: roundMoney(totalPrice),
        quantityGrams: grams,
        isActive: true,
        source: "automatic",
        policyVersion: FIXED_PRICE_POLICY.version,
        effectivePricePerGram,
        savingAmount,
        savingRate,
      });
    }
  }
  return candidates;
}

function enrichFixedPriceOption(
  product: Product,
  option: FixedPriceOption,
  source: "manual" | "automatic",
): FixedPriceResolvedOption | null {
  const unitPrice = Number(product.price || 0);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  const totalPrice = roundMoney(Number(option.totalPrice || 0));
  const quantityGrams = Math.floor(Number(option.quantityGrams || 0));
  if (totalPrice <= 0 || quantityGrams <= 0) return null;
  const normalValue = roundMoney(unitPrice * quantityGrams);
  const savingAmount = roundMoney(normalValue - totalPrice);
  const savingRate = normalValue > 0 ? roundMoney(savingAmount / normalValue) : 0;
  return {
    ...option,
    totalPrice,
    quantityGrams,
    source,
    policyVersion:
      source === "automatic"
        ? FIXED_PRICE_POLICY.version
        : option.policyVersion,
    effectivePricePerGram: fixedPriceEffectiveUnitPrice(option),
    savingAmount,
    savingRate,
  };
}

function automaticFixedPriceOptionId(totalPrice: number, grams: number) {
  return `auto-v${FIXED_PRICE_POLICY.version}-${Math.round(totalPrice * 100)}-${grams}g`;
}

function normalizeFixedPriceOption(value: unknown, index: number): FixedPriceOption | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<FixedPriceOption>;
  const totalPrice = Number(input.totalPrice);
  const quantityGrams = Math.floor(Number(input.quantityGrams));
  if (!Number.isFinite(totalPrice) || totalPrice <= 0) return null;
  if (!Number.isFinite(quantityGrams) || quantityGrams <= 0) return null;
  const id = String(input.id || `format-${quantityGrams}g-${Math.round(totalPrice * 100)}`)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!id) return null;
  const rawSortOrder = (value as Record<string, unknown>).sortOrder;
  const sortOrder = rawSortOrder === undefined || rawSortOrder === null || rawSortOrder === ""
    ? index
    : Number(rawSortOrder);
  const rawPolicyVersion = (value as Record<string, unknown>).policyVersion;
  const policyVersion = Number(rawPolicyVersion);
  const source = input.source === "automatic" || input.source === "manual"
    ? input.source
    : undefined;
  return {
    id,
    label: String(input.label || "").trim() || undefined,
    totalPrice: roundMoney(totalPrice),
    quantityGrams,
    isActive: input.isActive !== false,
    ...(Number.isFinite(sortOrder) ? { sortOrder } : {}),
    ...(source ? { source } : {}),
    ...(Number.isFinite(policyVersion) ? { policyVersion } : {}),
  };
}

function formatMoney(value: number) {
  return `${roundMoney(value).toFixed(2).replace(".", ",")} EUR`;
}

function formatPublicMoney(value: number) {
  return `${roundMoney(value).toFixed(2).replace(".", ",")} €`;
}
