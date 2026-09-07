import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const packageJson = JSON.parse(await readText("package.json"));
const scripts = packageJson.scripts ?? {};

const coreTests = [
  "test:catalog",
  "test:checkout-payment-options",
  "test:postal-delivery",
  "test:address-delivery",
  "test:fixed-price-formats",
  "test:promotions",
  "test:order-reliability",
  "test:public-rate-limits",
  "test:contests",
  "test:indexnow",
];
const extendedTests = [
  "test:fixed-price-migration",
  "test:supplier-purchases",
  "test:accounting-periods",
  "test:supplier-invoice-import",
  "test:supplier-invoice-pdf",
  "test:customer-invoices",
  "test:product-references",
  "test:product-reference-migration",
  "test:admin-product-images-deletion",
  "test:admin-products-responsive",
  "test:admin-archives",
  "test:admin-analytics",
  "test:firebase-auth-actions",
  "test:payment-link-reliability",
  "test:order-cancellation-consistency",
  "test:api-import",
];
const fullAudits = [
  "audit:blog",
  "audit:seo-landing-pages",
  "audit:performance",
  "audit:images",
  "audit:analytics",
  "audit:analytics-purchase",
  "audit:seo",
  "audit:structured-data",
  "audit:seo-hosts",
];

expectScript(
  "verify",
  "npm run verify:local-safety && npm run lint && npm run typecheck && npm run typecheck:api && npm run test:core && npm run build:local && npm run audit:local-essential",
);
expectScript(
  "verify:full",
  "npm run verify && npm run test:extended && npm run audit:local-full",
);
expectScript("test:core", chain(coreTests));
expectScript("test:extended", chain(extendedTests));
expectScript("audit:local-essential", chain(["audit:prerender", "audit:indexnow"]));
expectScript("audit:local-full", chain(fullAudits));
expectScript(
  "typecheck",
  "tsc --noEmit -p tsconfig.app.json --incremental false && tsc --noEmit -p tsconfig.node.json --incremental false",
);
expectScript(
  "build:local",
  "npm run sitemap:check && tsc -b && vite build && npm run prerender",
);
expectScript("postdeploy:check", "node scripts/postdeployCheck.mjs");

requireValue(
  scripts["typecheck:api"]?.includes("tsc --noEmit"),
  "typecheck API sans émission",
  "typecheck:api doit conserver tsc --noEmit",
);
requireValue(
  scripts["sitemap:check"] ===
    "node --import tsx scripts/generateSitemap.ts --check",
  "sitemap vérifié en lecture seule",
  "sitemap:check doit utiliser le mode --check",
);

const reachable = new Set([
  ...collectReachableScripts("verify"),
  ...collectReachableScripts("verify:full"),
]);
let unsafeReachableCount = 0;
for (const name of reachable) {
  const command = scripts[name] ?? "";
  const forbiddenName =
    /^(seed:|repair:|cleanup:|reconcile:|upsert:)/.test(name) ||
    /^migrate:.*:apply$/.test(name) ||
    name === "indexnow" ||
    name === "indexnow:verify" ||
    name === "audit:runtime";
  if (forbiddenName) {
    unsafeReachableCount += 1;
    fail(`${name} est interdit dans verify`);
  }
  for (const fragment of [
    "firebase deploy",
    "firebase use",
    "vercel ",
    "--production",
    "submitIndexNow",
    "_firebaseAdminScript",
  ]) {
    if (command.includes(fragment)) {
      unsafeReachableCount += 1;
      fail(`${name} contient une action interdite : ${fragment}`);
    }
  }
}
requireValue(
  unsafeReachableCount === 0,
  `${reachable.size} scripts transitifs inspectés sans action interdite`,
  `${unsafeReachableCount} action(s) interdite(s) détectée(s) dans verify`,
);

const [sitemapSource, prerenderSource, pageReadySource, analyticsSource] =
  await Promise.all([
    readText("scripts/generateSitemap.ts"),
    readText("scripts/prerender.ts"),
    readText("scripts/auditPageReady.ts"),
    readText("scripts/auditAnalytics.ts"),
  ]);
