import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { build, type Rollup } from "vite";
import type { BrowserContext } from "playwright";
import { isLocalResourceUrl } from "./auditPageReady.js";
import type { PublicAuditCatalogMode } from "./fixtures/publicAuditCatalog.js";

const fixturePath = fileURLToPath(new URL("./fixtures/publicAuditCatalog.ts", import.meta.url));
const sdkFixturePath = fileURLToPath(new URL("./fixtures/publicAuditFirestore.ts", import.meta.url));
const bundles = new Map<string, Promise<string>>();

async function fixtureBundle(sourceRoot: string) {
  const servicePath = resolve(sourceRoot, "src/services/productsService.ts");
  const result = await build({
    root: sourceRoot,
    configFile: false, envFile: false, publicDir: false, logLevel: "error",
    esbuild: { jsx: "automatic" },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      "import.meta.env": JSON.stringify({ PROD: true }),
    },
    plugins: [{
      name: "public-audit-local-catalog", enforce: "pre",
      resolveId(source, importer) {
        if (source === "firebase/firestore") {
          return importer?.replaceAll("\\", "/") === sdkFixturePath.replaceAll("\\", "/") ? undefined : sdkFixturePath;
        }
        if (!/\/productsService(?:\.[jt]s)?$/.test(source)) return;
        // The fixture invokes the real catalogue loader with its supported DI argument.
        return importer?.replaceAll("\\", "/") === fixturePath.replaceAll("\\", "/")
          ? servicePath : fixturePath;
      },
    }],
    build: {
      write: false, minify: false,
      lib: { entry: resolve(sourceRoot, "src/main.tsx"), name: "PublicAuditRuntime", formats: ["iife"] },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
  const output = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput;
  const script = output.output.find((entry) => entry.type === "chunk");
  assert.ok(script?.type === "chunk", "Local public runtime bundle missing");
  const css = output.output.filter((entry) => entry.type === "asset" && entry.fileName.endsWith(".css"))
    .map((entry) => entry.type === "asset" ? String(entry.source) : "").join("\n");
  return `(() => { const style = document.createElement("style"); style.textContent = ${JSON.stringify(css)}; document.head.append(style); })();\n${script.code}`;
}

/** In-memory fixture of the real App; never alters the deployable build or fallback. */
export async function installPublicAuditCatalog(
  context: BrowserContext, mode: PublicAuditCatalogMode = "authoritative", sourceRoot = process.cwd(),
) {
  const html = await readFile(resolve(sourceRoot, "dist/index.html"), "utf8");
  const scriptPath = html.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/)?.[1];
  assert.ok(scriptPath?.startsWith("/assets/"), "Built App module missing");
  if (!bundles.has(sourceRoot)) bundles.set(sourceRoot, fixtureBundle(sourceRoot));
  const code = await bundles.get(sourceRoot)!;
  await context.addInitScript((catalogMode) => {
    window.__VERDANZA_AUDIT_CATALOG_MODE__ = catalogMode;
  }, mode);
  await context.route(`**${scriptPath}`, async (route) => {
    assert.ok(isLocalResourceUrl(route.request().url()), "Audit fixture requires a loopback server");
    await route.fulfill({ status: 200, contentType: "application/javascript", body: code });
  });
}
