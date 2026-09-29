import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { normalizeSelection, type ProductSelection } from "../../src/types/selection.js";
import type { SupplierCapture } from "../../src/types/selectionPipeline.js";
import { prepareImportedSelection } from "../../src/lib/selectionPipeline.js";

export class SupplierExtractionError extends Error { constructor(message: string) { super(message); } }
export type SupplierAdapter = { id: string; domains: readonly string[]; parse: (html: string, url: URL) => ProductSelection };
const domains = ["originecbd.fr", "legrossisteducbd.shop", "legrossisteducbd.com"];
export function validateSupplierUrl(raw: string | URL) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new SupplierExtractionError("Lien fournisseur invalide."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || isIP(url.hostname.replaceAll("[", "").replaceAll("]", ""))
    || !domains.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`))) throw new SupplierExtractionError("Fournisseur non pris en charge. Import sécurisé disponible pour originecbd.fr et legrossisteducbd ; autre fournisseur : saisie manuelle ou JSON.");
  url.hash = "";
  return url;
}
const blocked = new BlockList();
for (const [ip, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]] as const) blocked.addSubnet(ip, prefix, "ipv4");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
export function isPublicSupplierAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  // Only global unicast IPv6; excludes loopback, mapped IPv4, ULA, link-local and NAT64.
  return family === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^2002:|^3fff:/i.test(address) && !blocked.check(address, "ipv6");
}
export type SupplierHttpResult = { status: number; contentType: string; location: string; body: string };
type ExtractionDependencies = {
  resolve: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  request: (url: URL, address: { address: string; family: number }, timeout: number, maximum: number) => Promise<SupplierHttpResult>;
  timeoutMs: number; maximumBytes: number;
};
function pinnedRequest(url: URL, pinned: { address: string; family: number }, timeout: number, maximum: number): Promise<SupplierHttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { agent: false, family: pinned.family, servername: url.hostname, rejectUnauthorized: true,
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
      headers: { "User-Agent": "VerdanzaSelection/2.0", "Accept": "text/html", "Accept-Encoding": "identity", "Accept-Language": "fr-FR,fr;q=0.9" } }, (res) => {
      const status = res.statusCode || 0;
      const contentType = String(res.headers["content-type"] || "");
      const location = String(res.headers.location || "");
      if ([301, 302, 303, 307, 308].includes(status)) { res.destroy(); clearTimeout(timer); resolve({ status, location, contentType, body: "" }); return; }
      if (Number(res.headers["content-length"] || 0) > maximum) { req.destroy(new SupplierExtractionError("Page fournisseur trop volumineuse.")); return; }
      if (status < 200 || status >= 300 || !/text\/html/i.test(contentType) || (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity")) { req.destroy(new SupplierExtractionError("Fiche fournisseur indisponible ou encodage non pris en charge.")); return; }
      let size = 0; const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > maximum) req.destroy(new SupplierExtractionError("Page fournisseur trop volumineuse.")); else chunks.push(chunk); });
      res.on("error", reject);
      res.on("end", () => { clearTimeout(timer); resolve({ status, contentType, location, body: Buffer.concat(chunks).toString("utf8") }); });
    });
    const timer = setTimeout(() => req.destroy(new SupplierExtractionError("Délai fournisseur dépassé.")), timeout);
    req.on("error", (error) => { clearTimeout(timer); reject(error); });
    req.end();
  });
}
export async function extractSupplierPage(input: string, overrides: Partial<ExtractionDependencies> = {}) {
  const dep: ExtractionDependencies = { resolve: (hostname) => lookup(hostname, { all: true, verbatim: true }), request: pinnedRequest, timeoutMs: 12000, maximumBytes: 2000000, ...overrides };
  let url = validateSupplierUrl(input);
  const deadline = Date.now() + dep.timeoutMs;
  const bounded = async <T>(promise: Promise<T>): Promise<T> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SupplierExtractionError("Délai fournisseur dépassé.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new SupplierExtractionError("Délai fournisseur dépassé.")), remaining); })]); }
    finally { clearTimeout(timer); }
  };
  for (let hop = 0; hop < 4; hop++) {
    const addresses = await bounded(dep.resolve(url.hostname));
    if (!addresses.length || addresses.some((a) => !isPublicSupplierAddress(a.address))) throw new SupplierExtractionError("Adresse fournisseur privée, locale ou réservée refusée.");
    // The HTTPS connection uses this exact checked address, never a second DNS lookup.
    const result = await bounded(dep.request(url, addresses[0], Math.max(1, deadline - Date.now()), dep.maximumBytes));
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      if (!result.location) throw new SupplierExtractionError("Redirection fournisseur invalide.");
      url = validateSupplierUrl(new URL(result.location, url));
      continue;
    }
    if (result.status < 200 || result.status >= 300 || !/text\/html/i.test(result.contentType)) throw new SupplierExtractionError("Fiche fournisseur indisponible.");
    if (Buffer.byteLength(result.body) > dep.maximumBytes) throw new SupplierExtractionError("Page fournisseur trop volumineuse.");
    const adapter = supplierAdapters.find((a) => a.domains.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`)))!;
    return prepareImportedSelection(adapter.parse(result.body, url));
  }
  throw new SupplierExtractionError("Trop de redirections fournisseur.");
}

