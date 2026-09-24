import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { FieldValue } from "firebase-admin/firestore";
import { assertAdminUser, firebaseAuthHttpFailure } from "./adminAuth.js";
import { getAdminDb, getAdminStorageBucket } from "./firebaseAdmin.js";
import { sendJson, type VercelRequestLike, type VercelResponseLike } from "./http.js";
import { createSelectionPdf } from "./selectionPdf.js";
import { publicSelectionEntry, publicSelectionView, type PublishedSelectionSheet } from "../../src/lib/selectionPublication.js";
import { productSheets } from "../../src/data/productSheets.js";
import { buildCatalogProduct, catalogProductId, catalogPublicationMissing, normalizeCatalogInput } from "../../src/lib/selectionCatalog.js";
import { reserveProductInternalReference } from "./productReferences.js";
import {
  normalizeSelection, publicationMissing, selectionPublicName, selectionSlug,
  type ProductSelection,
} from "../../src/types/selection.js";

const PRIVATE_COLLECTION = "productSelections";
const PUBLIC_COLLECTION = "productSelectionSheets";
const publicBaseSlugs = new Set(productSheets.map((sheet) => sheet.slug));

export async function handleSelection(request: VercelRequestLike, response: VercelResponseLike) {
  const query = new URL(request.url || "/", "https://verdanza.local").searchParams;
  const action = query.get("action") || "";
  if (!request.method || !["GET", "POST"].includes(request.method)) {
    sendJson(response, { error: "Méthode non autorisée." }, 405);
    return;
  }
  response.setHeader("X-Content-Type-Options", "nosniff");
  try {
    if (request.method === "GET" && action === "library") {
      await sendPublicLibrary(response);
      return;
    }
    if (request.method === "GET" && action === "asset") {
      await sendPublicAsset(response, query.get("slug") || "", query.get("kind") || "");
      return;
    }
    if (request.method === "GET" && action === "catalogImage") {
      const id = safeId(query.get("id"));
      const selection = await getAdminDb().collection(PRIVATE_COLLECTION).doc(id).get();
      if (!selection.exists) throw new SelectionError("Image introuvable.", 404);
      const item = normalizeSelection({ ...selection.data(), id });
      if (item.status !== "En boutique" || item.catalogProductId !== catalogProductId(id) || !item.imagePath) {
        throw new SelectionError("Image introuvable.", 404);
      }
      const product = await getAdminDb().collection("products").doc(item.catalogProductId).get();
      if (!product.exists || product.data()?.sourceSelectionId !== id) {
        throw new SelectionError("Image introuvable.", 404);
      }
      response.setHeader("Content-Type", "image/jpeg");
      response.setHeader("Cache-Control", "public, max-age=300");
      response.end(await readImage(item.imagePath));
      return;
    }
    const token = bearerToken(request);
    if (!token) {
      sendJson(response, { error: "Connexion administrateur requise." }, 401);
      return;
    }
    const db = getAdminDb();
    const admin = await assertAdminUser(db, token);
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "GET") {
      if (action === "adminImage") {
        const id = safeId(query.get("id"));
        const snapshot = await db.collection(PRIVATE_COLLECTION).doc(id).get();
        if (!snapshot.exists) throw new SelectionError("Sélection introuvable.", 404);
        const item = normalizeSelection({ ...snapshot.data(), id });
        if (!item.imagePath) throw new SelectionError("Image indisponible.", 404);
        response.setHeader("Content-Type", "image/jpeg");
        response.end(await readImage(item.imagePath));
        return;
      }
      if (action === "preview") {
        const id = safeId(query.get("id"));
        const snapshot = await db.collection(PRIVATE_COLLECTION).doc(id).get();
        if (!snapshot.exists) throw new SelectionError("Sélection introuvable.", 404);
        const item = normalizeSelection({ ...snapshot.data(), id });
        if (!item.imagePath) throw new SelectionError("Ajoutez une image avant de créer le PDF.");
        const image = await readImage(item.imagePath);
        const pdf = await makePdf(item, image);
        response.setHeader("Content-Type", "application/pdf");
        response.setHeader("Content-Disposition", `inline; filename="verdanza-${selectionSlug(selectionPublicName(item))}.pdf"`);
        response.end(pdf);
        return;
      }
      const snapshot = await db.collection(PRIVATE_COLLECTION).limit(500).get();
      const selections = snapshot.docs.map((doc) => normalizeSelection({ ...doc.data(), id: doc.id }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      sendJson(response, { selections });
      return;
    }
    const body = parseBody(request.body);
    const postAction = String(body.action || "");
    if (postAction === "save") {
      const input = normalizeSelection(body.selection);
      if (!input.name) throw new SelectionError("Le nom du produit est requis.");
      const id = input.id ? safeId(input.id) : randomUUID();
      const ref = db.collection(PRIVATE_COLLECTION).doc(id);
      const previous = await ref.get();
      const existing = previous.exists ? normalizeSelection({ ...previous.data(), id }) : null;
      if (existing && input.updatedAt !== existing.updatedAt) {
        throw new SelectionError("Cette fiche a été modifiée ailleurs. Rechargez-la avant d'enregistrer.", 409);
      }
      const now = new Date().toISOString();
      const item = {
        ...input, id, imagePath: existing?.imagePath || "",
        importedAt: existing?.importedAt || input.importedAt || now, updatedAt: now,
        publishedAt: existing?.publishedAt || "", publishedSlug: existing?.publishedSlug || "",
      };
      await db.runTransaction(async (transaction) => {
        const latest = await transaction.get(ref);
        const catalogRef = input.catalogProductId ? db.collection("products").doc(safeCatalogId(input.catalogProductId)) : null;
        const catalog = catalogRef ? await transaction.get(catalogRef) : null;
        const previousCatalogRef = existing?.catalogProductId ? db.collection("products").doc(safeCatalogId(existing.catalogProductId)) : null;
        const previousCatalog = previousCatalogRef && previousCatalogRef.id !== catalogRef?.id ? await transaction.get(previousCatalogRef) : catalog;
        if (catalog && !catalog.exists) throw new SelectionError("Produit marchand lié introuvable.", 400);
        if (previousCatalog?.data()?.sourceSelectionId === id && existing?.catalogProductId !== input.catalogProductId) {
          throw new SelectionError("Ce produit a été créé depuis la sélection. Conservez son lien boutique.", 409);
        }
        if (latest.exists && latest.data()?.updatedAt !== input.updatedAt) {
          throw new SelectionError("Cette fiche a été modifiée ailleurs. Rechargez-la avant d'enregistrer.", 409);
        }
        if (!latest.exists && existing) throw new SelectionError("Cette fiche a été retirée ailleurs.", 409);
        if (existing?.publishedSlug && item.status !== "En boutique") {
          transaction.delete(db.collection(PUBLIC_COLLECTION).doc(existing.publishedSlug));
          item.publishedAt = "";
          item.publishedSlug = "";
        }
        if (item.status !== "En boutique" && previousCatalog?.data()?.sourceSelectionId === id && previousCatalogRef) {
          transaction.update(previousCatalogRef, { isActive: false, updatedAt: FieldValue.serverTimestamp() });
        }
        transaction.set(ref, { ...item, updatedBy: admin.uid });
      });
      sendJson(response, { selection: item });
      return;
    }
    if (postAction === "import") {
      const rows = body.selections;
      if (!Array.isArray(rows) || !rows.length || rows.length > 100) {
        throw new SelectionError("Importez entre 1 et 100 produits à la fois.");
      }
      const snapshot = await db.collection(PRIVATE_COLLECTION).limit(500).get();
      if (snapshot.size === 500) throw new SelectionError("Catalogue trop grand pour cet import ; contactez l'administrateur.");
      const seen = new Set(snapshot.docs.map((doc) => dedupeKey(normalizeSelection(doc.data()))));
      const batch = db.batch();
      let imported = 0;
      let skipped = 0;
      const now = new Date().toISOString();
      for (const raw of rows) {
        const item = normalizeSelection(raw);
        if (!item.name) { skipped++; continue; }
        const key = dedupeKey(item);
        if (seen.has(key)) { skipped++; continue; }
        seen.add(key);
        const id = randomUUID();
        batch.set(db.collection(PRIVATE_COLLECTION).doc(id), {
          ...item, id, imagePath: "", publishedAt: "", publishedSlug: "", catalogProductId: "",
          importedAt: item.importedAt || now, updatedAt: now, updatedBy: admin.uid,
        });
        imported++;
      }
      if (imported) await batch.commit();
      sendJson(response, { imported, skipped });
      return;
    }
    if (postAction === "uploadImage") {
      const id = safeId(body.id);
      const ref = db.collection(PRIVATE_COLLECTION).doc(id);
      const snapshot = await ref.get();
      if (!snapshot.exists) throw new SelectionError("Enregistrez d'abord le produit.", 404);
      const encoded = String(body.imageBase64 || "");
      if (encoded.length > 3_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        throw new SelectionError("Image JPEG invalide ou trop volumineuse (2 Mo maximum).");
      }
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length > 2_000_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        throw new SelectionError("Utilisez une image JPEG de 2 Mo maximum.");
      }
      try { await (await PDFDocument.create()).embedJpg(bytes); }
      catch { throw new SelectionError("Le fichier JPEG est illisible."); }
      const path = `selection-images/${id}/${randomUUID()}.jpg`;
      await getAdminStorageBucket().file(path).save(bytes, { contentType: "image/jpeg", resumable: false });
      const updatedAt = new Date().toISOString();
      await ref.update({ imagePath: path, updatedAt, updatedBy: admin.uid });
      sendJson(response, { imagePath: path, updatedAt });
      return;
    }
    if (postAction === "publishCatalog") {
      const id = safeId(body.id);
      const selectionRef = db.collection(PRIVATE_COLLECTION).doc(id);
      const snapshot = await selectionRef.get();
      if (!snapshot.exists) throw new SelectionError("Sélection introuvable.", 404);
      const item = normalizeSelection({ ...snapshot.data(), id });
      const missing = catalogPublicationMissing(item);
      if (missing.length) throw new SelectionError(`Complétez avant la mise en boutique : ${missing.join(", ")}.`);
      const input = normalizeCatalogInput(body.catalog);
      await readImage(item.imagePath);
      const product = buildCatalogProduct(item, input);
      if (item.catalogProductId && item.catalogProductId !== product.id) {
        throw new SelectionError("Un autre produit marchand est déjà lié. Gérez-le dans Produits.", 409);
      }
      const productRef = db.collection("products").doc(product.id);
      const now = new Date().toISOString();
      await db.runTransaction(async (transaction) => {
        const latest = await transaction.get(selectionRef);
        const currentProduct = await transaction.get(productRef);
        if (!latest.exists || latest.data()?.updatedAt !== item.updatedAt || latest.data()?.status !== "En boutique") {
          throw new SelectionError("La sélection a changé. Rechargez et recommencez.", 409);
        }
        if (currentProduct.exists && currentProduct.data()?.sourceSelectionId !== id) {
          throw new SelectionError("Identifiant boutique déjà utilisé.", 409);
        }
        if (currentProduct.data()?.isActive === true) {
          throw new SelectionError("Ce produit est déjà en ligne. Modifiez-le dans Produits.", 409);
        }
        if (currentProduct.exists) {
          transaction.update(productRef, {
            isActive: true, price: input.price, stock: input.stock,
            shortDescription: product.shortDescription, longDescription: product.longDescription,
            seoDescription: product.seoDescription, updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          const internalReference = await reserveProductInternalReference({
            db, transaction, productId: product.id, category: product.category,
          });
          transaction.create(productRef, { ...product, internalReference,
            createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
          });
        }
        transaction.update(selectionRef, { catalogProductId: product.id, updatedAt: now, updatedBy: admin.uid });
      });
      sendJson(response, { productId: product.id, slug: product.slug, category: product.category });
      return;
    }
    if (postAction === "publish") {
      const id = safeId(body.id);
      const ref = db.collection(PRIVATE_COLLECTION).doc(id);
      const snapshot = await ref.get();
      if (!snapshot.exists) throw new SelectionError("Sélection introuvable.", 404);
      const item = normalizeSelection({ ...snapshot.data(), id });
      const missing = publicationMissing(item);
      if (missing.length) throw new SelectionError(`Complétez avant publication : ${missing.join(", ")}.`);
      if (item.catalogProductId) {
        const catalog = await db.collection("products").doc(safeCatalogId(item.catalogProductId)).get();
        if (!catalog.exists || catalog.data()?.isActive !== true) {
          throw new SelectionError("Le produit boutique lié doit être actif avant publication.");
        }
      }
      const slug = selectionSlug(selectionPublicName(item));
      if (!slug || publicBaseSlugs.has(slug)) throw new SelectionError("Ce nom existe déjà dans les fiches publiques.", 409);
      if (item.publishedSlug && item.publishedSlug !== slug) {
        throw new SelectionError("Dépubliez l'ancienne fiche avant de changer son nom public.", 409);
      }
      const publicRef = db.collection(PUBLIC_COLLECTION).doc(slug);
      const image = await readImage(item.imagePath);
      const pdf = await makePdf(item, image);
      const pdfPath = `selection-sheets/${slug}/${randomUUID()}.pdf`;
      await getAdminStorageBucket().file(pdfPath).save(pdf, { contentType: "application/pdf", resumable: false });
      const publishedAt = new Date().toISOString();
      const publicData = publicSelectionEntry(item, slug, pdfPath, publishedAt);
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        const prior = await transaction.get(publicRef);
        if (!current.exists || current.data()?.updatedAt !== item.updatedAt || current.data()?.status !== "En boutique") {
          throw new SelectionError("La sélection a changé pendant la création du PDF. Rechargez et recommencez.", 409);
        }
        if (prior.exists && prior.data()?.selectionId !== id) {
          throw new SelectionError("Cette fiche publique appartient à un autre produit.", 409);
        }
        transaction.set(publicRef, publicData);
        transaction.update(ref, { publishedAt, publishedSlug: slug, updatedAt: publishedAt, updatedBy: admin.uid });
      });
      sendJson(response, { slug, publishedAt, url: `/fiches-produits`, pdfUrl: assetUrl(slug, "pdf") });
      return;
    }
    if (postAction === "unpublish") {
      const id = safeId(body.id);
      const ref = db.collection(PRIVATE_COLLECTION).doc(id);
      const snapshot = await ref.get();
      if (!snapshot.exists) throw new SelectionError("Sélection introuvable.", 404);
      const item = normalizeSelection({ ...snapshot.data(), id });
      if (!item.publishedSlug) { sendJson(response, { ok: true }); return; }
      const batch = db.batch();
      batch.delete(db.collection(PUBLIC_COLLECTION).doc(item.publishedSlug));
      batch.update(ref, { publishedAt: "", publishedSlug: "", updatedBy: admin.uid, updatedAt: new Date().toISOString() });
      await batch.commit();
      sendJson(response, { ok: true });
      return;
    }
    if (postAction === "extract") {
      sendJson(response, { selection: await extractSupplierPage(String(body.url || "")) });
      return;
    }
    throw new SelectionError("Action inconnue.", 400);
  } catch (error) {
    const authFailure = firebaseAuthHttpFailure(error);
    if (authFailure) return sendJson(response, {
      code: authFailure.code,
      error: authFailure.status === 401 ? "Token admin invalide." : "Authentification indisponible.",
    }, authFailure.status);
    const status = error instanceof SelectionError ? error.status : 500;
    if (status === 500) console.error("selection_api_failed", error);
    sendJson(response, { error: error instanceof SelectionError ? error.message : "Opération indisponible." }, status);
  }
}

