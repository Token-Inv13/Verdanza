import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script",
      includeAssets: [
        "apple-touch-icon.png",
        "verdanza-badge.png",
        "verdanza-logo.png",
        "icons/pwa-192.png",
        "icons/pwa-512.png",
        "icons/pwa-maskable-512.png",
      ],
      manifest: {
        name: "Verdanza CBD",
        short_name: "Verdanza",
        description: "Boutique Verdanza CBD, fleurs et resines CBD selectionnees.",
        lang: "fr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#faf8f2",
        theme_color: "#0B3D2E",
        icons: [
          {
            src: "/icons/pwa-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/pwa-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icons/pwa-maskable-512.png",
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
          "icons/*.{png,webp}",
          "apple-touch-icon.png",
          "verdanza-badge.png",
          "verdanza-logo.png",
          "offline.html",
        ],
        navigateFallback: "/offline.html",
        navigateFallbackDenylist: [
          /^\/api(?:\/|$)/,
          /^\/checkout(?:\/|$)/,
          /^\/panier(?:\/|$)/,
          /^\/admin(?:\/|$)/,
          /^\/compte(?:\/|$)/,
        ],
        runtimeCaching: [
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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("firebase")) return "vendor-firebase";
          if (id.includes("react") || id.includes("react-dom")) return "vendor-react";
          if (id.includes("lucide-react")) return "vendor-icons";
        },
      },
    },
  },
});
