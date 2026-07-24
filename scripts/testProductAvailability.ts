import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getCartLineStockIssue,
  isProductOrderable,
  publicProductStockLabel,
} from "../src/lib/cartStock.js";
import { productAvailability } from "../src/lib/structuredData.js";
import { normalizeProduct } from "../src/services/productsService.js";
import { priceCheckout, type CheckoutRequestBody } from "../api/_server/checkout.js";
import type { Product } from "../src/types/index.js";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const tests: TestCase[] = [];

function test(name: string, run: TestCase["run"]) {
  tests.push({ name, run });
}

function expect(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function product(overrides: Partial<Product> & Record<string, unknown> = {}): Product {
  return {
    id: "flower-amnesia-cbd-hydroponique",
    slug: "amnesia-cbd-hydroponique",
    name: "Amnesia CBD Hydroponique",
    category: "flowers",
    price: 7,
    shortDescription: "Fleur CBD hydroponique.",
    longDescription: "Fleur CBD hydroponique.",
    image: "/images/amnesia.webp",
    cbdRate: "Non communique",
    cbgRate: "Non communique",
    thcRate: "Inferieur au seuil legal",
    origin: "Italie",
    cultureType: "Hydroponique",
    aromas: ["Boise"],
    tags: ["fleur"],
    stock: 22,
    lowStockThreshold: 5,
    isActive: true,
    isFeatured: false,
    seoTitle: "Amnesia CBD Hydroponique",
    seoDescription: "Amnesia CBD Hydroponique.",
    ...overrides,
  } as Product;
}

test("active product with positive stock is available and orderable", () => {
  const normalized = normalizeProduct(
    product({
      comingSoon: true,
      stockStatus: "coming_soon",
      stockLabel: ["En arrivage", "chez Verdanza"].join(" "),
      seoDescription: `Amnesia CBD Hydroponique. ${["En arrivage", "chez Verdanza"].join(" ")}.`,
    }),
  );

  expect(isProductOrderable(normalized), "expected active product with stock to be orderable");
  expect(publicProductStockLabel(normalized) === "Disponible", "expected Disponible label");
  expect(productAvailability(normalized) === "https://schema.org/InStock", "expected InStock JSON-LD");
  expect(!("comingSoon" in normalized), "legacy comingSoon field must be stripped");
  expect(!("stockStatus" in normalized), "legacy stockStatus field must be stripped");
  expect(!("stockLabel" in normalized), "legacy stockLabel field must be stripped");
  expect(!normalized.seoDescription.includes("En arrivage"), "legacy SEO label must be stripped");
  expect(!normalized.seoDescription.includes(".."), "legacy SEO cleanup must not leave double punctuation");
  expect(
    normalized.seoDescription === "Amnesia CBD Hydroponique.",
    `unexpected cleaned SEO description: ${normalized.seoDescription}`,
  );
});

test("legacy availability cleanup keeps product meta descriptions punctuated cleanly", () => {
  const legacyLabel = ["En arrivage", "chez Verdanza"].join(" ");
  const normalized = normalizeProduct(
    product({
      shortDescription: `Blue Dream CBD hydroponique. ${legacyLabel}.`,
      longDescription: `Creamy Piatella CBD. ${legacyLabel}. Résine travaillée.`,
      seoDescription: `Le Beldia CBN + CBD, profil terreux et boisé. ${legacyLabel}.`,
    }),
  );

  for (const value of [
    normalized.shortDescription,
    normalized.longDescription,
    normalized.seoDescription,
  ]) {
    expect(!value.includes(legacyLabel), "legacy label must be removed from product descriptions");
    expect(!/[.!?]{2,}/.test(value), `description has repeated sentence punctuation: ${value}`);
    expect(!/[,;:]{2,}/.test(value), `description has repeated separator punctuation: ${value}`);
    expect(!/\s+[.,;:!?]/.test(value), `description has a space before punctuation: ${value}`);
  }
  expect(
    normalized.longDescription === "Creamy Piatella CBD. Résine travaillée.",
    `unexpected cleaned long description: ${normalized.longDescription}`,
  );
  expect(
    normalized.seoDescription === "Le Beldia CBN + CBD, profil terreux et boisé.",
    `unexpected cleaned meta description: ${normalized.seoDescription}`,
  );
});

test("active product with zero stock is out of stock and not orderable", () => {
  const normalized = normalizeProduct(product({ stock: 0 }));
  const issue = getCartLineStockIssue({
    productId: normalized.id,
    product: normalized,
    quantity: 1,
  });

  expect(!isProductOrderable(normalized), "expected zero-stock product to be blocked");
  expect(publicProductStockLabel(normalized) === "Rupture de stock", "expected rupture label");
  expect(productAvailability(normalized) === "https://schema.org/OutOfStock", "expected OutOfStock JSON-LD");
  expect(issue?.message.includes("Rupture de stock"), "expected cart issue to use rupture label");
});

test("inactive product is unavailable and not orderable", () => {
  const normalized = normalizeProduct(product({ isActive: false, stock: 22 }));

  expect(!isProductOrderable(normalized), "expected inactive product to be blocked");
  expect(publicProductStockLabel(normalized) === "Indisponible", "expected unavailable label");
  expect(productAvailability(normalized) === "https://schema.org/OutOfStock", "expected OutOfStock JSON-LD");
});

test("admin refresh updates product availability without stale local state", () => {
  const before = normalizeProduct(product({ stock: 0 }));
  const after = normalizeProduct(product({ stock: 22 }));

  expect(publicProductStockLabel(before) === "Rupture de stock", "expected initial rupture label");
  expect(publicProductStockLabel(after) === "Disponible", "expected refreshed availability label");
  expect(isProductOrderable(after), "expected refreshed product to become orderable");
});

test("checkout accepts active positive-stock product despite legacy fields", async () => {
  const priced = await priceCheckout(
    fakeDb({
      products: {
        "flower-amnesia-cbd-hydroponique": product({
          price: 20,
          comingSoon: true,
          stockStatus: "coming_soon",
          stockLabel: ["En arrivage", "chez Verdanza"].join(" "),
        }),
      },
    }),
    checkoutBody("flower-amnesia-cbd-hydroponique"),
  );

  expect(priced.orderItems[0]?.name === "Amnesia CBD Hydroponique", "expected checkout product line");
  expect(priced.subtotal === 20, "expected checkout to use Firestore product price");
});

test("checkout rejects zero stock and inactive products", async () => {
  await expectRejects(
    () =>
      priceCheckout(
        fakeDb({ products: { unavailable: product({ id: "unavailable", stock: 0 }) } }),
        checkoutBody("unavailable"),
      ),
    "Stock insuffisant",
  );

  await expectRejects(
    () =>
      priceCheckout(
        fakeDb({ products: { inactive: product({ id: "inactive", isActive: false }) } }),
        checkoutBody("inactive"),
      ),
    "Produit inactif refuse",
  );
});

test("removed public label is absent from application sources", () => {
  const forbiddenLabel = ["En arrivage", "chez Verdanza"].join(" ");
  const files = [
    "src/data/products.ts",
    "src/components/ProductCard.tsx",
    "src/pages/ProductPage.tsx",
    "src/lib/cartStock.ts",
    "src/pages/account/AccountFavoritesPage.tsx",
    "api/_server/checkout.ts",
    "api/create-order.ts",
  ];

  for (const file of files) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(!source.includes(forbiddenLabel), `${forbiddenLabel} still found in ${file}`);
  }
});

