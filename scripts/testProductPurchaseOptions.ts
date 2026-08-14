import {
  cartProductQuantityGrams,
  remainingProductStock,
  resolveProductPurchaseOptions,
} from "../src/lib/productPurchaseOptions.js";
import type { CartItem, Product } from "../src/types/index.js";

type TestCase = {
  name: string;
  run: () => void;
};

const tests: TestCase[] = [];

function test(name: string, run: () => void) {
  tests.push({ name, run });
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function availability(stock: number, cartItems: CartItem[] = []) {
  return Object.fromEntries(
    resolveProductPurchaseOptions(product({ stock }), cartItems).map((option) => [
      option.quantityGrams,
      option.available,
    ]),
  );
}

test("stock suffisant et plusieurs formats disponibles", () => {
  const options = availability(11);
  expect(options[1] === true, "le gramme doit etre disponible");
  expect(options[7] === true, "le format 7 g doit etre disponible");
  expect(options[9] === true, "le format 9 g doit etre disponible");
  expect(options[11] === true, "le format 11 g doit etre disponible");
});

test("stock exactement egal au format", () => {
  const options = availability(7);
  expect(options[7] === true, "le format egal au stock doit etre disponible");
  expect(options[9] === false, "le format superieur au stock doit etre indisponible");
});

test("seuls les formats tenant dans 8 g restent disponibles", () => {
  const options = availability(8);
  expect(options[1] === true, "le gramme doit etre disponible");
  expect(options[7] === true, "le format 7 g doit etre disponible");
  expect(options[9] === false, "le format 9 g doit etre indisponible");
  expect(options[11] === false, "le format 11 g doit etre indisponible");
});

test("stock inferieur au format", () => {
  const options = availability(6);
  expect(options[1] === true, "l'achat au gramme doit rester disponible");
  expect(options[7] === false, "le format 7 g doit etre indisponible avec 6 g");
});

test("rupture totale", () => {
  const options = availability(0);
  expect(
    Object.values(options).every((available) => available === false),
    "tous les formats doivent etre indisponibles avec 0 g",
  );
});

test("le panier au gramme reduit le stock achetable", () => {
  const options = availability(8, [
    { productId: "resin-stock-test", quantity: 1, purchaseMode: "gram" },
  ]);
  expect(options[1] === true, "le gramme doit rester disponible avec 7 g restants");
  expect(options[7] === true, "le format 7 g doit etre disponible avec exactement 7 g restants");
  expect(options[9] === false, "le format 9 g doit etre indisponible");
  expect(options[11] === false, "le format 11 g doit etre indisponible");
});

test("un format fixe dans le panier reduit aussi le stock achetable", () => {
  const cartItems: CartItem[] = [
    {
      productId: "resin-stock-test",
      quantity: 1,
      purchaseMode: "fixed_price",
      fixedPriceOptionId: "format-7g",
    },
  ];
  const stockProduct = product({ stock: 8 });
  const options = resolveProductPurchaseOptions(stockProduct, cartItems);
  expect(cartProductQuantityGrams(stockProduct, cartItems) === 7, "le format doit reserver 7 g");
  expect(remainingProductStock(stockProduct, cartItems) === 1, "il doit rester 1 g");
  expect(options.find((option) => option.quantityGrams === 1)?.available, "le gramme doit rester disponible");
  expect(
    options.find((option) => option.quantityGrams === 7)?.available === false,
    "un second format 7 g doit etre indisponible",
  );
});

test("les achats au gramme et au format fixe partagent le meme stock", () => {
  const options = availability(8, [
    { productId: "resin-stock-test", quantity: 1, purchaseMode: "gram" },
    {
      productId: "resin-stock-test",
      quantity: 1,
      purchaseMode: "fixed_price",
      fixedPriceOptionId: "format-7g",
    },
  ]);
  expect(
    Object.values(options).every((available) => available === false),
    "aucun achat supplementaire ne doit etre propose lorsque les 8 g sont reserves",
  );
});

test("la mise a jour d'une ligne exclut sa propre quantite mais conserve les autres", () => {
  const stockProduct = product({ stock: 8 });
  const cartItems: CartItem[] = [
    { productId: stockProduct.id, quantity: 1, purchaseMode: "gram" },
    {
      productId: stockProduct.id,
      quantity: 1,
      purchaseMode: "fixed_price",
      fixedPriceOptionId: "format-7g",
    },
  ];
  expect(
    remainingProductStock(stockProduct, cartItems, `${stockProduct.id}:fixed_price:format-7g`) === 7,
    "la ligne fixe doit pouvoir conserver un exemplaire, sans ignorer le gramme reserve",
  );
});

for (const entry of tests) {
  entry.run();
  console.log(`ok - ${entry.name}`);
}

console.log(`${tests.length} product purchase option tests passed.`);

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "resin-stock-test",
    slug: "resin-stock-test",
    name: "Resine stock test",
    category: "resins",
    price: 6,
    shortDescription: "Resine CBD.",
    longDescription: "Resine CBD.",
    image: "/images/resin.webp",
    cbdRate: "50 %",
    cbgRate: "Non communique",
    thcRate: "< 0,3 %",
    origin: "France",
    cultureType: "Autre",
    aromas: ["Floral"],
    tags: ["resine"],
    stock: 11,
    lowStockThreshold: 5,
    isActive: true,
    isFeatured: false,
    fixedPriceMode: "manual",
    fixedPriceOptions: [
      { id: "format-7g", totalPrice: 40, quantityGrams: 7, isActive: true },
      { id: "format-9g", totalPrice: 50, quantityGrams: 9, isActive: true },
      { id: "format-11g", totalPrice: 60, quantityGrams: 11, isActive: true },
    ],
    seoTitle: "Resine stock test",
    seoDescription: "Resine stock test.",
    ...overrides,
  };
}
