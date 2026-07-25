import {
  normalizeSupplierPurchaseInput,
  roundMoney,
} from "./accountingCosts.js";
import type {
  Product,
  SupplierProductAlias,
  SupplierPurchase,
  SupplierPurchaseLine,
} from "../types/index.js";

export type SupplierInvoiceParserContext = {
  products: Product[];
  aliases: SupplierProductAlias[];
};

export type SupplierInvoiceParseIssue = {
  level: "info" | "warning" | "error";
  message: string;
};

export type SupplierInvoiceParseResult = {
  parserName: string;
  purchase: Partial<SupplierPurchase>;
  ignoredFreeLineLabels: string[];
  issues: SupplierInvoiceParseIssue[];
  isBlocked: boolean;
};

type ParsedSupplierLine = {
  originalLabel: string;
  quantityGrams: number;
  grossAmountExVat: number;
  vatRate: number;
  lineDiscountAmount: number;
};

type SupplierLineMatch = Pick<
  SupplierPurchaseLine,
  "productId" | "productName" | "productInternalReference" | "matchSource" | "matchConfidence"
>;

export interface SupplierInvoiceParser {
  name: string;
  canParse(text: string): boolean;
  parse(text: string, context: SupplierInvoiceParserContext): SupplierInvoiceParseResult;
}

export class LeGrossisteCbdInvoiceParser implements SupplierInvoiceParser {
  name = "LeGrossisteCbdInvoiceParser";

  canParse(text: string) {
    return normalizeText(text).includes("le grossiste cbd") || /\bGRO\d{4,}\b/i.test(text);
  }

  parse(text: string, context: SupplierInvoiceParserContext): SupplierInvoiceParseResult {
    const supplierName = "Le Grossiste CBD";
    const invoiceNumber = extractInvoiceNumber(text);
    const invoiceDate = extractInvoiceDate(text);
    const globalDiscountExVat = extractMoneyAfter(text, /(?:remise|discount)[^\n\r]{0,30}/i);
    const shippingExVat = extractMoneyAfter(text, /(?:livraison|transport|shipping|frais de port)[^\n\r]{0,30}/i);
    const parsedLines = extractPaidLines(text);
    const ignoredFreeLineLabels = extractIgnoredFreeLines(text);
    const issues: SupplierInvoiceParseIssue[] = [];

    if (!invoiceNumber) issues.push({ level: "error", message: "Numero de facture introuvable." });
    if (!invoiceDate) issues.push({ level: "error", message: "Date de facture introuvable." });
    if (!parsedLines.length) issues.push({ level: "error", message: "Aucune ligne produit payante exploitable." });

    const lines = parsedLines.map((line, index) => {
      const match = matchSupplierLine(line.originalLabel, supplierName, context);
      if (match.matchConfidence === "ambiguous") {
        issues.push({
          level: "warning",
          message: `Correspondance ambigue pour ${line.originalLabel}. Selection manuelle requise.`,
        });
      }
      if (match.matchConfidence === "missing") {
        issues.push({
          level: "warning",
          message: `Aucun produit trouve pour ${line.originalLabel}. Selection manuelle requise.`,
        });
      }
      return {
        id: `line-${index + 1}`,
        supplierOriginalLabel: line.originalLabel,
        quantityGrams: line.quantityGrams,
        grossAmountExVat: line.grossAmountExVat,
        vatRate: line.vatRate,
        lineDiscountAmount: line.lineDiscountAmount,
        ...match,
      };
    });

    const purchase: Partial<SupplierPurchase> = {
      supplierName,
      invoiceNumber,
      invoiceDate,
      status: "draft",
      costBase: "HT",
      globalDiscountExVat,
      shippingExVat,
      vatRate: 20,
      paidLinesGrossAmountExVat: roundMoney(
        parsedLines.reduce((sum, line) => sum + line.grossAmountExVat, 0),
      ),
      totalExVat: 0,
      totalIncVat: 0,
      lines,
    };

    const allLinesMatched = lines.every((line) => Boolean(line.productId));
    if (allLinesMatched && parsedLines.length) {
      try {
        const normalized = normalizeSupplierPurchaseInput(purchase) as SupplierPurchase;
        const parsedTotal = extractTotalExVat(text);
        if (parsedTotal != null && Math.abs(normalized.totalExVat - parsedTotal) > 0.02) {
          issues.push({
            level: "error",
            message: `Ecart total HT fournisseur superieur a 0,02 EUR (${normalized.totalExVat} vs ${parsedTotal}).`,
          });
        }
        Object.assign(purchase, normalized, { status: "draft" });
      } catch (error) {
        issues.push({
          level: "warning",
          message: error instanceof Error ? error.message : "Normalisation fournisseur incomplete.",
        });
      }
    }

    return {
      parserName: this.name,
      purchase,
      ignoredFreeLineLabels,
      issues,
      isBlocked: issues.some((issue) => issue.level === "error"),
    };
  }
}

