import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sitemapUrls } from "./seoRoutes";

const urls = sitemapUrls();
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`).join("\n")}
</urlset>
`;

writeFileSync(resolve("public", "sitemap.xml"), xml, "utf8");
console.log(`Generated public/sitemap.xml with ${urls.length} URLs.`);

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
