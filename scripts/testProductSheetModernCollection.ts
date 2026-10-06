import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { availableProductSheets, plannedProductSheets, productSheets } from "../src/data/productSheets";
import { rankProductSheets } from "../src/lib/productSheetRecommendation";

const root = resolve("docs/product-sheets/production-modern-2026-10-07");
const expectedAvailable = [
  "blue-dream-cbd",
  "cookie-kush-indoor",
  "harlequin-greenhouse",
  "mandarine-cbd",
  "mango-haze-cbd",
  "petites-tetes-og-kush",
  "golden-static",
  "supreme-50-cbd",
];
const expectedPlanned = ["skittle-plus", "black-afghan", "ice-o-lator", "mousseux-skywalker"];

assert.equal(productSheets.length, 12);
assert.deepEqual(availableProductSheets.map((sheet) => sheet.slug), expectedAvailable);
assert.deepEqual(plannedProductSheets.map((sheet) => sheet.slug), expectedPlanned);
assert.equal(availableProductSheets.filter((sheet) => sheet.selectionProfile.category === "flower").length, 6);
assert.equal(availableProductSheets.filter((sheet) => sheet.selectionProfile.category === "resin").length, 2);
assert.equal(plannedProductSheets.filter((sheet) => sheet.selectionProfile.category === "flower").length, 1);
assert.equal(plannedProductSheets.filter((sheet) => sheet.selectionProfile.category === "resin").length, 3);

for (const sheet of productSheets) {
  const family = sheet.selectionProfile.category === "flower" ? "flowers" : "resins";
  const productRoot = join(root, family, sheet.slug);
  const standard = join(productRoot, "print", `verdanza-${sheet.slug}-a6-modern-20261007-standard.pdf`);
  const safe = join(productRoot, "print", `verdanza-${sheet.slug}-a6-modern-20261007-print-safe.pdf`);
  const publicPdf = resolve("public/fiches-produits", sheet.slug, `verdanza-${sheet.slug}-modern-20261007.pdf`);
  const publicPreview = resolve("public/images/fiches-produits", `${sheet.slug}-modern-20261007.webp`);
  const artifacts = [
    standard,
    safe,
    publicPdf,
    publicPreview,
    join(productRoot, "data/product.json"),
    join(productRoot, "masters/front.svg"),
    join(productRoot, "masters/back.svg"),
    join(productRoot, "previews", `verdanza-${sheet.slug}-front.png`),
    join(productRoot, "previews", `verdanza-${sheet.slug}-back.png`),
    join(productRoot, "previews", `verdanza-${sheet.slug}-front.webp`),
    join(productRoot, "report/qa.json"),
    join(productRoot, "report/TRACEABILITY.md"),
  ];
  assert.ok(artifacts.every(existsSync), `${sheet.slug}: incomplete documentary package`);
  assert.equal(sha256(standard), sha256(publicPdf), `${sheet.slug}: public versioned PDF differs from documentary source`);
  assert.equal(sha256(join(productRoot, "previews", `verdanza-${sheet.slug}-front.webp`)), sha256(publicPreview), `${sheet.slug}: public versioned preview differs from documentary source`);
  const data = JSON.parse(readFileSync(join(productRoot, "data/product.json"), "utf8")) as { availability: string; intensity: string; selectionProfile: { intensity: string } };
  const qa = JSON.parse(readFileSync(join(productRoot, "report/qa.json"), "utf8")) as { status: string; geometry: { overflow: number; clipping: number; collision: number }; standard: { poppler: string; pdfium: string }; print_safe: { poppler: string; pdfium: string; fonts: number; type3: number } };
  assert.equal(data.availability, sheet.availability);
  assert.equal(data.intensity, sheet.selectionProfile.intensity);
  assert.equal(data.selectionProfile.intensity, sheet.selectionProfile.intensity);
  assert.ok(data.intensity, `${sheet.slug}: intensity must be explicit`);
  assert.equal(qa.status, "PASS");
  assert.deepEqual([qa.geometry.overflow, qa.geometry.clipping, qa.geometry.collision], [0, 0, 0]);
  assert.deepEqual([qa.standard.poppler, qa.standard.pdfium, qa.print_safe.poppler, qa.print_safe.pdfium], ["PASS", "PASS", "PASS", "PASS"]);
  assert.deepEqual([qa.print_safe.fonts, qa.print_safe.type3], [0, 0]);
}

assert.equal(walkPdfs(root).length, 24, "the modern collection must contain exactly 12 standard and 12 print-safe PDFs");
for (const montage of [
  "CURRENT-FLOWERS-FRONTS.png",
  "CURRENT-FLOWERS-BACKS.png",
  "CURRENT-RESINS-FRONTS.png",
  "CURRENT-RESINS-BACKS.png",
  "PLANNED-FRONTS.png",
  "PLANNED-BACKS.png",
  "ALL-12-FRONTS.png",
  "ALL-12-BACKS.png",
]) {
  assert.ok(existsSync(join(root, "montages", montage)), `${montage} is missing`);
}

for (const planned of plannedProductSheets) {
  const results = rankProductSheets(
    {
      category: planned.selectionProfile.category,
      intensity: planned.selectionProfile.intensity,
      aroma: "any",
    },
    availableProductSheets,
  );
  assert.equal(results.some(({ sheet }) => sheet.slug === planned.slug), false, `${planned.slug}: planned sheet leaked into selector`);
}

const goldenQa = JSON.parse(readFileSync(join(root, "resins/golden-static/report/qa.json"), "utf8")) as { source_guard: { expected: string; forbidden: string; actual_sha256: string; forbidden_sha256: string } };
assert.equal(goldenQa.source_guard.expected, "public/Fiche produit/Golden static/Composition-ezgif.com-resize.webp");
assert.equal(goldenQa.source_guard.forbidden, "public/Fiche produit/Golden static/goldenstatic.webp");
assert.notEqual(goldenQa.source_guard.actual_sha256, goldenQa.source_guard.forbidden_sha256);
assert.ok(existsSync(join(root, "GOLDEN-STATIC-ASSET-PROOF.md")));

console.log("Modern product-sheet collection tests passed: 8 available + 4 planned, 24 PDFs, complete packages, selector isolation, QA, public hashes and Golden proof.");

function walkPdfs(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkPdfs(path);
    return path.endsWith(".pdf") ? [path] : [];
  });
}

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
