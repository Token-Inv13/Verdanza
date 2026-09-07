import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sitemapEntries } from "./seoRoutes";

const entries = sitemapEntries();
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((entry) => `  <url><loc>${escapeXml(entry.loc)}</loc>${entry.lastmod ? `<lastmod>${escapeXml(entry.lastmod)}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`;

const sitemapPath = resolve("public", "sitemap.xml");
if (process.argv.includes("--check")) {
  const current = readFileSync(sitemapPath, "utf8");
  if (normalizeLineEndings(current) !== normalizeLineEndings(xml)) {
    throw new Error(
      "public/sitemap.xml is stale. Run npm run sitemap intentionally, then review the tracked diff.",
    );
  }
  console.log(`Validated public/sitemap.xml with ${entries.length} URLs (read-only).`);
} else {
  writeFileSync(sitemapPath, xml, "utf8");
  console.log(`Generated public/sitemap.xml with ${entries.length} URLs.`);
}

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