requireValue(
  sitemapSource.includes('process.argv.includes("--check")') &&
    sitemapSource.indexOf("readFileSync(sitemapPath") <
      sitemapSource.indexOf("writeFileSync(sitemapPath"),
  "mode sitemap check-only présent avant toute écriture",
  "le contrôle sitemap read-only n'est pas démontré",
);
requireValue(
  prerenderSource.includes("if (!isLocalResourceUrl(url))") &&
    pageReadySource.includes("if (!isLocalResourceUrl(url))") &&
    analyticsSource.includes("if (!isLocalResourceUrl(url))"),
  "prerender et navigateurs d'audit limités au loopback",
  "un navigateur local peut encore poursuivre une requête externe",
);

let unsafeTestCount = 0;
for (const testName of [...coreTests, ...extendedTests]) {
  const match = scripts[testName]?.match(/scripts\/(test[^\s]+\.ts)/);
  if (!match) {
    fail(`${testName} ne pointe pas vers un test TypeScript explicite`);
    continue;
  }
  const source = await readText(`scripts/${match[1]}`);
  const unsafe =
    source.includes("_firebaseAdminScript") ||
    source.includes("getRequiredAdminDb(") ||
    (testName !== "test:indexnow" && source.includes("submitIndexNow("));
  if (unsafe) {
    unsafeTestCount += 1;
    fail(`${testName} contient un accès de production direct`);
  }
}
requireValue(
  unsafeTestCount === 0,
  `${coreTests.length + extendedTests.length} tests locaux sans client de production direct`,
  `${unsafeTestCount} test(s) avec accès de production direct`,
);

requireValue(
  (await readText("scripts/testIndexNow.ts")).includes("127.0.0.1"),
  "test IndexNow raccordé à un serveur loopback",
  "test:indexnow ne démontre pas son isolation loopback",
);
for (const testFile of [
  "scripts/testAdminAnalytics.ts",
  "scripts/testOrderReliability.ts",
  "scripts/testPaymentLinkReliability.ts",
]) {
  const source = await readText(testFile);
  requireValue(
    source.includes("mockFetch") || source.includes("globalThis.fetch ="),
    `${testFile} remplace explicitement les appels fournisseur`,
    `${testFile} ne démontre pas le mock de ses appels fournisseur`,
  );
}

const excluded = [
  "build",
  "postdeploy:check",
  "sitemap",
  "images:generate",
  "analyze:bundle",
  "audit:runtime",
  "indexnow",
  "indexnow:verify",
  ...Object.keys(scripts).filter((name) =>
    /^(seed:|repair:|cleanup:|reconcile:|upsert:|migrate:)/.test(name),
  ),
];
let reachableExcludedCount = 0;
for (const name of excluded) {
  if (reachable.has(name)) {
    reachableExcludedCount += 1;
    fail(`${name} est accessible depuis verify`);
  }
}
requireValue(
  reachableExcludedCount === 0,
  `${excluded.length} commandes à risque restent hors verify`,
  `${reachableExcludedCount} commande(s) à risque accessible(s) depuis verify`,
);

console.log(`Contrôle sécurité locale terminé : ${errors.length} erreur(s).`);
console.log("Aucun secret n'a été lu et aucun service distant n'a été appelé.");
if (errors.length) process.exitCode = 1;

function chain(names) {
  return names.map((name) => `npm run ${name}`).join(" && ");
}

function collectReachableScripts(rootName, seen = new Set()) {
  if (seen.has(rootName)) return seen;
  seen.add(rootName);
  const command = scripts[rootName];
  if (!command) {
    fail(`script npm absent : ${rootName}`);
    return seen;
  }
  for (const match of command.matchAll(/npm run ([\w:-]+)/g)) {
    collectReachableScripts(match[1], seen);
  }
  return seen;
}

function expectScript(name, expected) {
  requireValue(
    scripts[name] === expected,
    `${name} respecte l'ordre local attendu`,
    `${name} ne correspond pas à la chaîne locale attendue`,
  );
}

function requireValue(condition, success, failure) {
  if (condition) console.log(`[OK] ${success}`);
  else fail(failure);
}

function fail(message) {
  errors.push(message);
  console.error(`[ERREUR] ${message}`);
}

async function readText(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}
