import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { chromium } from "playwright";

type RecipeEvidence = {
  [key: string]: unknown;
  continuousWallet: Array<{ label: string; wallet: unknown }>;
  continuousJournal: Array<{ label: string; movementCount: number; movements: unknown[] }>;
  orderB: Record<string, unknown>;
  screenshots: string[];
};

const artifactRoot = resolve("node_modules/.cache/verdanza-cagnotte-recette-v1");
const evidencePath = resolve(artifactRoot, "recette-values.json");
const evidenceSource = await readFile(evidencePath, "utf8");
const evidence = JSON.parse(evidenceSource) as RecipeEvidence;
const pageDefinitions = [
  { name: "01-commande-b-proposition", kind: "proposal" },
  { name: "02-remboursement-final", kind: "final" },
] as const;
const pages = await Promise.all(pageDefinitions.map(async (definition) => ({
  ...definition,
  htmlPath: resolve(artifactRoot, `${definition.name}.html`),
  html: await readFile(resolve(artifactRoot, `${definition.name}.html`), "utf8"),
})));
const viewports = [
  { label: "desktop", width: 1440, height: 1100 },
  { label: "mobile", width: 390, height: 844 },
] as const;
const expectedLabels = [
  "A — commande créée",
  "A — paiement confirmé",
  "A — livraison confirmée",
  "A — rejeu paiement/livraison",
  "B — cagnotte réservée",
  "B — paiement confirmé",
  "B — livraison confirmée",
  "B — remboursement intégral enregistré",
  "B — rejeu du remboursement",
];
const expectedMovementCounts = [0, 1, 3, 3, 4, 6, 8, 10, 10];
const expectedScreenshots = pages.flatMap((source) => viewports.map((viewport) => (
  resolve(artifactRoot, `${source.name}-${viewport.label}.png`)
)));
const violations: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) violations.push(message);
};
const checkDeep = (actual: unknown, expected: unknown, message: string) => {
  if (!isDeepStrictEqual(actual, expected)) {
    violations.push(`${message} — reçu ${JSON.stringify(actual)}, attendu ${JSON.stringify(expected)}`);
  }
};

assert.ok(Array.isArray(evidence.continuousWallet), "la preuve JSON doit contenir continuousWallet");
assert.ok(Array.isArray(evidence.continuousJournal), "la preuve JSON doit contenir continuousJournal");
assert.ok(Array.isArray(evidence.screenshots), "la preuve JSON doit contenir screenshots");
checkDeep(evidence.continuousWallet.map(({ label }) => label), expectedLabels, "ordre des étapes wallet incorrect");
checkDeep(evidence.continuousJournal.map(({ label }) => label), expectedLabels, "ordre des étapes journal incorrect");
checkDeep(
  evidence.continuousJournal.map(({ movementCount }) => movementCount),
  expectedMovementCounts,
  "progression du nombre de mouvements incorrecte",
);
checkDeep(evidence.continuousWallet[3]?.wallet, evidence.continuousWallet[2]?.wallet, "le rejeu A doit conserver le wallet livré");
checkDeep(
  evidence.continuousJournal[3]?.movements,
  evidence.continuousJournal[2]?.movements,
  "le rejeu A doit conserver le journal livré",
);
checkDeep(evidence.screenshots, expectedScreenshots, "la liste JSON doit référencer exactement les quatre captures de cette recette");
checkDeep([
  evidence.orderB.productsCents,
  evidence.orderB.usedCagnotteCents,
  evidence.orderB.externalPaymentCents,
  evidence.orderB.earnedCents,
  evidence.orderB.refundFinancialCents,
  evidence.orderB.restoredCagnotteCents,
  evidence.orderB.cancelledGainCents,
], [10_000, 500, 9_500, 475, 9_500, 500, 475], "montants de la commande B incohérents");

const browser = await chromium.launch({ headless: true });
const screenshots: string[] = [];
const computedStyles: Array<Record<string, unknown>> = [];
const networkChecks: Array<Record<string, unknown>> = [];

