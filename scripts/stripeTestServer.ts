import { createServer } from "node:http";
import { createServer as createViteServer } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertStripeTestEnvironment } from "../api/_server/stripeTestConfig.js";
import { stripeTestHttp } from "../api/_server/stripeTestHttp.js";

// Secrets arrive via this process environment, never VITE_* or application .env.
assertStripeTestEnvironment();
const vite = await createViteServer({ configFile: false, envFile: false,
  esbuild: { jsx: "automatic" }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
const html = readFileSync(resolve("stripe-test.html"), "utf8");
const server = createServer(async (req, res) => {
  if (req.headers.host !== "127.0.0.1:5195") { res.writeHead(403); res.end(); return; }
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; frame-src 'none'; form-action 'self'; base-uri 'none'");
  if (req.url?.startsWith("/api/")) {
    if (!req.url.startsWith("/api/stripe-test/")) { res.writeHead(404); res.end(); return; }
    await stripeTestHttp(req, res);
    return;
  }
  const pathname = new URL(req.url || "/", "http://127.0.0.1:5195").pathname;
  if (pathname === "/") { res.writeHead(302, { Location: "/stripe-test" }); res.end(); return; }
  if (["/stripe-test", "/stripe-test/cart", "/stripe-test/checkout", "/stripe-test/success", "/stripe-test/cancel"].includes(pathname)) {
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.end(await vite.transformIndexHtml("/", html));
    return;
  }
  // No public production app shell, credentials, or arbitrary pages in this test entrypoint.
  if (pathname.endsWith(".html") || pathname.startsWith("/src/main") || pathname.startsWith("/src/App")) { res.writeHead(404); res.end(); return; }
  vite.middlewares(req, res, () => { res.writeHead(404); res.end(); });
});
server.listen(5195, "127.0.0.1", () => console.log("Stripe TEST local: http://127.0.0.1:5195 ; Firestore demo emulator only"));
process.on("SIGINT", () => { server.close(); void vite.close(); });