export class GenericSupplierInvoiceParser implements SupplierInvoiceParser {
  name = "GenericSupplierInvoiceParser";

  canParse(text: string) {
    return text.trim().length > 0;
  }

  parse(text: string, context: SupplierInvoiceParserContext): SupplierInvoiceParseResult {
    const supplierName = extractSupplierName(text);
    const parser = new LeGrossisteCbdInvoiceParser();
    const result = parser.parse(text, { ...context });
    return {
      ...result,
      parserName: this.name,
      purchase: {
        ...result.purchase,
        supplierName: supplierName || result.purchase.supplierName || "",
      },
      issues: [
        { level: "warning", message: "Parseur generique prudent : verification manuelle requise." },
        ...result.issues,
      ],
    };
  }
}

export function parseSupplierInvoiceText(
  text: string,
  context: SupplierInvoiceParserContext,
): SupplierInvoiceParseResult {
  const parsers: SupplierInvoiceParser[] = [
    new LeGrossisteCbdInvoiceParser(),
    new GenericSupplierInvoiceParser(),
  ];
  const parser = parsers.find((candidate) => candidate.canParse(text));
  if (!parser) {
    return {
      parserName: "none",
      purchase: { status: "draft", lines: [] },
      ignoredFreeLineLabels: [],
      issues: [{ level: "error" as const, message: "PDF sans texte exploitable." }],
      isBlocked: true,
    };
  }
  return parser.parse(text, context);
}

export function normalizeSupplierLabel(value: string) {
  return normalizeText(value)
    .replace(/\b(cbd|cbg|cbn|thc|trim|fleur|fleurs|resine|resines|hash)\b/g, " ")
    .replace(/\b\d+(?:[,.]\d+)?\s*g\b/g, " ")
    .replace(/\b\d+(?:[,.]\d+)?\s*%\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchSupplierLine(
  originalLabel: string,
  supplierName: string,
  context: SupplierInvoiceParserContext,
): SupplierLineMatch {
  const normalizedSupplierName = normalizeText(supplierName);
  const normalizedOriginalLabel = normalizeSupplierLabel(originalLabel);
  const alias = context.aliases.find(
    (entry) =>
      entry.normalizedSupplierName === normalizedSupplierName &&
      entry.normalizedOriginalLabel === normalizedOriginalLabel,
  );
  if (alias) return productMatch(alias.productId, "alias", "confirmed", context.products);

  const referenceMatch = originalLabel.match(/\bVDZ-\d{6}\b/i);
  if (referenceMatch) {
    const reference = referenceMatch[0].toUpperCase();
    const product = context.products.find((entry) => entry.internalReference === reference);
    if (product) return productMatch(product.id, "internal_reference", "confirmed", context.products);
  }

  const nameMatches = context.products.filter((product) => {
    const productName = normalizeSupplierLabel(product.name);
    return normalizedOriginalLabel === productName || normalizedOriginalLabel.includes(productName);
  });
  if (nameMatches.length === 1) {
    return productMatch(nameMatches[0].id, "normalized_name", "suggested", context.products);
  }
  if (nameMatches.length > 1) return blankMatch("ambiguous");

  const variantMatches = context.products.filter((product) => {
    const slugLabel = normalizeSupplierLabel(product.slug.replace(/-/g, " "));
    return slugLabel && normalizedOriginalLabel.includes(slugLabel);
  });
  if (variantMatches.length === 1) {
    return productMatch(variantMatches[0].id, "slug_variant", "suggested", context.products);
  }
  if (variantMatches.length > 1) return blankMatch("ambiguous");

  return blankMatch("missing");
}

function productMatch(
  productId: string,
  matchSource: NonNullable<SupplierLineMatch["matchSource"]>,
  matchConfidence: NonNullable<SupplierLineMatch["matchConfidence"]>,
  products: Product[],
): SupplierLineMatch {
  const product = products.find((entry) => entry.id === productId);
  return {
    productId,
    productName: product?.name || "",
    productInternalReference: product?.internalReference || "",
    matchSource,
    matchConfidence,
  };
}

function blankMatch(matchConfidence: "ambiguous" | "missing"): SupplierLineMatch {
  return {
    productId: "",
    productName: "",
    productInternalReference: "",
    matchSource: undefined,
    matchConfidence,
  };
}

function extractPaidLines(text: string): ParsedSupplierLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isNonProductLine(line))
    .filter((line) => !isFreeSupplierLine(line))
    .map(parseLine)
    .filter((line): line is ParsedSupplierLine => Boolean(line));
}

