import assert from "node:assert/strict";
import { buildCustomerInvoiceLines } from "../src/lib/customerInvoiceLines";
import type { Order } from "../src/types";

const order = {
  items: [
    {
      productId: "flower-amnesia",
      name: "Amnesia",
      quantity: 10,
      unitPrice: 8,
    },
    {
      productId: "gift-blue-dream",
      name: "Blue Dream",
      quantity: 2,
      unitPrice: 0,
    },
  ],
  appliedPromotions: [
    {
      id: "gift",
      label: "Produit offert",
      type: "threshold_extra_discount",
      discountAmount: 0,
    },
  ],
} satisfies Pick<Order, "items" | "appliedPromotions">;

const lines = buildCustomerInvoiceLines(order);
assert.equal(lines.length, 2);
assert.equal(lines[0].total, 80);
assert.equal(lines[0].isGift, undefined);
assert.equal(lines[1].total, 0);
assert.equal(lines[1].isGift, true);
assert.equal(lines[1].note, "Offert");
assert.equal(lines[1].promotionLabel, "Produit offert");

console.log("Customer invoice tests passed.");
