import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "inline",
      includeAssets: [
        "brand/verdanza-v1/favicons/favicon.ico",
        "brand/verdanza-v1/favicons/favicon.svg",
        "brand/verdanza-v1/favicons/favicon-16x16.png",
        "brand/verdanza-v1/favicons/favicon-32x32.png",
        "brand/verdanza-v1/favicons/favicon-48x48.png",
        "brand/verdanza-v1/favicons/apple-touch-icon-180x180.png",
        "brand/verdanza-v1/favicons/safari-pinned-tab.svg",
        "brand/verdanza-v1/logos/verdanza-logo-horizontal-compact-full-color.svg",
        "brand/verdanza-v1/logos/verdanza-logo-horizontal-compact-mono-gold.svg",
        "brand/verdanza-v1/logos/verdanza-logo-horizontal-primary-full-color.svg",
        "brand/verdanza-v1/logos/verdanza-seal-full-color.svg",
      ],
      manifest: {
        name: "Verdanza CBD",
        short_name: "Verdanza",
        description: "Boutique Verdanza CBD, fleurs et resines CBD selectionnees.",
        lang: "fr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#FDF9F4",
        theme_color: "#0E3726",
        icons: [
          {
            src: "/brand/verdanza-v1/icons/android-chrome-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/brand/verdanza-v1/icons/android-chrome-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/brand/verdanza-v1/icons/maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: [
          "assets/*.{js,css}",
          "brand/verdanza-v1/**/*.{png,svg,ico}",
          "offline.html",
        ],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) =>
              request.mode === "navigate" &&
              !/^\/api(?:\/|$)/.test(url.pathname) &&
              !/^\/checkout(?:\/|$)/.test(url.pathname) &&
              !/^\/panier(?:\/|$)/.test(url.pathname) &&
              !/^\/admin(?:\/|$)/.test(url.pathname) &&
              !/^\/compte(?:\/|$)/.test(url.pathname),
            handler: "NetworkOnly",
            options: {
              plugins: [
                {
                  handlerDidError: async () => {
                    const serviceWorkerGlobal = globalThis as unknown as {
                      caches: {
                        keys: () => Promise<string[]>;
                        open: (cacheName: string) => Promise<{
                          match: (
                            request: string,
                            options?: { ignoreSearch?: boolean },
                          ) => Promise<Response | undefined>;
                        }>;
                      };
                    };

                    for (const cacheName of await serviceWorkerGlobal.caches.keys()) {
                      const cache = await serviceWorkerGlobal.caches.open(cacheName);
                      const offlineResponse = await cache.match("/offline.html", {
                        ignoreSearch: true,
                      });
                      if (offlineResponse) return offlineResponse;
                    }

                    return undefined;
                  },
                },
              ],
            },
          },
          {
            urlPattern: ({ request, url }) =>
              url.pathname.startsWith("/assets/") &&
              ["script", "style", "font"].includes(request.destination),
            handler: "CacheFirst",
            options: {
              cacheName: "verdanza-static-assets",
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
          {
            urlPattern: ({ request, url }) =>
              request.destination === "image" &&
              url.pathname.startsWith("/images/"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "verdanza-static-images",
              expiration: {
                maxEntries: 120,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
        ],
      },
    }),
  ],
  build: {
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter((dependency) => !dependency.includes("vendor-firebase-auth")),
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]@firebase[\\/]auth|[\\/]firebase[\\/]auth/.test(id)) {
            return "vendor-firebase-auth";
          }
          if (id.includes("firebase")) return "vendor-firebase";
          if (id.includes("react") || id.includes("react-dom")) return "vendor-react";
          if (id.includes("lucide-react")) return "vendor-icons";
        },
      },
    },
  },
});
