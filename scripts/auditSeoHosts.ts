import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import sharp from "sharp";

type RedirectRule = {
  source?: string;
  destination?: string;
  permanent?: boolean;
  has?: Array<{ type?: string; value?: string }>;
};

const canonicalOrigin = "https://verdanza.fr";
const configuredRedirectHosts = [
  "www.verdanza.fr",
  "verdanza-cbd.fr",
  "www.verdanza-cbd.fr",
  "verdanza-opal.vercel.app",
];
const existingDomainRedirectHosts = ["verdenza.fr", "www.verdenza.fr"];
const protectedTechnicalHosts = [
  "verdanza-token-inv13s-projects.vercel.app",
  "verdanza-git-main-token-inv13s-projects.vercel.app",
];
const faviconFiles = [
  { url: "/favicon-48x48.png", width: 48, height: 48, maxBytes: 50 * 1024 },
  { url: "/favicon-96x96.png", width: 96, height: 96, maxBytes: 100 * 1024 },
  { url: "/favicon-192x192.png", width: 192, height: 192, maxBytes: 200 * 1024 },
  { url: "/favicon-512x512.png", width: 512, height: 512, maxBytes: 500 * 1024 },
  { url: "/apple-touch-icon.png", width: 180, height: 180, maxBytes: 200 * 1024 },
];
const failures: string[] = [];
const observations: string[] = [];
const productionMode = process.argv.includes("--production");

await auditStaticConfiguration();
if (productionMode) await auditProduction();

if (observations.length) {
  console.log("SEO host observations:");
  observations.forEach((observation) => console.log(`- ${observation}`));
}

if (failures.length) {
  console.error("SEO host audit failures:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(
    `SEO host audit passed (${productionMode ? "static and production" : "static"} checks).`,
  );
}

async function auditStaticConfiguration() {
  const vercelConfig = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as {
    redirects?: RedirectRule[];
  };
  const redirects = vercelConfig.redirects || [];

  for (const host of configuredRedirectHosts) {
    const pathMatches = redirects.filter(
      (redirect) =>
        redirect.source === "/:path*" &&
        redirect.destination === `${canonicalOrigin}/:path*` &&
        redirect.permanent === true &&
        redirect.has?.some(
          (condition) => condition.type === "host" && condition.value === host,
        ),
    );
    if (pathMatches.length !== 1) {
      failures.push(`expected one explicit permanent host redirect for ${host}`);
    }
    const rootMatches = redirects.filter(
      (redirect) =>
        redirect.source === "/" &&
        redirect.destination === `${canonicalOrigin}/` &&
        redirect.permanent === true &&
        redirect.has?.some(
          (condition) => condition.type === "host" && condition.value === host,
        ),
    );
    if (rootMatches.length !== 1) {
      failures.push(`expected one explicit permanent root redirect for ${host}`);
    }
  }
  if (
    redirects.some((redirect) =>
      redirect.has?.some(
        (condition) => condition.type === "host" && condition.value === "verdanza.fr",
      ),
    )
  ) {
    failures.push("canonical host must not have a host redirect rule");
  }
  for (const host of protectedTechnicalHosts) {
    if (
      redirects.some((redirect) =>
        redirect.has?.some(
          (condition) => condition.type === "host" && condition.value === host,
        ),
      )
    ) {
      failures.push(`protected technical alias must remain usable: ${host}`);
    }
  }

  const indexHtml = readFileSync(resolve("index.html"), "utf8");
  const requiredHeadTags = [
    '<link rel="icon" type="image/x-icon" href="/favicon.ico" />',
    '<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png" />',
    '<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png" />',
    '<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png" />',
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />',
  ];
  requiredHeadTags.forEach((tag) => {
    if (!indexHtml.includes(tag)) failures.push(`missing head tag: ${tag}`);
  });
  if (!indexHtml.includes('<link rel="manifest" href="/manifest.webmanifest" />')) {
    failures.push("manifest link is missing from initial HTML");
  }

  const manifest = JSON.parse(
    readFileSync(resolve("public/manifest.webmanifest"), "utf8"),
  ) as {
    name?: string;
    short_name?: string;
    icons?: Array<{ src?: string; sizes?: string; type?: string }>;
  };
  if (manifest.name !== "Verdanza" || manifest.short_name !== "Verdanza") {
    failures.push("manifest brand name mismatch");
  }
  for (const expected of [
    { src: "/favicon-192x192.png", sizes: "192x192" },
    { src: "/favicon-512x512.png", sizes: "512x512" },
  ]) {
    if (
      !manifest.icons?.some(
        (icon) =>
          icon.src === expected.src &&
          icon.sizes === expected.sizes &&
          icon.type === "image/png",
      )
    ) {
      failures.push(`manifest icon mismatch: ${expected.src}`);
    }
  }

  for (const expected of faviconFiles) {
    await auditPngFile(resolve("public", expected.url.slice(1)), expected);
  }
  auditIco(readFileSync(resolve("public/favicon.ico")), "public/favicon.ico");

  const sourceBadge = await sharp(resolve("public/verdanza-badge.png")).metadata();
  if (!sourceBadge.width || sourceBadge.width !== sourceBadge.height) {
    failures.push("official favicon source is not square");
  }

  const sitemap = readFileSync(resolve("public/sitemap.xml"), "utf8");
  const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => match[1],
  );
  if (!sitemapUrls.length) failures.push("sitemap contains no URL");
  sitemapUrls.forEach((url) => {
    if (!url.startsWith(`${canonicalOrigin}/`)) failures.push(`non-canonical sitemap URL: ${url}`);
    if (url.includes("vercel.app")) failures.push(`Vercel URL in sitemap: ${url}`);
  });
  observations.push(`sitemap URLs: ${sitemapUrls.length}`);

  const robots = readFileSync(resolve("public/robots.txt"), "utf8");
  if (!robots.includes(`Sitemap: ${canonicalOrigin}/sitemap.xml`)) {
    failures.push("robots.txt sitemap is not canonical");
  }
  if (/Disallow:\s*\/(?:favicon|manifest)/i.test(robots)) {
    failures.push("robots.txt blocks favicon or manifest assets");
  }

  const promoBannersService = readFileSync(
    resolve("src/services/promoBannersService.ts"),
    "utf8",
  );
  if (
    !promoBannersService.includes(
      'url.replace("https://verdanza-opal.vercel.app", "https://verdanza.fr")',
    )
  ) {
    failures.push("legacy public banner URLs are not normalized to the canonical host");
  }

  auditPrerenderedHtml();
}