class SelectionError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function bearerToken(request: VercelRequestLike) {
  const value = request.headers.authorization || "";
  return /^Bearer .+/i.test(value) ? value.slice(7).trim() : "";
}

function parseBody(value: unknown): Record<string, unknown> {
  const body = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SelectionError("Requête invalide.");
  return body as Record<string, unknown>;
}

function safeId(value: unknown) {
  const id = String(value || "");
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new SelectionError("Identifiant invalide.");
  return id;
}

function safeCatalogId(value: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new SelectionError("Identifiant du produit marchand invalide.");
  return value;
}

function dedupeKey(item: ProductSelection) {
  return item.url ? `url:${item.url.replace(/\/$/, "").toLowerCase()}` :
    `name:${item.name.toLowerCase()}:${item.supplier.toLowerCase()}`;
}

async function readImage(path: string) {
  if (!/^selection-images\/[a-zA-Z0-9_-]{8,100}\/[a-f0-9-]{36}\.jpg$/.test(path)) {
    throw new SelectionError("Image de sélection invalide.");
  }
  const [bytes] = await getAdminStorageBucket().file(path).download();
  if (bytes.length > 2_000_000) throw new SelectionError("Image trop volumineuse.");
  return bytes;
}

function assetUrl(slug: string, kind: "pdf" | "image") {
  return `/api/selection?action=asset&slug=${encodeURIComponent(slug)}&kind=${kind}`;
}