export function parseSupplierHtml(html: string, url: URL) {
  const meta = (key: string) => {
    const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i"))?.[0] || "";
    return decodeHtml(tag.match(/content=["']([^"']*)["']/i)?.[1] || "");
  };
  let product: Record<string, unknown> = {};
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [])];
      const found = nodes.find((node) => node && typeof node === "object" &&
        (["Product", "ProductGroup"].includes(node["@type"]) || (Array.isArray(node["@type"]) && node["@type"].some((type: unknown) => type === "Product" || type === "ProductGroup"))));
      if (found) { product = found; break; }
    } catch { /* Ignore malformed supplier JSON-LD. */ }
  }
  const name = plainText(product.name || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    || meta("og:title") || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  if (!name) throw new SupplierExtractionError("Nom du produit introuvable ; utilisez la saisie manuelle.");
  let canonicalUrl = url.href;
  const canonicalTag = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i)?.[0];
  if (canonicalTag) { try { canonicalUrl = validateSupplierUrl(new URL(decodeHtml(canonicalTag.match(/href=["']([^"']+)["']/i)?.[1] || ""), url)).href; } catch { /* Foreign canonical URLs do not widen the supplier allowlist. */ } }
  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  const price = offer && typeof offer === "object" ? String((offer as Record<string, unknown>).price || "") : "";
  const image = Array.isArray(product.image) ? product.image[0] : product.image;
  const rawImage = typeof image === "string" ? image : meta("og:image");
  let imageUrl = "";
  try { const image = new URL(rawImage, url); if (rawImage && image.protocol === "https:" && !image.username && !image.password) imageUrl = image.href; } catch { /* Missing or malformed images remain empty. */ }
  const attributes: Record<string, string> = {};
  for (const match of html.matchAll(/<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi)) {
    attributes[plainText(match[1]).toLowerCase()] = plainText(match[2]);
  }
  const categoryText = `${name} ${attributes["type de produit"] || ""}`;
  const category = /r[ée]sine|hash|kief|pollen/i.test(categoryText) ? "Résine" : /fleur|bud|flower/i.test(categoryText) ? "Fleur" : "Autre";
  const prices: Array<{ format: string; price: string }> = [];
  for (const match of html.matchAll(/<form\b[^>]*data-product_variations\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    try {
      const variations = JSON.parse(decodeHtml(match[2]));
      if (!Array.isArray(variations)) continue;
      for (const variation of variations.slice(0, 40)) {
        if (!variation || typeof variation !== "object") continue;
        const attrs = variation.attributes && typeof variation.attributes === "object"
          ? Object.values(variation.attributes).map((part) => plainText(part)).filter(Boolean) : [];
        const price = parsePrice(variation.display_price ?? variation.display_regular_price);
        if (price) prices.push({ format: attrs.join(" / ") || "Format à vérifier", price });
      }
    } catch { /* Supplier variations can be malformed. */ }
  }
  if (!prices.length) {
    const tierStarts = [...html.matchAll(/<div\b[^>]*class=["'][^"']*\balcabutdis-item\b[^"']*["'][^>]*>/gi)];
    tierStarts.slice(0, 40).forEach((tier, index) => {
      const chunk = html.slice(tier.index, tierStarts[index + 1]?.index ?? tier.index + 3000);
      const label = plainText(chunk.match(/<span[^>]*class=["'][^"']*\balcabutdis-title\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
      const pricesText = [...chunk.matchAll(/<span[^>]*class=["'][^"']*\balcabutdis-price\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)].map((found) => plainText(found[1]));
      const total = pricesText.find((part) => /soit/i.test(part)) || pricesText[0] || "";
      const price = parsePrice(total.replace(/^.*?soit\s*/i, ""));
      if (price) prices.push({ format: label || "Format à vérifier", price });
    });
  }
  if (!prices.length) {
    const variants = (Array.isArray(product.hasVariant) ? product.hasVariant : []).slice(0, 30).flatMap((variant: Record<string, unknown>) => {
      if (!variant || typeof variant !== "object") return [];
      const offers = Array.isArray(variant.offers) ? variant.offers : variant.offers ? [variant.offers] : [];
      const weight = variant.weight && typeof variant.weight === "object" ? variant.weight as Record<string, unknown> : {};
      const quantityLabel = Number(weight.value) > 0 && (weight.unitCode === "GRM" || weight.unitText === "g") ? `${Number(weight.value)} g` : plainText(variant.name);
      return offers.filter((o) => o && typeof o === "object").map((o) => ({ ...o as Record<string, unknown>, name: quantityLabel }));
    });
    const offers = [...(Array.isArray(product.offers) ? product.offers : product.offers ? [product.offers] : []), ...variants];
    for (const candidate of offers.slice(0, 30)) {
      if (!candidate || typeof candidate !== "object") continue;
      const offerRow = candidate as Record<string, unknown>;
      const offerPrice = parsePrice(offerRow.price ?? offerRow.lowPrice);
      if (offerPrice) prices.push({ format: plainText(offerRow.name || "Prix affiché"), price: offerPrice });
    }
  }
  if (!prices.length && parsePrice(price)) prices.push({ format: "Format à vérifier", price: parsePrice(price) });
  const capture: SupplierCapture = { sourceUrl: url.href, capturedAt: new Date().toISOString(), adapter: url.hostname.includes("originecbd") ? "originecbd" : "legrossisteducbd", fields: {} };
  const declaredIntensity = attributes["intensité"]?.toLowerCase() || "";
  const intensity = /^(doux|douce)$/.test(declaredIntensity) ? "douce" : /^(moyen|moyenne)$/.test(declaredIntensity) ? "moyenne" : /^(fort|forte)$/.test(declaredIntensity) ? "forte" : "";
  const aromas = attributes["arômes"] || "";
  const aromaFamily = /agrume|citron|orange/i.test(aromas) ? "agrumes" : /fruit/i.test(aromas) ? "fruite" : /terre/i.test(aromas) ? "terreux" : /bois/i.test(aromas) ? "boise" : /[ée]pic/i.test(aromas) ? "epice" : /sucr/i.test(aromas) ? "sucre" : "";
  const item = normalizeSelection({
    name, url: canonicalUrl, supplier: url.hostname.replace(/^www\./, ""), category,
    molecule: name.match(/\b(THC-?X|THCX|CBD|CBN|CBG|CPR)\b/i)?.[0]?.toUpperCase() || "",
    rate: name.match(/\b\d+(?:[,.]\d+)?\s*%/)?.[0] || "",
    origin: attributes.provenance || "", culture: attributes["type de culture"] || "",
    aromas, intensity, aromaFamily, taste: attributes["goût"] || "", appearance: attributes.aspect || attributes["taille des buds"] || "",
    attributes: { ...attributes, ...(offer && typeof offer === "object" && (offer as Record<string, unknown>).availability ? { disponibilité: String((offer as Record<string, unknown>).availability) } : {}) },
    description: plainText(product.description || meta("description") || meta("og:description")),
    imageUrl, prices,
  });
  for (const key of ["name", "url", "supplier", "category", "molecule", "rate", "origin", "culture", "aromas", "intensity", "aromaFamily", "taste", "appearance", "description", "imageUrl"] as const) {
    if (item[key]) capture.fields[key] = { value: item[key], source: url.href, method: key === "category" || key === "aromaFamily" ? "inferred" : "declared", confidence: key === "category" || key === "aromaFamily" ? "limited" : "high" };
  }
  for (const [key, value] of Object.entries(item.attributes)) capture.fields[`attribute:${key}`] = { value, source: url.href, method: "declared", confidence: "high" };
  for (const [index, row] of item.prices.entries()) capture.fields[`price:${index}`] = { value: `${row.format} : ${row.price}`, source: url.href, method: "declared", confidence: "limited" };
  if (Array.isArray(product.image)) capture.fields.images = { value: JSON.stringify(product.image.filter((v) => typeof v === "string").slice(0, 8)).slice(0, 2000), source: url.href, method: "declared", confidence: "high" };
  return { ...item, extraction: capture };
}

export const supplierAdapters: SupplierAdapter[] = [
  { id: "originecbd", domains: ["originecbd.fr"], parse: parseSupplierHtml },
  { id: "legrossisteducbd", domains: ["legrossisteducbd.shop", "legrossisteducbd.com"], parse: parseSupplierHtml },
];

function parsePrice(value: unknown) {
  const raw = String(value ?? "").replace(/\u00a0/g, " ");
  const match = raw.match(/\d[\d\s.,]*/);
  if (!match) return "";
  let number = match[0].replace(/\s+/g, "");
  if (number.includes(",") && number.includes(".")) number = number.replace(/\./g, "").replace(",", ".");
  else number = number.replace(",", ".");
  const parsed = Number(number);
  return Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(2) : "";
}

function plainText(value: unknown) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).slice(0, 2000);
}

function decodeHtml(value: string) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[0-9a-f]+);/gi, (entity) => {
    if (/^&#/i.test(entity)) { const code = /^&#x/i.test(entity) ? Number.parseInt(entity.slice(3, -1), 16) : Number.parseInt(entity.slice(2, -1), 10); return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ""; }
    return ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " } as Record<string, string>)[entity.toLowerCase()] || entity;
  });
}
