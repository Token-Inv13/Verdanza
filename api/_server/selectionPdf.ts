import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ProductSelection } from "../../src/types/selection.js";
import { selectionPublicName } from "../../src/types/selection.js";

const W = 314.646;
const H = 436.535;
const green = rgb(14 / 255, 55 / 255, 38 / 255);
const gold = rgb(180 / 255, 137 / 255, 72 / 255);
const cream = rgb(253 / 255, 249 / 255, 244 / 255);
const ink = rgb(52 / 255, 51 / 255, 51 / 255);

function printable(value: string) {
  return value.replace(/[’‘]/g, "'").replace(/[–—]/g, "-").replace(/[^\u0020-\u00ff]/g, " ").trim();
}

function lines(value: string, font: PDFFont, size: number, maxWidth: number) {
  const words = printable(value).split(/\s+/).filter(Boolean);
  const output: string[] = [];
  let current = "";
  for (const word of words) {
    if (font.widthOfTextAtSize(word, size) > maxWidth) return null;
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) output.push(current);
      current = word;
    }
  }
  if (current) output.push(current);
  return output;
}

function drawText(page: PDFPage, value: string, x: number, top: number, width: number,
  size: number, font: PDFFont, color = ink, maxLines = 3, centered = false) {
  let candidate = size;
  let wrapped = lines(value, font, candidate, width);
  while ((!wrapped || wrapped.length > maxLines) && candidate > 6) {
    candidate -= 0.5;
    wrapped = lines(value, font, candidate, width);
  }
  if (!wrapped || wrapped.length > maxLines) throw new Error(`Texte trop long pour le PDF : ${value.slice(0, 55)}`);
  wrapped.forEach((line, index) => {
    const offset = centered ? Math.max(0, (width - font.widthOfTextAtSize(line, candidate)) / 2) : 0;
    page.drawText(line, { x: x + offset, y: H - top - index * (candidate * 1.33), size: candidate, font, color });
  });
}

function base(page: PDFPage, logo: Awaited<ReturnType<PDFDocument["embedPng"]>>, sans: PDFFont, bold: PDFFont) {
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: cream });
  page.drawRectangle({ x: 14, y: 14, width: W - 28, height: H - 28, borderColor: gold, borderWidth: 0.55 });
  const logoWidth = 190;
  page.drawImage(logo, { x: (W - logoWidth) / 2, y: H - 69, width: logoWidth, height: logoWidth * logo.height / logo.width });
  page.drawLine({ start: { x: 28, y: H - 82 }, end: { x: W - 28, y: H - 82 }, color: gold, thickness: 0.55 });
  drawText(page, "V E R D A N Z A . F R", 0, 416, W, 7.5, bold, ink, 1, true);
  void sans;
}

export async function createSelectionPdf(item: ProductSelection, imageBytes: Buffer) {
  const pdf = await PDFDocument.create();
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const logoBytes = await readFile(join(process.cwd(), "public", "brand", "verdanza-v1", "email", "verdanza-logo-horizontal-compact-full-color-512.png"));
  const logo = await pdf.embedPng(logoBytes);
  const photo = await pdf.embedJpg(imageBytes);
  const name = selectionPublicName(item);

  const front = pdf.addPage([W, H]);
  base(front, logo, sans, bold);
  drawText(front, name, 27, 111, W - 54, 20, serif, green, 2, true);
  front.drawRectangle({ x: 27, y: H - 311, width: W - 54, height: 169, color: rgb(1, 1, 1) });
  const ratio = Math.min((W - 54) / photo.width, 169 / photo.height);
  front.drawImage(photo, { x: (W - photo.width * ratio) / 2, y: H - 311 + (169 - photo.height * ratio) / 2,
    width: photo.width * ratio, height: photo.height * ratio });
  front.drawRectangle({ x: 40, y: H - 321, width: W - 80, height: 23, color: cream });
  drawText(front, item.aromas.replace(/,/g, " · "), 44, 306, W - 88, 9, sans, ink, 1, true);
  drawText(front, "A S P E C T", 0, 351, W, 8, bold, ink, 1, true);
  front.drawLine({ start: { x: 59, y: H - 357 }, end: { x: W - 59, y: H - 357 }, color: gold, thickness: 0.55 });
  drawText(front, item.appearance.replace(/,/g, " · "), 36, 376, W - 72, 10, sans, ink, 2, true);

  const back = pdf.addPage([W, H]);
  base(back, logo, sans, bold);
  drawText(back, `F I C H E   P R O D U I T  ·  ${item.category.toUpperCase()}`, 0, 98, W, 7.5, bold, ink, 1, true);
  drawText(back, name, 27, 125, W - 54, 17, serif, green, 2, true);
  back.drawLine({ start: { x: 28, y: H - 144 }, end: { x: W - 28, y: H - 144 }, color: gold, thickness: 0.55 });
  drawText(back, "PROFIL AROMATIQUE", 27, 167, W - 54, 8.5, bold);
  drawText(back, item.taste, 27, 188, W - 54, 10, sans, ink, 3);
  drawText(back, "ARÔMES", 27, 239, W - 54, 8.5, bold);
  drawText(back, item.aromas, 27, 258, W - 54, 10.5, sans, green, 2);
  drawText(back, "I N T E N S I T É", 0, 299, W, 8.5, bold, ink, 1, true);
  back.drawRectangle({ x: 105, y: H - 334, width: 105, height: 25, borderColor: gold, borderWidth: 0.6 });
  drawText(back, item.intensity.toUpperCase(), 106, 325, 103, 8.5, bold, green, 1, true);
  back.drawRectangle({ x: 31, y: H - 396, width: W - 62, height: 51, borderColor: gold, borderWidth: 0.6 });
  drawText(back, "ASPECT", 39, 361, W - 78, 8.5, bold);
  drawText(back, item.appearance, 40, 381, W - 80, 9.5, sans, ink, 2, true);

  pdf.setTitle(`Verdanza - ${name} - Fiche produit`);
  pdf.setAuthor("Verdanza");
  return Buffer.from(await pdf.save());
}