async function makePdf(item: ProductSelection, image: Buffer) {
  try { return await createSelectionPdf(item, image); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("Texte trop long pour le PDF")) {
      throw new SelectionError(`${error.message}. Raccourcissez ce champ avant publication.`);
    }
    throw error;
  }
}

async function sendPublicLibrary(response: VercelResponseLike) {
  const snapshot = await getAdminDb().collection(PUBLIC_COLLECTION).where("published", "==", true).limit(200).get();
  const sheets = snapshot.docs.map((doc) => publicSelectionView({ ...doc.data(), slug: doc.id } as PublishedSelectionSheet));
  response.setHeader("Cache-Control", "no-store");
  sendJson(response, { sheets });
}

async function sendPublicAsset(response: VercelResponseLike, slug: string, kind: string) {
  if (!/^[a-z0-9-]{1,60}$/.test(slug) || !["pdf", "image"].includes(kind)) {
    throw new SelectionError("Fiche introuvable.", 404);
  }
  const snapshot = await getAdminDb().collection(PUBLIC_COLLECTION).doc(slug).get();
  if (!snapshot.exists || snapshot.data()?.published !== true) throw new SelectionError("Fiche introuvable.", 404);
  const path = String(snapshot.data()?.[kind === "pdf" ? "pdfPath" : "imagePath"] || "");
  if (kind === "pdf" && !/^selection-sheets\/[a-z0-9-]{1,60}\/[a-f0-9-]{36}\.pdf$/.test(path)) {
    throw new SelectionError("PDF indisponible.", 404);
  }
  if (kind === "image" && !/^selection-images\/[a-zA-Z0-9_-]{8,100}\/[a-f0-9-]{36}\.jpg$/.test(path)) {
    throw new SelectionError("Image indisponible.", 404);
  }
  const [bytes] = await getAdminStorageBucket().file(path).download();
  response.setHeader("Content-Type", kind === "pdf" ? "application/pdf" : "image/jpeg");
  response.setHeader("Cache-Control", "no-store");
  response.end(bytes);
}

