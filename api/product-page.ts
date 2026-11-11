import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getAdminDb, getAdminProjectId } from "./_server/firebaseAdmin.js";
import { createProductPageHandler } from "./_server/productPage.js";

export default createProductPageHandler({
  loadTemplate: (slug) => readFile(resolve(process.cwd(), slug ? `dist/produits/${slug}/index.html` : "dist/404.html"), "utf8"),
  loadStock: async (id) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (getAdminProjectId() !== "verdanza-1f621") throw new Error("Unexpected public catalogue project");
      const snapshot = await Promise.race([
        getAdminDb({ logIdentity: false }).collection("products").doc(id).get(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Stock read timeout")), 5_000); }),
      ]);
      if (!snapshot.exists) return undefined;
      const { slug, stock, isActive } = snapshot.data() || {};
      return { slug, stock, isActive };
    } finally {
      if (timer) clearTimeout(timer);
    }
  },
});