async function auditProduction() {
  for (const path of ["/", "/boutique", "/blog", "/blog?source=test"]) {
    const response = await fetch(`${canonicalOrigin}${path}`, { redirect: "manual" });
    if (response.status !== 200) failures.push(`canonical ${path} returned ${response.status}`);
    const html = await response.text();
    const expectedCanonical = `${canonicalOrigin}${path.split("?")[0]}`;
    const canonical = firstMatch(
      html,
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
    );
    if (canonical !== expectedCanonical) {
      failures.push(`canonical mismatch for ${path}: ${canonical || "missing"}`);
    }
    if (/https:\/\/[^"'<>\s]*vercel\.app/i.test(indexableUrlMarkup(html))) {
      failures.push(`indexable Vercel URL found in ${path}`);
    }
  }

  const redirectCases = ["/", "/boutique", "/blog", "/blog?source=test"];
  for (const host of [...configuredRedirectHosts, ...existingDomainRedirectHosts]) {
    for (const path of redirectCases) {
      const response = await fetch(`https://${host}${path}`, { redirect: "manual" });
      const expectedLocation = `${canonicalOrigin}${path}`;
      if (response.status !== 308) {
        failures.push(`${host}${path} returned ${response.status}, expected 308`);
        continue;
      }
      if (response.headers.get("location") !== expectedLocation) {
        failures.push(
          `${host}${path} location mismatch: ${response.headers.get("location") || "missing"}`,
        );
      }
    }
  }

  for (const host of protectedTechnicalHosts) {
    const response = await fetch(`https://${host}/`, { redirect: "manual" });
    observations.push(`protected technical alias ${host}: HTTP ${response.status}`);
  }

  for (const expected of faviconFiles) {
    const response = await fetch(`${canonicalOrigin}${expected.url}`, { redirect: "manual" });
    if (response.status !== 200) {
      failures.push(`${expected.url} returned ${response.status}`);
      continue;
    }
    if (!response.headers.get("content-type")?.toLowerCase().includes("image/png")) {
      failures.push(`${expected.url} MIME mismatch: ${response.headers.get("content-type")}`);
    }
    await auditPngBuffer(Buffer.from(await response.arrayBuffer()), expected.url, expected);
  }

  const icoResponse = await fetch(`${canonicalOrigin}/favicon.ico`, { redirect: "manual" });
  if (icoResponse.status !== 200) failures.push(`favicon.ico returned ${icoResponse.status}`);
  const icoMime = icoResponse.headers.get("content-type")?.toLowerCase() || "";
  if (!icoMime.includes("image/x-icon") && !icoMime.includes("image/vnd.microsoft.icon")) {
    failures.push(`favicon.ico MIME mismatch: ${icoMime || "missing"}`);
  }
  if (icoResponse.ok) {
    auditIco(Buffer.from(await icoResponse.arrayBuffer()), `${canonicalOrigin}/favicon.ico`);
  }

  const manifestResponse = await fetch(`${canonicalOrigin}/manifest.webmanifest`, {
    redirect: "manual",
  });
  if (manifestResponse.status !== 200) {
    failures.push(`manifest returned ${manifestResponse.status}`);
  } else {
    try {
      JSON.parse(await manifestResponse.text());
    } catch {
      failures.push("production manifest is invalid JSON");
    }
  }

  const sitemapResponse = await fetch(`${canonicalOrigin}/sitemap.xml`, { redirect: "manual" });
  const sitemap = await sitemapResponse.text();
  if (sitemapResponse.status !== 200) failures.push(`production sitemap returned ${sitemapResponse.status}`);
  if (sitemap.includes("vercel.app")) failures.push("production sitemap contains vercel.app");

  const unknown = await fetch(`${canonicalOrigin}/__seo-hosts-404-check__`, {
    redirect: "manual",
  });
  if (unknown.status !== 404) failures.push(`unknown route returned ${unknown.status}, expected 404`);

  const api = await fetch(`${canonicalOrigin}/api/create-order`, { redirect: "manual" });
  if (api.status !== 405) failures.push(`GET /api/create-order returned ${api.status}, expected 405`);
}

async function auditPngFile(
  path: string,
  expected: { width: number; height: number; maxBytes: number },
) {
  if (!existsSync(path)) {
    failures.push(`missing favicon file: ${relative(process.cwd(), path)}`);
    return;
  }
  const buffer = readFileSync(path);
  await auditPngBuffer(buffer, relative(process.cwd(), path), expected);
}

async function auditPngBuffer(
  buffer: Buffer,
  label: string,
  expected: { width: number; height: number; maxBytes: number },
) {
  const metadata = await sharp(buffer).metadata();
  if (metadata.format !== "png") failures.push(`${label} is not a valid PNG`);
  if (metadata.width !== expected.width || metadata.height !== expected.height) {
    failures.push(
      `${label} dimensions ${metadata.width || 0}x${metadata.height || 0}, expected ${expected.width}x${expected.height}`,
    );
  }
  if (metadata.width !== metadata.height) failures.push(`${label} is not square`);
  if (buffer.length > expected.maxBytes) {
    failures.push(`${label} is too large: ${buffer.length} bytes`);
  }
  observations.push(`${label}: ${metadata.width}x${metadata.height}, ${buffer.length} bytes`);
}

function auditIco(buffer: Buffer, label: string) {
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    failures.push(`${label} has an invalid ICO header`);
    return;
  }
  const count = buffer.readUInt16LE(4);
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    if (offset + 16 > buffer.length) {
      failures.push(`${label} has a truncated directory`);
      return;
    }
    const width = buffer.readUInt8(offset) || 256;
    const height = buffer.readUInt8(offset + 1) || 256;
    const bytes = buffer.readUInt32LE(offset + 8);
    const imageOffset = buffer.readUInt32LE(offset + 12);
    if (width !== height) failures.push(`${label} contains a non-square ${width}x${height} image`);
    if (imageOffset + bytes > buffer.length) failures.push(`${label} contains truncated image data`);
    sizes.push(width);
  }
  for (const expected of [16, 32, 48]) {
    if (!sizes.includes(expected)) failures.push(`${label} is missing ${expected}x${expected}`);
  }
  observations.push(`${label}: ${buffer.length} bytes, entries ${sizes.join("/")} px`);
}

function auditPrerenderedHtml() {
  const distDir = resolve("dist");
  if (!existsSync(distDir)) {
    observations.push("dist absent: prerendered HTML checks deferred until build");
    return;
  }
  for (const file of walk(distDir).filter((entry) => entry.endsWith(".html"))) {
    const html = readFileSync(file, "utf8");
    const robots = firstMatch(
      html,
      /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i,
    );
    if (robots.includes("noindex")) continue;
    const canonical = firstMatch(
      html,
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
    );
    if (!canonical.startsWith(`${canonicalOrigin}/`)) {
      failures.push(`non-canonical prerender URL in ${relative(distDir, file)}`);
    }
    if (/https:\/\/[^"'<>\s]*vercel\.app/i.test(indexableUrlMarkup(html))) {
      failures.push(`indexable Vercel URL in ${relative(distDir, file)}`);
    }
  }
}

function indexableUrlMarkup(html: string) {
  return [
    ...html.matchAll(/<(?:a|link|meta|script)[^>]*(?:href|content|src)=["'][^"']+["'][^>]*>/gi),
    ...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi),
  ]
    .map((match) => match[0])
    .join("\n");
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function firstMatch(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1] || "";
}