async function extractSupplierPage(input: string) {
  let url: URL;
  try { url = new URL(input); } catch { throw new SelectionError("Lien fournisseur invalide."); }
  supplierUrl(url);
  let result: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    result = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(12000), headers: {
      "User-Agent": "Mozilla/5.0 VerdanzaSelection/1.0", "Accept-Language": "fr-FR,fr;q=0.9",
    } });
    if (![301, 302, 303, 307, 308].includes(result.status)) break;
    const location = result.headers.get("location");
    if (!location) throw new SelectionError("Redirection fournisseur invalide.");
    url = new URL(location, url);
    supplierUrl(url);
    result = null;
  }
  if (!result || !result.ok || !/text\/html/i.test(result.headers.get("content-type") || "")) {
    throw new SelectionError("Fiche fournisseur indisponible.");
  }
  if (Number(result.headers.get("content-length") || 0) > 2_000_000) throw new SelectionError("Page fournisseur trop volumineuse.");
  const html = await readLimitedHtml(result, 2_000_000);
  return parseSupplierHtml(html, url);
}

function supplierUrl(url: URL) {
  const allowed = ["originecbd.fr", "legrossisteducbd.shop", "legrossisteducbd.com"];
  if (url.protocol !== "https:" || !allowed.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new SelectionError("Import par lien disponible pour originecbd.fr et legrossisteducbd. Autre fournisseur : saisie manuelle ou import JSON.");
  }
  if (url.username || url.password || url.port) throw new SelectionError("Lien fournisseur invalide.");
}

