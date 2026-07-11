import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_HOST,
  INDEXNOW_KEY,
  INDEXNOW_KEY_LOCATION,
  INDEXNOW_SITE_URL,
} from "./indexNowConfig";
import {
  buildIndexNowBatch,
  currentIndexableRoutePaths,
  currentIndexableUrls,
  maskIndexNowKey,
  parseIndexNowArgs,
} from "./indexNowCore";

const publicDir = resolve("public");
const distDir = resolve("dist");
const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};
const failures: string[] = [];

auditConfig();
auditKeyFiles();
auditRoutes();
auditPackageScripts();
auditDryRunCodePath();

if (failures.length) {
  console.error("\nIndexNow audit failures:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(
    `IndexNow audit passed for ${INDEXNOW_HOST} with key ${maskIndexNowKey()} and ${currentIndexableUrls().length} URL(s).`,
  );
}

function auditConfig() {
  const configPath = resolve("scripts", "indexNowConfig.ts");
  if (!existsSync(configPath)) failures.push("missing scripts/indexNowConfig.ts");
  if (INDEXNOW_HOST !== "verdanza.fr") failures.push("INDEXNOW_HOST must be verdanza.fr");
  if (INDEXNOW_SITE_URL !== "https://verdanza.fr") {
    failures.push("INDEXNOW_SITE_URL must be https://verdanza.fr");
  }
  if (INDEXNOW_ENDPOINT !== "https://api.indexnow.org/indexnow") {
    failures.push("INDEXNOW_ENDPOINT must be the official IndexNow endpoint");
  }
  if (!/^[A-Za-z0-9-]{8,128}$/.test(INDEXNOW_KEY)) {
    failures.push("INDEXNOW_KEY format is invalid");
  }
  if (!/^[a-f0-9]{64}$/.test(INDEXNOW_KEY)) {
    failures.push("INDEXNOW_KEY should be a 64-character hexadecimal key");
  }
  if (/example|sample|changeme|test/i.test(INDEXNOW_KEY)) {
    failures.push("INDEXNOW_KEY appears to be an example value");
  }
  if (INDEXNOW_KEY_LOCATION !== `https://verdanza.fr/${INDEXNOW_KEY}.txt`) {
    failures.push("INDEXNOW_KEY_LOCATION does not match the configured key");
  }
}

function auditKeyFiles() {
  const keyFile = `${INDEXNOW_KEY}.txt`;
  const publicKeyPath = join(publicDir, keyFile);
  const distKeyPath = join(distDir, keyFile);

  const matchingPublicKeys = listKnownKeyFiles(publicDir);
  if (matchingPublicKeys.length !== 1) {
    failures.push(`expected exactly one public IndexNow key file, found ${matchingPublicKeys.length}`);
  }
  if (!existsSync(publicKeyPath)) failures.push(`missing public/${keyFile}`);
  else if (readFileSync(publicKeyPath, "utf8").trim() !== INDEXNOW_KEY) {
    failures.push(`public/${keyFile} content does not match INDEXNOW_KEY`);
  }

  if (existsSync(distDir)) {
    if (!existsSync(distKeyPath)) failures.push(`missing dist/${keyFile}; run npm run build`);
    else if (readFileSync(distKeyPath, "utf8").trim() !== INDEXNOW_KEY) {
      failures.push(`dist/${keyFile} content does not match INDEXNOW_KEY`);
    }
  }
}

function auditRoutes() {
  const urls = currentIndexableUrls();
  const paths = currentIndexableRoutePaths();
  if (urls.length !== paths.length) {
    failures.push(`indexable URL count (${urls.length}) does not match route path count (${paths.length})`);
  }
  if (new Set(urls).size !== urls.length) failures.push("IndexNow URL list contains duplicates");
  if (new Set(paths).size !== paths.length) failures.push("IndexNow route path list contains duplicates");
  const batch = buildIndexNowBatch(parseIndexNowArgs(["--all-indexable", "--dry-run"]));
  if (batch.urls.length !== urls.length) failures.push("--all-indexable batch does not match sitemapUrls()");
  for (const requiredPath of [
    "/blog",
    "/blog/fleur-cbd-ou-resine-cbd-differences",
    "/blog/indoor-greenhouse-hydroponique-differences",
  ]) {
    if (!paths.includes(requiredPath)) failures.push(`missing blog route in IndexNow list: ${requiredPath}`);
    if (!urls.includes(`https://verdanza.fr${requiredPath}`)) {
      failures.push(`missing blog URL in IndexNow list: https://verdanza.fr${requiredPath}`);
    }
  }
  const privateMarkers = ["/admin", "/compte", "/panier", "/checkout", "/connexion", "/inscription"];
  for (const url of urls) {
    if (!url.startsWith("https://verdanza.fr/")) failures.push(`unexpected non-canonical URL: ${url}`);
    if (privateMarkers.some((marker) => new URL(url).pathname.startsWith(marker))) {
      failures.push(`private URL included in IndexNow list: ${url}`);
    }
  }
}

function auditPackageScripts() {
  const scripts = packageJson.scripts || {};
  for (const scriptName of ["build", "prerender", "sitemap"]) {
    const script = scripts[scriptName] || "";
    if (/indexnow/i.test(script)) failures.push(`${scriptName} must not call IndexNow automatically`);
  }
  for (const required of ["indexnow", "indexnow:verify", "audit:indexnow"]) {
    if (!scripts[required]) failures.push(`missing npm script: ${required}`);
  }
}

function auditDryRunCodePath() {
  const submitScript = readFileSync(resolve("scripts", "submitIndexNow.ts"), "utf8");
  if (!submitScript.includes("args.dryRun")) failures.push("submitIndexNow.ts does not handle dry-run");
  if (!submitScript.includes("submitIndexNow(batch")) failures.push("submitIndexNow.ts does not call submit function");
}

function listKnownKeyFiles(dir: string) {
  if (!existsSync(dir)) return [];
  return readDirectoryFiles(dir).filter((file) => /^[A-Za-z0-9-]{8,128}\.txt$/.test(file));
}

function readDirectoryFiles(dir: string) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry: { isFile: () => boolean }) => entry.isFile())
    .map((entry: { name: string }) => entry.name) as string[];
}
