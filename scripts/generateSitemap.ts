import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sitemapEntries } from "./seoRoutes";

const entries = sitemapEntries();
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((entry) => `  <url><loc>${escapeXml(entry.loc)}</loc>${entry.lastmod ? `<lastmod>${escapeXml(entry.lastmod)}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`;

writeFileSync(resolve("public", "sitemap.xml"), xml, "utf8");
console.log(`Generated public/sitemap.xml with ${entries.length} URLs.`);

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