async function readLimitedHtml(response: Response, maximum: number) {
  if (!response.body) throw new SelectionError("Page fournisseur vide.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new SelectionError("Page fournisseur trop volumineuse."); }
    chunks.push(value);
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: false }).decode(combined);
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
        (node["@type"] === "Product" || (Array.isArray(node["@type"]) && node["@type"].includes("Product"))));
      if (found) { product = found; break; }
    } catch { /* Ignore malformed supplier JSON-LD. */ }
  }
  const name = plainText(product.name || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    || meta("og:title") || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  if (!name) throw new SelectionError("Nom du produit introuvable ; utilisez la saisie manuelle.");
  const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  const price = offer && typeof offer === "object" ? String((offer as Record<string, unknown>).price || "") : "";
  const image = Array.isArray(product.image) ? product.image[0] : product.image;
  const rawImage = typeof image === "string" ? image : meta("og:image");
  const imageUrl = rawImage ? new URL(rawImage, url).href : "";
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
    const offers = Array.isArray(product.offers) ? product.offers : product.offers ? [product.offers] : [];
    for (const candidate of offers.slice(0, 30)) {
      if (!candidate || typeof candidate !== "object") continue;
      const offerRow = candidate as Record<string, unknown>;
      const offerPrice = parsePrice(offerRow.price ?? offerRow.lowPrice);
      if (offerPrice) prices.push({ format: plainText(offerRow.name || "Prix affiché"), price: offerPrice });
    }
  }
  if (!prices.length && price) prices.push({ format: "Format à vérifier", price: parsePrice(price) });
  return normalizeSelection({
    name, url: url.href, supplier: url.hostname.replace(/^www\./, ""), category,
    molecule: name.match(/\b(THC-?X|THCX|CBD|CBN|CBG|CPR)\b/i)?.[0]?.toUpperCase() || "",
    rate: name.match(/\b\d+(?:[,.]\d+)?\s*%/)?.[0] || "",
    origin: attributes.provenance || "", culture: attributes["type de culture"] || "",
    aromas: attributes["arômes"] || "",
    attributes: Object.fromEntries(Object.entries(attributes).filter(([key]) =>
      ["terpènes", "arômes", "génétique", "taille des buds"].includes(key))),
    description: plainText(product.description || meta("description") || meta("og:description")),
    imageUrl, prices,
  });
}

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
    if (/^&#x/i.test(entity)) return String.fromCodePoint(Number.parseInt(entity.slice(3, -1), 16));
    if (/^&#/i.test(entity)) return String.fromCodePoint(Number.parseInt(entity.slice(2, -1), 10));
    return ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " } as Record<string, string>)[entity.toLowerCase()] || entity;
  });
}