function parseLine(line: string): ParsedSupplierLine | null {
  const quantityMatch = line.match(/(\d+(?:[,.]\d+)?)\s*g\b/i);
  if (!quantityMatch) return null;
  const quantityGrams = decimalNumber(quantityMatch[1]);
  const moneyMatches = [...line.matchAll(/(-?\d+(?:[,.]\d{2}))\s*(?:EUR|€)?/gi)]
    .map((match) => decimalNumber(match[1]))
    .filter((value) => value > 0);
  if (!moneyMatches.length) return null;
  const grossAmountExVat = moneyMatches[moneyMatches.length - 1];
  const label = line.slice(0, quantityMatch.index).replace(/^\d+\s+/, "").trim() || line;
  return {
    originalLabel: label,
    quantityGrams,
    grossAmountExVat,
    vatRate: extractVatRate(line) ?? 20,
    lineDiscountAmount: 0,
  };
}

function extractIgnoredFreeLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && isFreeSupplierLine(line));
}

function isFreeSupplierLine(line: string) {
  return /\b(offert|offerte|offerts|gratuit|cadeau|sample|echantillon)\b/i.test(
    normalizeText(line),
  );
}

function isNonProductLine(line: string) {
  return /\b(total|sous total|tva|remise|discount|livraison|transport|shipping|frais de port|iban|bic|adresse|facture|date)\b/i.test(
    normalizeText(line),
  );
}

function extractInvoiceNumber(text: string) {
  return (
    text.match(/\b(GRO\d{4,})\b/i)?.[1]?.toUpperCase() ||
    text.match(/(?:facture|invoice)\s*(?:n[°o.]?|numero|number)?\s*[:#-]?\s*([A-Z0-9-]{4,})/i)?.[1] ||
    ""
  );
}

function extractInvoiceDate(text: string) {
  const match = text.match(/(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})/);
  if (!match) return "";
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function extractSupplierName(text: string) {
  const firstUsefulLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length >= 3 && !/\d/.test(line));
  return firstUsefulLine || "";
}

function extractMoneyAfter(text: string, pattern: RegExp) {
  const line = text.split(/\r?\n/).find((candidate) => pattern.test(candidate));
  if (!line) return 0;
  const money = line.match(/(\d+(?:[,.]\d{2}))/g)?.pop();
  return money ? decimalNumber(money) : 0;
}

function extractTotalExVat(text: string) {
  const line = text.split(/\r?\n/).find((candidate) => /total\s+ht/i.test(candidate));
  const money = line?.match(/(\d+(?:[,.]\d{2}))/g)?.pop();
  return money ? decimalNumber(money) : null;
}

function extractVatRate(line: string) {
  const match = line.match(/(\d+(?:[,.]\d+)?)\s*%/);
  return match ? decimalNumber(match[1]) : null;
}

function decimalNumber(value: string) {
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}
