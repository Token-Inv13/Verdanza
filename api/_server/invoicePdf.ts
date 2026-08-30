import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { BRAND_DOCUMENT_LOGO } from "../../src/lib/brandAssets.js";
import type { BillingSettings, Invoice } from "../../src/types/index.js";

type PdfFont = Awaited<ReturnType<PDFDocument["embedFont"]>>;
type PdfImage = Awaited<ReturnType<PDFDocument["embedPng"]>>;

const pageSize: [number, number] = [595.28, 841.89];
const pageWidth = pageSize[0];
const pageHeight = pageSize[1];
const margin = 40;
const contentRight = pageWidth - margin;
const contentWidth = contentRight - margin;
const sellerX = margin;
const clientX = 320;
const columnWidth = 235;
const table = {
  designationX: margin,
  designationWidth: 265,
  quantityX: 350,
  unitPriceX: 430,
  totalX: 555,
};

export async function renderInvoicePdf(invoice: Invoice, settings: BillingSettings) {
  const pdf = await PDFDocument.create();
  let page = pdf.addPage(pageSize);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const forest = rgb(14 / 255, 55 / 255, 38 / 255);
  const muted = rgb(52 / 255, 51 / 255, 51 / 255);
  const black = rgb(0, 0, 0);
  const lightLine = rgb(0.78, 0.78, 0.78);
  const logo = await loadLogo(pdf);
  let y = pageHeight - margin;

  drawHeader(logo);
  y -= 78;

  const sellerBottom = drawPartyBlock(
    "Verdanza",
    [
      settings.tradeName || "Verdanza",
      settings.displayName || "Token APP",
      settings.isManuallyValidated ? settings.legalName || "" : "",
      settings.isManuallyValidated ? settings.legalForm || "" : "",
      settings.isManuallyValidated ? formatSiren(settings.siren) : "",
      settings.isManuallyValidated ? formatSiret(settings.siret) : "",
      settings.isManuallyValidated ? settings.address || "" : "",
      `Téléphone : ${settings.phone}`,
      `Email : ${settings.email}`,
    ],
    sellerX,
    y,
  );
  const clientBottom = drawPartyBlock(
    "Client",
    [
      invoice.customerName || "Client",
      invoice.customerEmail ? `Email : ${invoice.customerEmail}` : "",
      invoice.customerPhone ? `Téléphone : ${invoice.customerPhone}` : "",
      invoice.customerAddress?.line1 || "",
      invoice.customerAddress?.line2 || "",
      invoice.customerAddress
        ? `${invoice.customerAddress.postalCode} ${invoice.customerAddress.city}`.trim()
        : "",
      invoice.customerAddress?.country || "",
    ],
    clientX,
    y,
  );

  y = Math.min(sellerBottom, clientBottom) - 26;
  ensureSpace(52);
  drawText(`Date : ${formatDate(invoice.issuedAt || invoice.createdAt)}`, margin, y, 10, font, muted);
  if (invoice.orderId) {
    drawWrappedText([`Commande : ${invoice.orderId}`], clientX, y, 10, font, muted, columnWidth);
  }
  y -= 34;

  drawTableHeader();
  for (const line of invoice.lines) {
    drawInvoiceLine(line);
  }

  drawTotalsAndFooter();
  return pdf.save();

  function drawHeader(logoImage: PdfImage | null) {
    if (logoImage) {
      const scale = Math.min(128 / logoImage.width, 58 / logoImage.height);
      const width = logoImage.width * scale;
      const height = logoImage.height * scale;
      page.drawImage(logoImage, {
        x: margin,
        y: pageHeight - margin - height,
        width,
        height,
      });
    } else {
      drawText("Verdanza", margin, pageHeight - margin - 24, 22, bold, forest);
    }
    drawTextRight("FACTURE", contentRight, pageHeight - margin - 6, 22, bold, forest);
    drawTextRight(invoice.invoiceNumber, contentRight, pageHeight - margin - 30, 14, bold, forest);
  }

  function drawPartyBlock(title: string, lines: string[], x: number, startY: number) {
    drawText(title, x, startY, 12, bold, forest);
    return drawWrappedText(lines.filter(Boolean), x, startY - 18, 10, font, muted, columnWidth);
  }

  function drawTableHeader() {
    ensureSpace(48);
    drawText("Désignation", table.designationX, y, 10, bold, forest);
    drawTextRight("Qté", table.quantityX, y, 10, bold, forest);
    drawTextRight("PU", table.unitPriceX, y, 10, bold, forest);
    drawTextRight("Total", table.totalX, y, 10, bold, forest);
    y -= 10;
    page.drawLine({
      start: { x: margin, y },
      end: { x: contentRight, y },
      thickness: 0.7,
      color: forest,
    });
    y -= 18;
  }

  function drawInvoiceLine(line: Invoice["lines"][number]) {
    const label = line.isGift || line.note ? `${line.label} (${line.note || "Offert"})` : line.label;
    const labelLines = wrapText(sanitize(label), font, 10, table.designationWidth);
    const rowHeight = Math.max(18, labelLines.length * 14 + 6);
    ensureTableSpace(rowHeight);
    labelLines.forEach((labelLine, index) => {
      drawText(labelLine, table.designationX, y - index * 14, 10, font, black);
    });
    drawTextRight(String(line.quantity), table.quantityX, y, 10, font, black);
    drawTextRight(formatMoney(line.unitPrice), table.unitPriceX, y, 10, font, black);
    drawTextRight(formatMoney(line.total), table.totalX, y, 10, font, black);
    y -= rowHeight;
    page.drawLine({
      start: { x: margin, y: y + 4 },
      end: { x: contentRight, y: y + 4 },
      thickness: 0.35,
      color: lightLine,
    });
  }

  function drawTotalsAndFooter() {
    const promotionsHeight = (invoice.appliedPromotions?.length || 0) * 12;
    ensureSpace(166 + promotionsHeight);
    y -= 10;
    page.drawLine({ start: { x: 330, y }, end: { x: contentRight, y }, thickness: 0.5, color: muted });
    y -= 18;
    drawTotal("Sous-total", invoice.subtotal);
    if (invoice.discountAmount) drawTotal("Remise", -invoice.discountAmount);
    if (invoice.deliveryFee) drawTotal("Livraison", invoice.deliveryFee);
    if (invoice.appliedPromotions?.length) {
      for (const promotion of invoice.appliedPromotions) {
        drawText(
          `${promotion.label} (${promotion.applicationMode === "automatic" ? "automatique" : "code"})`,
          margin,
          y,
          8,
          font,
          muted,
        );
        y -= 12;
      }
    }
    drawTotal("Total estimé", invoice.total, true);
    y -= 18;

    ensureSpace(64);
    drawText(`Règlement : ${invoice.paymentMethod || "À confirmer"}`, margin, y, 10, font, muted);
    y -= 16;
    drawText(`Statut règlement : ${invoice.paymentStatus}`, margin, y, 10, font, muted);
    y -= 24;

    const legalLines: string[] = [];
    const vatText = vatMention(settings);
    if (vatText) legalLines.push(vatText);
    if (!settings.isManuallyValidated) {
      legalLines.push(
        "Brouillon - informations légales non validées.",
        "Vérifier raison sociale, SIRET, adresse, régime TVA et mentions obligatoires avant émission officielle.",
      );
    }
    legalLines.push(
      "Produits réservés aux adultes. Taux de THC conforme selon analyse producteur.",
      settings.legalMentions || "",
      settings.paymentTerms || "",
    );
    const wrappedLegal = legalLines
      .filter(Boolean)
      .flatMap((line) => wrapText(sanitize(line), font, 8, contentWidth));
    ensureSpace(wrappedLegal.length * 11 + 8);
    for (const line of wrappedLegal) {
      drawText(line, margin, y, 8, legalLines.includes(line) && !settings.isManuallyValidated ? bold : font, muted);
      y -= 11;
    }
  }

  function ensureTableSpace(requiredHeight: number) {
    if (y - requiredHeight >= 96) return;
    addPage();
    drawTableHeader();
  }

  function ensureSpace(requiredHeight: number) {
    if (y - requiredHeight >= 64) return;
    addPage();
  }

  function addPage() {
    page = pdf.addPage(pageSize);
    y = pageHeight - margin;
    drawTextRight(invoice.invoiceNumber, contentRight, y, 9, font, muted);
    y -= 26;
  }

  function drawText(
    text: string,
    x: number,
    yy: number,
    size: number,
    selectedFont: PdfFont,
    color = rgb(0, 0, 0),
  ) {
    page.drawText(sanitize(text), { x, y: yy, size, font: selectedFont, color });
  }

  function drawTextRight(
    text: string,
    rightX: number,
    yy: number,
    size: number,
    selectedFont: PdfFont,
    color = rgb(0, 0, 0),
  ) {
    const clean = sanitize(text);
    page.drawText(clean, {
      x: rightX - selectedFont.widthOfTextAtSize(clean, size),
      y: yy,
      size,
      font: selectedFont,
      color,
    });
  }

  function drawWrappedText(
    lines: string[],
    x: number,
    startY: number,
    size: number,
    selectedFont: PdfFont,
    color: ReturnType<typeof rgb>,
    maxWidth: number,
  ) {
    let currentY = startY;
    for (const rawLine of lines) {
      const paragraphs = String(rawLine).split(/\r?\n/).filter(Boolean);
      for (const paragraph of paragraphs) {
        const wrappedLines = wrapText(sanitize(paragraph), selectedFont, size, maxWidth);
        for (const line of wrappedLines) {
          page.drawText(line, {
            x,
            y: currentY,
            size,
            font: selectedFont,
            color,
          });
          currentY -= size + 4;
        }
      }
    }
    return currentY;
  }

  function drawTotal(label: string, value: number, highlight = false) {
    const size = highlight ? 12 : 10;
    const selectedFont = highlight ? bold : font;
    drawText(label, 385, y, size, selectedFont, forest);
    drawTextRight(formatMoney(value), table.totalX, y, size, selectedFont, forest);
    y -= highlight ? 22 : 16;
  }
}

