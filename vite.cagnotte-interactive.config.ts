import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const root = fileURLToPath(new URL("./", import.meta.url));
const localClientRoot = resolve(root, "scripts/cagnotte-interactive/client");
const emptyEnvDir = resolve(root, "node_modules/.cache/verdanza-cagnotte-interactive/empty-env");
const applicationMainPath = resolve(root, "src/main.tsx").replaceAll("\\", "/");
const productImagePath = resolve(root, "src/components/ProductImage.tsx").replaceAll("\\", "/");

const replacements = new Map([
  [resolve(root, "src/lib/firebase"), resolve(localClientRoot, "firebase.ts")],
  [resolve(root, "src/lib/firebaseAuth"), resolve(localClientRoot, "firebaseAuth.ts")],
  [resolve(root, "src/config/cagnotteFeatures"), resolve(localClientRoot, "cagnotteFeatures.ts")],
  [resolve(root, "src/services/addressAutocompleteService"), resolve(localClientRoot, "addressAutocompleteService.ts")],
  [resolve(root, "src/lib/googleTagManager"), resolve(localClientRoot, "googleTagManager.ts")],
]);

function recipeOnlyModules(): Plugin {
  return {
    name: "verdanza-cagnotte-interactive-local-only",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || (!source.startsWith(".") && !source.startsWith("/"))) return null;
      const importerPath = importer.split("?", 1)[0];
      const resolved = resolve(importerPath ? resolve(importerPath, "..") : root, source)
        .replace(/\.(?:js|jsx|ts|tsx)$/, "");
      return replacements.get(resolved) ?? null;
    },
    transformIndexHtml(html) {
      return html.replace(
        /<script type="module" src="\/src\/main\.tsx"><\/script>/,
        '<script type="module" src="/scripts/cagnotte-interactive/client/main.ts"></script>',
      );
    },
    transform(code, id) {
      const modulePath = id.split("?", 1)[0].replaceAll("\\", "/");
      if (modulePath === productImagePath) {
        const transformed = code.replace(
          "fetchPriority={fetchPriority}",
          "fetchpriority={fetchPriority}",
        );
        if (transformed === code) {
          throw new Error("RECETTE LOCALE: adaptation React 18 de ProductImage introuvable.");
        }
        return { code: transformed, map: null };
      }
      if (modulePath === applicationMainPath) {
        const transformed = code
          .replace("<React.StrictMode>", "<React.Fragment>")
          .replace("</React.StrictMode>", "</React.Fragment>");
        if (transformed === code) {
          throw new Error("RECETTE LOCALE: adaptation mono-montage de src/main.tsx introuvable.");
        }
        return { code: transformed, map: null };
      }
      return null;
    },
    configureServer(server) {
      server.middlewares.use("/__recette-assets/cagnotte-produit-fictif.svg", (_request, response) => {
        response.statusCode = 200;
        response.setHeader("content-type", "image/svg+xml; charset=utf-8");
        response.setHeader("cache-control", "no-store");
        createReadStream(resolve(root, "scripts/cagnotte-interactive/assets/cagnotte-produit-fictif.svg"))
          .pipe(response);
      });
    },
  };
}

export default defineConfig({
  envDir: emptyEnvDir,
  plugins: [recipeOnlyModules(), react()],
  server: {
    host: "127.0.0.1",
    port: 14173,
    strictPort: true,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": [
        "default-src 'self'",
        "base-uri 'none'",
        "connect-src 'self' http://127.0.0.1:18086 http://127.0.0.1:19099 ws://127.0.0.1:14173",
        "font-src 'self' data:",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "img-src 'self' data: blob:",
        "object-src 'none'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
      ].join("; "),
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:14174",
        changeOrigin: false,
      },
    },
  },
  preview: { host: "127.0.0.1", port: 14173, strictPort: true },
});
