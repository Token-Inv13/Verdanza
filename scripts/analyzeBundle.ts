import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";

type AssetInfo = {
  file: string;
  rawBytes: number;
  gzipBytes?: number;
  brotliBytes?: number;
};

const distDir = resolve("dist");
const reportPath = resolve("reports/performance/bundle-latest.json");

if (!existsSync(distDir)) {
  throw new Error("dist is missing. Run npm run build before npm run analyze:bundle.");
}

const files = walk(distDir);
const jsFiles = files.filter((file) => file.endsWith(".js")).map(sizeInfo).sort(byRawDesc);
const cssFiles = files.filter((file) => file.endsWith(".css")).map(sizeInfo).sort(byRawDesc);
const images = files
  .filter((file) => /\.(png|jpe?g|webp|svg)$/i.test(file))
  .map((file) => ({
    file: normalize(file),
    rawBytes: statSync(file).size,
  }))
  .sort(byRawDesc)
  .slice(0, 30);
const htmlFiles = files.filter((file) => file.endsWith(".html"));
const htmlChunkMap = Object.fromEntries(
  htmlFiles.map((file) => [normalize(file), referencedAssets(readFileSync(file, "utf8"))]),
);
const publicInitialChunks = referencedAssets(readFileSync(join(distDir, "index.html"), "utf8"));
const publicChunkText = publicInitialChunks
  .filter((asset) => asset.endsWith(".js"))
  .map((asset) => readAssetText(asset))
  .join("\n");
const allJsText = jsFiles.map((asset) => readFileSync(resolve(asset.file), "utf8")).join("\n");

const report = {
  generatedAt: new Date().toISOString(),
  jsFiles,
  cssFiles,
  images,
  largestFiles: [...jsFiles, ...cssFiles, ...images].sort(byRawDesc).slice(0, 20),
  publicInitialChunks,
  htmlChunkMap,
  exclusiveChunks: classifyChunks(jsFiles),
  markers: {
    publicInitialContainsFirebaseAdmin: publicChunkText.includes("firebase-admin"),
    publicInitialContainsPdfLib: publicChunkText.includes("pdf-lib"),
    anyClientAssetContainsFirebaseAdmin: allJsText.includes("firebase-admin"),
    anyClientAssetContainsPdfLib: allJsText.includes("pdf-lib"),
    publicInitialContainsFirestore: /firestore|Firestore/.test(publicChunkText),
    publicInitialContainsAuth: /firebase\/auth|AuthError|onAuthStateChanged/.test(publicChunkText),
  },
};

mkdirSync(resolve("reports/performance"), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Bundle report written to ${relative(process.cwd(), reportPath)}`);
console.log("JavaScript files");
console.table(jsFiles.map(displaySize));
console.log("CSS files");
console.table(cssFiles.map(displaySize));
console.log("Largest images");
console.table(images.slice(0, 15).map((asset) => ({ file: asset.file, rawKB: kb(asset.rawBytes) })));
console.log("Public initial chunks");
console.table(publicInitialChunks.map((asset) => ({ asset })));
console.log("Exclusive chunk groups");
console.table(report.exclusiveChunks);
console.log("Markers");
console.table(report.markers);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function sizeInfo(file: string): AssetInfo {
  const data = readFileSync(file);
  return {
    file: normalize(file),
    rawBytes: data.length,
    gzipBytes: gzipSync(data).length,
    brotliBytes: brotliCompressSync(data).length,
  };
}

function referencedAssets(html: string) {
  return [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
    .map((match) => match[1])
    .filter((asset, index, all) => all.indexOf(asset) === index);
}

function readAssetText(asset: string) {
  const normalized = asset.replace(/^\//, "");
  const file = join(distDir, normalized);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function classifyChunks(js: AssetInfo[]) {
  return js.map((asset) => {
    const text = readFileSync(resolve(asset.file), "utf8");
    const lower = asset.file.toLowerCase();
    const isPublicInitial = publicInitialChunks.some((chunk) =>
      asset.file.endsWith(chunk.replace(/^\//, "")),
    );
    const group = isPublicInitial
      ? "public-initial"
      : /admin|factur|coupon|stock/.test(lower) || /Admin|adminUsers|invoice/.test(text)
        ? "admin"
        : /account|compte|favoris|profile|orders/.test(lower) ||
            /Account|customerProfile/.test(text)
          ? "account"
          : /checkout|payment|order/.test(lower) || /lastOrderSummary|quote-order/.test(text)
            ? "checkout"
            : lower.includes("vendor-")
              ? "vendor"
              : "public-or-shared";
    return {
      file: asset.file,
      rawKB: kb(asset.rawBytes),
      gzipKB: kb(asset.gzipBytes || 0),
      group,
    };
  });
}

function displaySize(asset: AssetInfo) {
  return {
    file: asset.file,
    rawKB: kb(asset.rawBytes),
    gzipKB: kb(asset.gzipBytes || 0),
    brotliKB: kb(asset.brotliBytes || 0),
  };
}

function normalize(file: string) {
  return relative(process.cwd(), file).replace(/\\/g, "/");
}

function byRawDesc(left: AssetInfo, right: AssetInfo) {
  return right.rawBytes - left.rawBytes;
}

function kb(bytes: number) {
  return Math.round(bytes / 1024);
}
