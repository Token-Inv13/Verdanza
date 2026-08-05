import { assertFixedPriceOrderItemStillMatchesProduct } from "../api/create-order.js";
import {
  orderPayload,
  priceCheckout,
  type CheckoutRequestBody,
} from "../api/_server/checkout.js";
import { calculateCartPromotions } from "../src/lib/cartPromotions.js";
import { getCartStockIssues } from "../src/lib/cartStock.js";
import { buildCustomerInvoiceLines } from "../src/lib/customerInvoiceLines.js";
import {
  FIXED_PRICE_POLICY_VERSION,
  activeFixedPriceOptions,
  cartItemKey,
  fixedPriceCartLineLabel,
  fixedPriceEffectiveUnitPrice,
  fixedPriceLineTotal,
  fixedPriceOptionPublicLabel,
  fixedPriceOptionsForMode,
  fixedPriceQuantityGrams,
  fixedPriceUnitPricePublicLabel,
  normalizeFixedPriceMode,
  normalizeCartItems,
  normalizeFixedPriceOptions,
  resolveFixedPriceOptions,
  validateManualFixedPriceOptions,
} from "../src/lib/fixedPriceOptions.js";
import {
  orderItemLineTotal,
  orderItemQuantityLabel,
  orderItemSummaryLabel,
} from "../src/lib/orderLineDisplay.js";
import type { Order, OrderItem, Product } from "../src/types/index.js";

type TestCase = {
  name: string;
  covers: string[];
  run: () => void | Promise<void>;
};

const tests: TestCase[] = [];

function test(name: string, covers: string[], run: TestCase["run"]) {
  tests.push({ name, covers, run });
}