try {
  for (const source of pages) {
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      let networkRequests = 0;
      const requestedUrls: string[] = [];
      await context.route("**/*", (route) => {
        networkRequests += 1;
        requestedUrls.push(route.request().url());
        return route.abort();
      });
      const page = await context.newPage();
      await page.setContent(source.html, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(50);
      const observed = await page.evaluate(() => {
        const headingNote = document.querySelector<HTMLElement>(".recipe-heading span");
        const walletPanel = document.querySelector<HTMLElement>(".cagnotte-panel");
        if (!headingNote || !walletPanel) throw new Error("structure UI de recette incomplète");
        const headingStyle = getComputedStyle(headingNote);
        const walletStyle = getComputedStyle(walletPanel);
        const checkoutPanel = document.querySelector<HTMLElement>(".cagnotte-use-panel");
        const checkoutStyle = checkoutPanel ? getComputedStyle(checkoutPanel) : null;
        return {
          bodyText: document.body.innerText.replace(/[\u00a0\u202f]/g, " "),
          heading: {
            color: headingStyle.color,
            lineHeight: headingStyle.lineHeight,
            maxWidth: headingStyle.maxWidth,
          },
          walletPanel: {
            backgroundColor: walletStyle.backgroundColor,
            borderRadius: walletStyle.borderRadius,
            borderTopWidth: walletStyle.borderTopWidth,
            boxShadow: walletStyle.boxShadow,
            paddingTop: walletStyle.paddingTop,
            width: walletPanel.getBoundingClientRect().width,
          },
          checkoutPanel: checkoutStyle ? {
            backgroundColor: checkoutStyle.backgroundColor,
            borderRadius: checkoutStyle.borderRadius,
            borderTopWidth: checkoutStyle.borderTopWidth,
            display: checkoutStyle.display,
          } : null,
          panelInsideHeadingNote: headingNote.contains(walletPanel),
          finalCreationSummaryCount: document.querySelectorAll(".cagnotte-use-success").length,
          externalResourceReferences: Array.from(document.querySelectorAll<HTMLElement>("[src], [href]"))
            .map((element) => element.getAttribute("src") ?? element.getAttribute("href") ?? "")
            .filter((value) => /^https?:\/\//i.test(value)),
        };
      });

      check(networkRequests === 0, `${source.name}/${viewport.label} a tenté ${networkRequests} requête(s) réseau`);
      checkDeep(observed.externalResourceReferences, [], `${source.name}/${viewport.label} référence une ressource externe`);
      check(observed.panelInsideHeadingNote === false, `${source.name}/${viewport.label} place le panneau dans la note d’en-tête`);
      checkDeep(observed.heading.color, "rgb(56, 68, 61)", `${source.name}/${viewport.label} n’applique pas la couleur de la note`);
      checkDeep(observed.heading.lineHeight, "24px", `${source.name}/${viewport.label} n’applique pas l’interligne de la note`);
      check(Number.parseFloat(observed.heading.maxWidth) > 0, `${source.name}/${viewport.label} n’applique pas la largeur maximale de la note`);
      checkDeep(observed.walletPanel.backgroundColor, "rgb(255, 253, 248)", `${source.name}/${viewport.label} n’applique pas le fond du panneau wallet`);
      checkDeep(observed.walletPanel.borderRadius, "14px", `${source.name}/${viewport.label} n’applique pas le rayon du panneau wallet`);
      checkDeep(observed.walletPanel.borderTopWidth, "1px", `${source.name}/${viewport.label} n’applique pas la bordure du panneau wallet`);
      check(observed.walletPanel.boxShadow !== "none", `${source.name}/${viewport.label} n’applique pas l’ombre du panneau wallet`);
      check(Number.parseFloat(observed.walletPanel.paddingTop) >= 16, `${source.name}/${viewport.label} n’applique pas le padding du panneau wallet`);
      check(observed.walletPanel.width > 0, `${source.name}/${viewport.label} ne rend pas le panneau wallet`);

      if (source.kind === "proposal") {
        check(observed.checkoutPanel?.display === "grid", `${source.name}/${viewport.label} ne rend pas le panneau checkout en grille`);
        checkDeep(observed.checkoutPanel?.backgroundColor, "rgb(255, 253, 248)", `${source.name}/${viewport.label} n’applique pas le fond checkout`);
        check(observed.bodyText.includes("Financé par votre cagnotte\n5,00 €"), `${source.name}/${viewport.label} n’affiche pas les 5,00 € proposés`);
        check(observed.bodyText.includes("À régler hors cagnotte\n95,00 €"), `${source.name}/${viewport.label} n’affiche pas les 95,00 € externes`);
        check(observed.bodyText.includes("Gain estimé après paiement et livraison : 4,75 €."), `${source.name}/${viewport.label} n’affiche pas le gain estimé de 4,75 €`);
      } else {
        check(observed.finalCreationSummaryCount === 0, `${source.name}/${viewport.label} conserve un récapitulatif de création obsolète`);
        check(!observed.bodyText.includes("Cagnotte réservée pour cette commande"), `${source.name}/${viewport.label} présente encore une réservation B actuelle`);
        check(!observed.bodyText.includes("Paiement encore attendu"), `${source.name}/${viewport.label} présente encore un paiement B à attendre`);
        check(observed.bodyText.includes("Disponible\n5,00 €"), `${source.name}/${viewport.label} n’affiche pas le solde final disponible de 5,00 €`);
        check(observed.bodyText.includes("Déclaration synthétique d’un remboursement externe déjà confirmé : 95,00 € hors cagnotte, 5,00 € restitués et 4,75 € de gain annulé."), `${source.name}/${viewport.label} n’explique pas les montants du remboursement synthétique`);
        check(observed.bodyText.includes("Cagnotte restituée après retour"), `${source.name}/${viewport.label} masque la restitution historique légitime`);
        check(observed.bodyText.includes("Cagnotte réservée"), `${source.name}/${viewport.label} masque la réservation historique légitime`);
      }

      const screenshot = resolve(artifactRoot, `${source.name}-${viewport.label}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      screenshots.push(screenshot);
      computedStyles.push({ page: source.name, viewport: viewport.label, ...observed, bodyText: undefined });
      networkChecks.push({ page: source.name, viewport: viewport.label, networkRequests, requestedUrls });
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`Contre-preuve CSS Chromium : ${JSON.stringify(computedStyles)}`);
if (violations.length > 0) {
  console.error(`Défauts d’artefacts reproduits :\n- ${violations.join("\n- ")}`);
}
assert.deepEqual(violations, [], "les artefacts doivent refléter exactement les états vérifiés");
assert.deepEqual(screenshots, expectedScreenshots, "les quatre captures attendues doivent être régénérées");

const sha256 = (contents: string | Buffer) => createHash("sha256").update(contents).digest("hex");
const htmlSha256 = Object.fromEntries(pages.map((source) => [source.htmlPath, sha256(source.html)]));
const screenshotSha256 = Object.fromEntries(await Promise.all(screenshots.map(async (screenshot) => (
  [screenshot, sha256(await readFile(screenshot))] as const
))));
const recipeEvidenceSha256 = sha256(evidenceSource);
const executionFingerprint = sha256(JSON.stringify({ recipeEvidenceSha256, htmlSha256, screenshotSha256 }));
await writeFile(evidencePath, `${JSON.stringify({
  ...evidence,
  artifactVerification: {
    executionFingerprint,
    recipeEvidenceSha256,
    htmlSha256,
    screenshotSha256,
    computedStyles,
    networkChecks,
  },
}, null, 2)}\n`, "utf8");

console.log(`Captures UI locales contrôlées sans réseau : ${screenshots.join(", ")}`);
console.log(`Empreinte liée HTML/JSON/captures : ${executionFingerprint}`);
