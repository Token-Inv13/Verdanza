import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { BillingSettings, Invoice } from "../../src/types/index.js";

export async function renderInvoicePdf(invoice: Invoice, settings: BillingSettings) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const forest = rgb(0.02, 0.25, 0.19);
  const muted = rgb(0.36, 0.36, 0.36);
  let y = 792;

  drawText("FACTURE", 40, y, 22, bold, forest);
  drawText(invoice.invoiceNumber, 410, y, 14, bold, forest);
  y -= 36;

  drawText(settings.tradeName || "Verdanza", 40, y, 16, bold, forest);
  y -= 18;
  drawText(settings.displayName || "Token APP", 40, y, 10, font, muted);
  y -= 14;
  drawMultiline([
    settings.isManuallyValidated ? settings.legalName || "" : "",
    settings.isManuallyValidated ? settings.legalForm || "" : "",
    settings.isManuallyValidated ? formatSiren(settings.siren) : "",
    settings.isManuallyValidated ? formatSiret(settings.siret) : "",
    settings.isManuallyValidated ? settings.address || "" : "",
    `Téléphone : ${settings.phone}`,
    `Email : ${settings.email}`,
  ].filter(Boolean), 40, y, 10, font, muted);

  drawText("Client", 330, y + 32, 12, bold, forest);
  drawMultiline([
    invoice.customerName || "Client",
    invoice.customerEmail ? `Email : ${invoice.customerEmail}` : "",
    invoice.customerPhone ? `Téléphone : ${invoice.customerPhone}` : "",
    invoice.customerAddress?.line1 || "",
    invoice.customerAddress?.line2 || "",
    invoice.customerAddress
      ? `${invoice.customerAddress.postalCode} ${invoice.customerAddress.city}`.trim()
      : "",
    invoice.customerAddress?.country || "",
  ].filter(Boolean), 330, y + 14, 10, font, muted);

  y = 610;
  drawText(`Date : ${formatDate(invoice.issuedAt || invoice.createdAt)}`, 40, y, 10, font, muted);
  if (invoice.orderId) {
    drawText(`Commande : ${invoice.orderId}`, 260, y, 10, font, muted);
  }
  y -= 34;

  drawText("Designation", 40, y, 10, bold, forest);
  drawText("Qte", 330, y, 10, bold, forest);
  drawText("PU", 385, y, 10, bold, forest);
  drawText("Total", 480, y, 10, bold, forest);
  y -= 10;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.7, color: forest });
  y -= 20;

  for (const line of invoice.lines) {
    drawText(line.label, 40, y, 10, font, rgb(0, 0, 0));
    drawText(String(line.quantity), 330, y, 10, font, rgb(0, 0, 0));
    drawText(formatMoney(line.unitPrice), 385, y, 10, font, rgb(0, 0, 0));
    drawText(formatMoney(line.total), 480, y, 10, font, rgb(0, 0, 0));
    y -= 18;
  }

  y -= 8;
  page.drawLine({ start: { x: 330, y }, end: { x: 555, y }, thickness: 0.5, color: muted });
  y -= 18;
  drawTotal("Sous-total", invoice.subtotal);
  if (invoice.deliveryFee) drawTotal("Livraison", invoice.deliveryFee);
  if (invoice.discountAmount) drawTotal("Remise", -invoice.discountAmount);
  drawTotal("Total estime", invoice.total, true);
  y -= 20;

  drawText(`Règlement : ${invoice.paymentMethod || "À confirmer"}`, 40, y, 10, font, muted);
  y -= 16;
  drawText(`Statut règlement : ${invoice.paymentStatus}`, 40, y, 10, font, muted);
  y -= 24;

  const vatText = vatMention(settings);
  if (vatText) {
    drawText(vatText, 40, y, 9, font, muted);
    y -= 14;
  }
  if (!settings.isManuallyValidated) {
    drawMultiline([
      "Brouillon - informations légales non validées.",
      "Verifier raison sociale, SIRET, adresse, regime TVA et mentions obligatoires avant emission officielle.",
    ], 40, y, 9, bold, rgb(0.58, 0.28, 0.05));
    y -= 32;
  }
  drawMultiline([
    "Produits réservés aux adultes. Taux de THC conforme selon analyse producteur.",
    settings.legalMentions || "",
    settings.paymentTerms || "",
  ].filter(Boolean), 40, Math.max(y, 70), 8, font, muted);

  return pdf.save();

  function drawText(
    text: string,
    x: number,
    yy: number,
    size: number,
    selectedFont: typeof font,
    color = rgb(0, 0, 0),
  ) {
    page.drawText(sanitize(text), { x, y: yy, size, font: selectedFont, color });
  }

  function drawMultiline(
    lines: string[],
    x: number,
    startY: number,
    size: number,
    selectedFont: typeof font,
    color = rgb(0, 0, 0),
  ) {
    let offset = 0;
    const maxWidth = x > 300 ? 210 : 500;
    lines.flatMap((line) => wrapText(sanitize(line), selectedFont, size, maxWidth)).forEach((line) => {
      page.drawText(line, {
        x,
        y: startY - offset * (size + 4),
        size,
        font: selectedFont,
        color,
      });
      offset += 1;
    });
  }

  function drawTotal(label: string, value: number, highlight = false) {
    drawText(label, 385, y, highlight ? 12 : 10, highlight ? bold : font, forest);
    drawText(formatMoney(value), 480, y, highlight ? 12 : 10, highlight ? bold : font, forest);
    y -= highlight ? 22 : 16;
  }
}

function vatMention(settings: BillingSettings) {
  if (settings.vatMode === "not_configured") return "TVA : regime non configure.";
  if (settings.vatMode === "vat_exempt") return settings.vatMention || "TVA non applicable, article 293 B du CGI.";
  if (settings.vatMode === "vat_applicable") return settings.vatNumber ? `TVA intracommunautaire : ${settings.vatNumber}` : "TVA applicable.";
  return settings.vatMention || "Regime TVA specifique a verifier.";
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
    .replaceAll("’", "'")
    .replaceAll("‘", "'")
    .replaceAll("“", "\"")
    .replaceAll("”", "\"")
    .replaceAll("–", "-")
    .replaceAll("—", "-")
    .replaceAll("…", "...")
    .replaceAll("\u00A0", " ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, " ");
}

function wrapText(
  value: string,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  size: number,
  maxWidth: number,
) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}