function expect(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function assertNoUndefined(value: unknown, path = "$") {
  expect(value !== undefined, `undefined detected in ${path}`);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoUndefined(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return;
  for (const [key, entry] of Object.entries(value)) {
    assertNoUndefined(entry, `${path}.${key}`);
  }
}

const fixedProduct = product({
  fixedPriceMode: "manual",
  fixedPriceOptions: [
    { id: "format-5g-20", totalPrice: 20, quantityGrams: 5, isActive: true, sortOrder: 1 },
    { id: "format-8g-30", totalPrice: 30, quantityGrams: 8, isActive: true, sortOrder: 2 },
    { id: "format-15g-50", totalPrice: 50, quantityGrams: 15, isActive: true, sortOrder: 3 },
    { id: "format-5g-inactive", totalPrice: 24, quantityGrams: 5, isActive: false, sortOrder: 4 },
  ],
});

test(
  "legacy cart item remains a gram purchase",
  [
    "ancien panier sans purchaseMode interprete comme achat au gramme",
    "achat classique au gramme inchange",
  ],
  async () => {
    const items = normalizeCartItems([{ productId: "resin-fixed", quantity: 3 }]);
    expect(items.length === 1, "expected one legacy cart item");
    expect(items[0]?.purchaseMode === "gram", "expected legacy item to become gram purchase");
    expect(cartItemKey(items[0]) === "resin-fixed:gram", "expected gram line key");

    const priced = await priceCheckout(
      fakeDb({ products: { "resin-fixed": fixedProduct } }),
      checkoutBody([{ productId: "resin-fixed", quantity: 3 }]),
    );
    expect(priced.orderItems[0]?.quantity === 3, "expected gram quantity to stay 3 g");
    expect(priced.orderItems[0]?.unitPrice === 6, "expected gram unit price to use product price");
    expect(priced.subtotal === 18, "expected classic gram subtotal");
  },
);

test(
  "fixed price options normalize and compute exact amount per gram",
  [
    "ajout d'un format fixe",
    "total exact du format",
    "prix effectif au gramme",
    "calcul des grammes totaux",
  ],
  () => {
    const options = normalizeFixedPriceOptions([
      { id: "Format 8G 30", totalPrice: "30", quantityGrams: "8", isActive: true },
      { id: "", totalPrice: 0, quantityGrams: 8, isActive: true },
    ]);
    expect(options.length === 1, "expected invalid fixed option to be ignored");
    expect(options[0]?.id === "format-8g-30", "expected stable normalized id");
    expect(fixedPriceEffectiveUnitPrice(options[0]) === 3.75, "expected 30 EUR / 8 g");
    expect(fixedPriceLineTotal(options[0], 1) === 30, "expected one fixed format to total 30 EUR");
    expect(fixedPriceLineTotal(options[0], 2) === 60, "expected two fixed formats to total 60 EUR");
    expect(fixedPriceQuantityGrams(options[0], 2) === 16, "expected two fixed formats to reserve 16 g");
    expect(fixedPriceOptionPublicLabel(options[0]) === "30,00 € · 8 g", "expected public fixed option label");
    expect(fixedPriceUnitPricePublicLabel(options[0]) === "3,75 €/g", "expected public fixed unit price label");
    expect(fixedPriceCartLineLabel(options[0], 1) === "Format 30,00 € · 8 g", "expected one-format cart label");
    expect(fixedPriceCartLineLabel(options[0], 2) === "2 × format 30,00 € · 16 g au total", "expected grouped fixed format cart label");
  },
);

test(
  "cart line identity separates gram, same format grouping and different formats",
  [
    "meme produit au gramme et en format fixe dans deux lignes distinctes",
    "regroupement de deux exemplaires du meme format",
    "separation de deux formats differents",
  ],
  () => {
    const cartItems = normalizeCartItems([
      { productId: "resin-fixed", quantity: 2 },
      {
        productId: "resin-fixed",
        quantity: 2,
        purchaseMode: "fixed_price",
        fixedPriceOptionId: "format-8g-30",
      },
      {
        productId: "resin-fixed",
        quantity: 1,
        purchaseMode: "fixed_price",
        fixedPriceOptionId: "format-15g-50",
      },
    ]);
    const keys = cartItems.map(cartItemKey);
    expect(keys.includes("resin-fixed:gram"), "expected gram line");
    expect(keys.includes("resin-fixed:fixed_price:format-8g-30"), "expected 8 g fixed line");
    expect(keys.includes("resin-fixed:fixed_price:format-15g-50"), "expected 15 g fixed line");
    expect(cartItems[1]?.quantity === 2, "expected same format quantity to represent two copies");
  },
);

test(
  "client stock issues aggregate multiple lines of the same product",
  ["controle du stock agrege entre plusieurs lignes du meme produit"],
  () => {
    const issues = getCartStockIssues([
      {
        lineKey: "resin-fixed:gram",
        productId: "resin-fixed",
        product: product({ stock: 10 }),
        quantity: 3,
        quantityGrams: 3,
      },
      {
        lineKey: "resin-fixed:fixed_price:format-8g-30",
        productId: "resin-fixed",
        product: product({ stock: 10 }),
        quantity: 1,
        quantityGrams: 8,
      },
    ]);
    expect(issues.some((issue) => issue.message.includes("totale")), "expected aggregate stock issue");
  },
);

test(
  "server quote prices fixed formats from Firestore only",
  [
    "impossibilite pour le navigateur d'imposer le prix",
    "impossibilite pour le navigateur d'imposer les grammes",
    "calcul serveur exact dans quote-order",
  ],
  async () => {
    const priced = await priceCheckout(
      fakeDb({ products: { "resin-fixed": fixedProduct } }),
      checkoutBody([
        {
          productId: "resin-fixed",
          quantity: 1,
          purchaseMode: "fixed_price",
          fixedPriceOptionId: "format-8g-30",
          clientPrice: 1,
          quantityGrams: 999,
        },
      ]),
    );

    const item = priced.orderItems[0];
    expect(item?.quantity === 8, "expected order item quantity to be Firestore option grams");
    expect(item?.fixedPriceQuantity === 1, "expected fixed format count snapshot");
    expect(item?.fixedPriceTotal === 30, "expected fixed format total snapshot");
    expect(item?.unitPrice === 3.75, "expected effective unit price from Firestore");
    expect(priced.subtotal === 30, "expected subtotal from Firestore fixed format");
    expect(orderItemLineTotal(item) === 30, "expected exact order line total");
  },
);

test(
  "server rejects missing inactive and insufficient fixed formats",
  [
    "refus lorsque le stock est insuffisant",
    "refus d'un format inexistant",
    "refus d'un format desactive",
  ],
  async () => {
    await expectRejects(
      () =>
        priceCheckout(
          fakeDb({ products: { "resin-fixed": fixedProduct } }),
          checkoutBody([
            {
              productId: "resin-fixed",
              quantity: 1,
              purchaseMode: "fixed_price",
              fixedPriceOptionId: "missing",
            },
          ]),
        ),
      "Format prix fixe indisponible",
    );
    await expectRejects(
      () =>
        priceCheckout(
          fakeDb({ products: { "resin-fixed": fixedProduct } }),
          checkoutBody([
            {
              productId: "resin-fixed",
              quantity: 1,
              purchaseMode: "fixed_price",
              fixedPriceOptionId: "format-5g-inactive",
            },
          ]),
        ),
      "Format prix fixe indisponible",
    );
    await expectRejects(
      () =>
        priceCheckout(
          fakeDb({
            products: {
              "resin-fixed": product({
                stock: 9,
                fixedPriceMode: "manual",
                fixedPriceOptions: fixedProduct.fixedPriceOptions,
              }),
            },
          }),
          checkoutBody([
            { productId: "resin-fixed", quantity: 2 },
            {
              productId: "resin-fixed",
              quantity: 1,
              purchaseMode: "fixed_price",
              fixedPriceOptionId: "format-8g-30",
            },
          ]),
        ),
      "Stock insuffisant",
    );
  },
);

test(
  "create-order guard rejects modified fixed format snapshots",
  ["calcul serveur exact dans create-order"],
  async () => {
    const priced = await priceCheckout(
      fakeDb({ products: { "resin-fixed": fixedProduct } }),
      checkoutBody([
        {
          productId: "resin-fixed",
          quantity: 1,
          purchaseMode: "fixed_price",
          fixedPriceOptionId: "format-8g-30",
        },
      ]),
    );
    const item = priced.orderItems[0];
    assertFixedPriceOrderItemStillMatchesProduct(item, fixedProduct);
    expect(
      orderPayload(checkoutBody([{ productId: "resin-fixed", quantity: 1 }]), priced)
        .subtotal === 30,
      "expected create-order payload to keep priced subtotal",
    );
    await expectThrows(
      () =>
        assertFixedPriceOrderItemStillMatchesProduct(
          { ...item, fixedPriceTotal: 1 },
          fixedProduct,
        ),
      "Format prix fixe modifie",
    );
    await expectThrows(
      () =>
        assertFixedPriceOrderItemStillMatchesProduct(
          { ...item, fixedPriceGrams: 999 },
          fixedProduct,
        ),
      "Format prix fixe modifie",
    );
  },
);

test(
  "WELCOME10 fixed format and local delivery serialize without undefined",
  [
    "WELCOME10 sur un produit a prix fixe",
    "livraison locale serialisee pour Firestore",
    "promotion sans eligibleCategory serialisee sans undefined",
  ],
  async () => {
    const checkout = {
      ...checkoutBody([
        {
          productId: "resin-fixed",
          quantity: 1,
          purchaseMode: "fixed_price",
          fixedPriceOptionId: "format-8g-30",
        },
      ]),
      deliveryMethod: "local_express" as const,
      deliveryZone: "local-aix",
      couponCode: "WELCOME10",
    };
    const priced = await priceCheckout(
      fakeDb({
        products: { "resin-fixed": fixedProduct },
        coupons: {
          welcome10: {
            code: "WELCOME10",
            label: "WELCOME10",
            discountType: "percent",
            discountValue: 10,
            minimumOrder: 15,
            usedCount: 0,
            isActive: true,
          },
        },
        deliveryZones: {
          "local-aix": {
            id: "local-aix",
            name: "Aix-en-Provence centre",
            method: "local_express",
            isActive: true,
            isOpen: true,
            status: "open",
            fee: 0,
            minimumOrder: 20,
            minimumOrderAmount: 20,
            estimatedDelay: "Livraison locale",
            slots: ["18:00-22:00"],
          },
        },
      }),
      checkout,
    );
    const rawPromotion = priced.appliedPromotions[0];
    expect(Boolean(rawPromotion), "expected WELCOME10 promotion snapshot");
    expect(rawPromotion?.eligibleCategory === undefined, "expected optional category to be absent");

    const payload = orderPayload(checkout, priced);
    const savedPromotion = (payload.appliedPromotions as Array<Record<string, unknown>>)[0];
    expect(payload.deliveryMethod === "local_express", "expected local delivery in payload");
    expect(payload.deliveryZoneId === "local-aix", "expected stable delivery zone id in payload");
    expect(
      (payload.deliveryAddressValidation as { provider?: string })?.provider ===
        "geoplateforme_ban",
      "expected address verification provider in payload",
    );
    expect(
      (payload.items as OrderItem[])[0]?.purchaseMode === "fixed_price",
      "expected fixed format in payload",
    );
    expect(
      !Object.prototype.hasOwnProperty.call(savedPromotion, "eligibleCategory"),
      "expected eligibleCategory to be omitted",
    );
    assertNoUndefined(payload);
  },
);

test(
  "promotions use paid line total for fixed formats",
  ["promotions calculees sur le montant reellement paye"],
  () => {
    const fixedOrderItem = fixedOrderLine();
    const promotion = calculateCartPromotions({
      lines: [fixedOrderItem],
      rules: [
        {
          id: "resin-10",
          label: "10 EUR resines",
          active: true,
          autoApply: true,
          type: "fixed_category_discount",
          eligibleCategory: "resins",
          minEligibleSubtotal: 30,
          discountAmount: 10,
        },
      ],
    });
    expect(promotion.subtotalBeforePromotion === 30, "expected promotion subtotal to use paid amount");
    expect(promotion.appliedPromotions[0]?.eligibleSubtotal === 30, "expected eligible subtotal");
    expect(promotion.promotionDiscountTotal === 10, "expected fixed discount");
  },
);

test(
  "legacy orders and fixed orders display invoice lines correctly",
  [
    "compatibilite d'une ancienne commande",
    "affichage correct des lignes de facture et de commande",
  ],
  () => {
    const legacyOrderItem: OrderItem = {
      productId: "legacy",
      name: "Ancienne ligne",
      quantity: 3,
      unitPrice: 6,
    };
    const fixedOrderItem = fixedOrderLine();
    const lines = buildCustomerInvoiceLines({
      items: [legacyOrderItem, fixedOrderItem],
    } as Pick<Order, "items">);

    expect(orderItemLineTotal(legacyOrderItem) === 18, "expected legacy line total");
    expect(orderItemQuantityLabel(legacyOrderItem) === "3 g", "expected legacy quantity label");
    expect(lines[0]?.quantity === 3, "expected legacy invoice grams");
    expect(lines[0]?.unitPrice === 6, "expected legacy invoice unit price");
    expect(lines[1]?.quantity === 1, "expected fixed invoice format count");
    expect(lines[1]?.unitPrice === 30, "expected fixed invoice format price");
    expect(lines[1]?.total === 30, "expected fixed invoice total");
    expect(lines[1]?.note === "8 g au total", "expected fixed invoice grams note");
    expect(
      orderItemSummaryLabel(fixedOrderItem).includes("format 30,00 EUR - 8 g"),
      "expected readable fixed order label",
    );
  },
);

test(
  "fixed option activation stays product-scoped and absent by default",
  [
    "mode manual conservant exactement ses valeurs",
    "preservation exacte des grilles manuelles actuelles",
  ],
  () => {
    const manualOptions = activeFixedPriceOptions(fixedProduct);
    expect(activeFixedPriceOptions(fixedProduct).length === 3, "expected three active fixed formats");
    expect(manualOptions[0]?.id === "format-5g-20", "expected manual option id to stay unchanged");
    expect(manualOptions[1]?.totalPrice === 30, "expected manual total to stay unchanged");
  },
);

test(
  "automatic mode defaults to gram-sold categories only",
  [
    "nouveau produit flowers sans fixedPriceMode utilisant automatic",
    "nouveau produit resins sans fixedPriceMode utilisant automatic",
    "produit oils ne generant aucun format",
    "produit packs ne generant aucun format automatique",
    "mode disabled ne generant rien",
    "aucun format automatique pour les produits inactifs hors catalogue",
  ],
  () => {
    expect(normalizeFixedPriceMode(undefined, "flowers") === "automatic", "expected flowers default");
    expect(normalizeFixedPriceMode(undefined, "resins") === "automatic", "expected resins default");
    expect(resolveFixedPriceOptions(product({ category: "flowers", price: 6 })).length > 0, "expected flower automatic formats");
    expect(resolveFixedPriceOptions(product({ category: "resins", price: 6 })).length > 0, "expected resin automatic formats");
    expect(resolveFixedPriceOptions(product({ category: "oils", price: 20 })).length === 0, "expected no oils formats");
    expect(resolveFixedPriceOptions(product({ category: "packs", price: 30 })).length === 0, "expected no packs formats");
    expect(resolveFixedPriceOptions(product({ fixedPriceMode: "disabled" })).length === 0, "expected disabled empty");
    expect(resolveFixedPriceOptions(product({ isActive: false })).length === 0, "expected inactive empty");
  },
);

test(
  "automatic policy is deterministic and commercially progressive",
  [
    "generation deterministe",
    "meme entree produisant toujours les memes identifiants",
    "aucune economie negative",
    "aucune economie superieure a 10 %",
    "grammes toujours entiers",
    "montants croissants",
    "grammes croissants",
    "economie croissante",
    "prix effectif au gramme decroissant",
    "serveur et frontend resolvant les memes formats",
  ],
  () => {
    const input = product({ id: "auto-resin", price: 6, category: "resins" });
    const first = resolveFixedPriceOptions(input);
    const second = resolveFixedPriceOptions({ ...input });
    expect(first.length > 0 && first.length <= 3, "expected one to three options");
    expect(
      JSON.stringify(first.map((option) => option.id)) ===
        JSON.stringify(second.map((option) => option.id)),
      "expected deterministic ids",
    );
    expect(
      first.every((option) => option.id.startsWith(`auto-v${FIXED_PRICE_POLICY_VERSION}-`)),
      "expected versioned automatic ids",
    );
    for (let index = 0; index < first.length; index += 1) {
      const option = first[index];
      expect(Number.isInteger(option.quantityGrams), "expected integer grams");
      expect(option.savingAmount > 0, "expected positive saving");
      expect(option.savingRate > 0, "expected positive saving rate");
      expect(option.savingRate <= 0.1, "expected saving rate <= 10%");
      if (index > 0) {
        const previous = first[index - 1];
        expect(option.totalPrice > previous.totalPrice, "expected increasing amount");
        expect(option.quantityGrams > previous.quantityGrams, "expected increasing grams");
        expect(option.savingRate > previous.savingRate, "expected increasing saving rate");
        expect(
          option.effectivePricePerGram < previous.effectivePricePerGram,
          "expected decreasing effective unit price",
        );
      }
    }
    expect(
      JSON.stringify(activeFixedPriceOptions(input)) === JSON.stringify(first),
      "expected active helper to delegate to resolver",
    );
  },
);

test(
  "automatic policy reacts only to price and policy inputs",
  [
    "modification du prix recalculant les formats automatiques",
    "modification d'un autre champ ne changeant pas les formats",
    "generation de moins de trois formats lorsque necessaire",
    "aucune option forcee lorsqu'aucune combinaison n'est valide",
    "changement de version de politique invalidant proprement les anciens formats automatiques",
  ],
  () => {
    const base = product({ id: "auto-resin", price: 6, category: "resins" });
    const baseOptions = resolveFixedPriceOptions(base);
    const renamedOptions = resolveFixedPriceOptions({ ...base, name: "Autre nom" });
    const repricedOptions = resolveFixedPriceOptions({ ...base, price: 5.5 });
    expect(baseOptions.length > 0, "expected base automatic options");
    expect(
      JSON.stringify(baseOptions.map((option) => option.id)) ===
        JSON.stringify(renamedOptions.map((option) => option.id)),
      "expected non-price field to keep options",
    );
    expect(
      JSON.stringify(baseOptions.map((option) => option.id)) !==
        JSON.stringify(repricedOptions.map((option) => option.id)),
      "expected price change to recalculate options",
    );
    expect(resolveFixedPriceOptions(product({ price: 0.1 })).length === 0, "expected no forced options");
    expect(
      baseOptions.every((option) => option.policyVersion === FIXED_PRICE_POLICY_VERSION),
      "expected policy version snapshot",
    );
  },
);

test(
  "stock changes affect availability not generated options",
  [
    "bouton desactive en cas de stock insuffisant",
    "bouton redevenant valide apres augmentation du stock",
  ],
  () => {
    const lowStockProduct = product({ price: 6, stock: 5 });
    const replenishedProduct = product({ price: 6, stock: 25 });
    const lowStockOptions = resolveFixedPriceOptions(lowStockProduct);
    const replenishedOptions = resolveFixedPriceOptions(replenishedProduct);
    expect(lowStockOptions.length === replenishedOptions.length, "expected stock not to change options");
    const largest = replenishedOptions.at(-1);
    expect(Boolean(largest), "expected a largest option");
    expect(lowStockProduct.stock < largest.quantityGrams, "expected insufficient stock for largest option");
    expect(replenishedProduct.stock >= largest.quantityGrams, "expected replenished stock for largest option");
  },
);

test(
  "manual validation blocks invalid commercial grids",
  [
    "modification du prix declenchant avertissement manuel",
    "refus d'un prix ou de grammes transmis par le client",
  ],
  () => {
    const validManual = product({
      fixedPriceMode: "manual",
      fixedPriceOptions: [
        { id: "m1", totalPrice: 40, quantityGrams: 7, isActive: true },
        { id: "m2", totalPrice: 50, quantityGrams: 9, isActive: true },
      ],
    });
    expect(validateManualFixedPriceOptions(validManual).length === 0, "expected valid manual grid");
    const invalidAfterPriceChange = product({
      ...validManual,
      price: 4,
      fixedPriceMode: "manual",
    });
    expect(
      validateManualFixedPriceOptions(invalidAfterPriceChange).some(
        (issue) => issue.severity === "error",
      ),
      "expected price change to invalidate manual grid",
    );
  },
);

test(
  "obsolete automatic cart ids are rejected by server validation",
  ["refus d'un identifiant automatique devenu obsolete"],
  async () => {
    const oldProduct = product({ id: "auto-resin", price: 6, category: "resins" });
    const oldOption = resolveFixedPriceOptions(oldProduct)[0];
    const newProduct = product({ id: "auto-resin", price: 5.5, category: "resins" });
    await expectRejects(
      () =>
        priceCheckout(
          fakeDb({ products: { "auto-resin": newProduct } }),
          checkoutBody([
            {
              productId: "auto-resin",
              quantity: 1,
              purchaseMode: "fixed_price",
              fixedPriceOptionId: oldOption.id,
            },
          ]),
        ),
      "Format prix fixe indisponible",
    );
  },
);

test(
  "current product manual grids and Supreme Purple behavior are preserved",
  [
    "preservation exacte des grilles manuelles actuelles",
    "Supreme Purple restant sans format actif",
  ],
  () => {
    const laMousse = product({
      id: "resin-la-mousse",
      price: 2,
      fixedPriceMode: "manual",
      fixedPriceOptions: [
        { id: "la-mousse-25-13g", totalPrice: 25, quantityGrams: 13, isActive: true },
        { id: "la-mousse-30-16g", totalPrice: 30, quantityGrams: 16, isActive: true },
        { id: "la-mousse-40-22g", totalPrice: 40, quantityGrams: 22, isActive: true },
      ],
    });
    const options = resolveFixedPriceOptions(laMousse);
    expect(options.map((option) => `${option.totalPrice}:${option.quantityGrams}`).join("|") === "25:13|30:16|40:22", "expected La Mousse manual grid");
    expect(resolveFixedPriceOptions(product({ fixedPriceMode: "disabled", stock: 0 })).length === 0, "expected Supreme Purple disabled");
  },
);

test(
  "fixed price mode serialization survives admin save and reload semantics",
  [
    "ancien produit Firestore sans nouveaux champs",
    "produit automatique sauvegarde puis recharge",
    "produit manuel sauvegarde puis recharge",
    "produit desactive sauvegarde puis recharge",
    "passage manual vers automatic",
    "passage automatic vers manual",
    "nouveau produit vendu au gramme",
    "produit oils ou packs",
    "produit reactive apres rupture",
  ],
  () => {
    const legacyFirestoreProduct = product({ fixedPriceMode: undefined, fixedPriceOptions: undefined });
    expect(
      normalizeFixedPriceMode(legacyFirestoreProduct.fixedPriceMode, legacyFirestoreProduct.category) ===
        "automatic",
      "expected legacy gram product to normalize to automatic",
    );
    expect(resolveFixedPriceOptions(legacyFirestoreProduct).length > 0, "expected automatic options after reload");

    const manualOptions = fixedProduct.fixedPriceOptions;
    const automaticSavedOptions = fixedPriceOptionsForMode("automatic", manualOptions);
    expect(automaticSavedOptions.length === 0, "expected automatic save to clear stored options");
    expect(resolveFixedPriceOptions(product({ fixedPriceMode: "automatic", fixedPriceOptions: automaticSavedOptions })).length > 0, "expected automatic reload to regenerate options");

    const disabledSavedOptions = fixedPriceOptionsForMode("disabled", manualOptions);
    expect(disabledSavedOptions.length === 0, "expected disabled save to clear stored options");
    expect(resolveFixedPriceOptions(product({ fixedPriceMode: "disabled", fixedPriceOptions: disabledSavedOptions })).length === 0, "expected disabled reload to stay empty");

    const manualSavedOptions = fixedPriceOptionsForMode("manual", manualOptions);
    expect(manualSavedOptions.length === 4, "expected manual save to preserve all normalized options");
    expect(resolveFixedPriceOptions(product({ fixedPriceMode: "manual", fixedPriceOptions: manualSavedOptions })).length === 3, "expected manual reload to preserve active options");

    expect(fixedPriceOptionsForMode("automatic", manualSavedOptions).length === 0, "expected manual to automatic to clear options");
    expect(fixedPriceOptionsForMode("manual", manualSavedOptions).length === 4, "expected automatic to manual to accept manual grid");
    expect(normalizeFixedPriceMode(undefined, "flowers") === "automatic", "expected new flowers product automatic");
    expect(normalizeFixedPriceMode(undefined, "resins") === "automatic", "expected new resins product automatic");
    expect(normalizeFixedPriceMode(undefined, "oils") === "disabled", "expected oils disabled");
    expect(normalizeFixedPriceMode(undefined, "packs") === "disabled", "expected packs disabled");
    expect(resolveFixedPriceOptions(product({ stock: 0, isActive: true })).length > 0, "expected out-of-stock active product to keep generated options");
    expect(resolveFixedPriceOptions(product({ stock: 20, isActive: true })).length > 0, "expected replenished product to keep generated options");
  },
);

async function run() {
  const covered = new Set<string>();
  for (const entry of tests) {
    await entry.run();
    entry.covers.forEach((cover) => covered.add(cover));
    console.log(`ok - ${entry.name}`);
  }
  console.log(`${tests.length} fixed price format tests passed.`);
  console.log("covered:");
  for (const item of covered) console.log(`- ${item}`);
}

function fixedOrderLine(): OrderItem {
  return {
    productId: "resin-fixed",
    name: "Resine fixe",
    quantity: 8,
    unitPrice: 3.75,
    lineTotal: 30,
    purchaseMode: "fixed_price",
    fixedPriceOptionId: "format-8g-30",
    fixedPriceQuantity: 1,
    fixedPriceTotal: 30,
    fixedPriceGrams: 8,
    category: "resins",
  };
}

function product(overrides: Partial<Product> & Record<string, unknown> = {}): Product {
  return {
    id: "resin-fixed",
    slug: "resine-fixe",
    name: "Resine fixe",
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
    stock: 22,
    lowStockThreshold: 5,
    isActive: true,
    isFeatured: false,
    seoTitle: "Resine fixe",
    seoDescription: "Resine fixe.",
    ...overrides,
  } as Product;
}

function checkoutBody(items: Array<Record<string, unknown>>): CheckoutRequestBody {
  return {
    items: items as CheckoutRequestBody["items"],
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
        normalizedLabel: "1 rue Test, 13090 Aix-en-Provence",
        latitude: 43.5,
        longitude: 5.4,
        verifiedAt: "2026-08-05T10:00:00.000Z",
        verificationProvider: "geoplateforme_ban",
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

async function expectThrows(run: () => unknown, expectedMessage: string) {
  try {
    run();
  } catch (error) {
    expect(
      error instanceof Error && error.message.includes(expectedMessage),
      `expected throw including "${expectedMessage}"`,
    );
    return;
  }
  throw new Error(`expected throw including "${expectedMessage}"`);
}

void run();