function checkoutBody(productId: string): CheckoutRequestBody {
  return {
    items: [{ productId, quantity: 1 }],
    deliveryMethod: "postal",
    deliveryZone: "postal-france",
    complianceAccepted: true,
    customer: {
      email: "client@example.com",
      phone: "0600000000",
      firstName: "Client",
      lastName: "Test",
      address: {
        firstName: "Client",
        lastName: "Test",
        line1: "1 rue Test",
        postalCode: "13090",
        city: "Aix-en-Provence",
        country: "France",
      },
    },
  };
}

function fakeDb(data: {
  products?: Record<string, Product>;
  coupons?: Record<string, unknown>;
  deliveryZones?: Record<string, unknown>;
}) {
  const collections = {
    products: data.products ?? {},
    coupons: data.coupons ?? {},
    deliveryZones: {
      "postal-france": {
        id: "postal-france",
        name: "Livraison postale en France",
        method: "postal",
        isActive: true,
        fee: 0,
        minimumOrder: 0,
        estimatedDelay: "Expedition",
        slots: ["Expedition"],
      },
      ...(data.deliveryZones ?? {}),
    },
  } as Record<string, Record<string, unknown>>;

  return {
    collection(name: string) {
      const entries = collections[name] ?? {};
      return {
        doc(id: string) {
          return {
            async get() {
              const value = entries[id];
              return {
                id,
                exists: Boolean(value),
                data: () => value,
              };
            },
          };
        },
        async get() {
          return {
            docs: Object.entries(entries).map(([id, value]) => ({
              id,
              data: () => value,
            })),
          };
        },
      };
    },
  } as FirebaseFirestore.Firestore;
}

async function expectRejects(run: () => Promise<unknown>, expectedMessage: string) {
  try {
    await run();
  } catch (error) {
    expect(
      error instanceof Error && error.message.includes(expectedMessage),
      `expected rejection including "${expectedMessage}"`,
    );
    return;
  }
  throw new Error(`expected rejection including "${expectedMessage}"`);
}

for (const entry of tests) {
  await entry.run();
  console.log(`ok - ${entry.name}`);
}

console.log(`${tests.length} catalog availability tests passed.`);