async function loadLogo(pdf: PDFDocument) {
  try {
    const logoPath = BRAND_DOCUMENT_LOGO.replace(/^\/+/, "").split("/");
    const logoBytes = await readFile(join(process.cwd(), "public", ...logoPath));
    return await pdf.embedPng(logoBytes);
  } catch (error) {
    console.warn("Invoice logo unavailable, using text fallback.", error);
    return null;
  }
}

function vatMention(settings: BillingSettings) {
  if (settings.vatMode === "not_configured") return "TVA : régime non configuré.";
  if (settings.vatMode === "vat_exempt") return settings.vatMention || "TVA non applicable, article 293 B du CGI.";
  if (settings.vatMode === "vat_applicable") return settings.vatNumber ? `TVA intracommunautaire : ${settings.vatNumber}` : "TVA applicable.";
  return settings.vatMention || "Régime TVA spécifique à vérifier.";
}

function formatSiren(value?: string) {
  return value ? `SIREN : ${value}` : "";
}

function formatSiret(value?: string) {
  return value ? `SIRET : ${value}` : "";
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleDateString("fr-FR") : new Date().toLocaleDateString("fr-FR");
}

function formatMoney(value: number) {
  return `${value.toFixed(2).replace(".", ",")} EUR`;
}

function sanitize(value: string) {
  return value
    .replaceAll("€", "EUR")
    .replaceAll("œ", "oe")
    .replaceAll("Œ", "OE")
    .replaceAll("\u00A0", " ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, " ");
}

function wrapText(
  value: string,
  font: PdfFont,
  size: number,
  maxWidth: number,
) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const wordLines = splitLongWord(word, font, size, maxWidth);
    for (const segment of wordLines) {
      const candidate = current ? `${current} ${segment}` : segment;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      current = segment;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function splitLongWord(word: string, font: PdfFont, size: number, maxWidth: number) {
  if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];
  const segments: string[] = [];
  let current = "";
  for (const char of word) {
    const candidate = `${current}${char}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) segments.push(current);
    current = char;
  }
  if (current) segments.push(current);
  return segments;
}
