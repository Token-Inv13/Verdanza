import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [page, editor, dialog, layout] = await Promise.all([
  "../src/pages/admin/AdminPage.tsx",
  "../src/components/admin/products/ProductEditor.tsx",
  "../src/components/admin/AdminDialog.tsx",
  "../src/layouts/AdminLayout.tsx",
].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

assert.match(page, /section === "Produits"[\s\S]*?<section className="mt-8 min-w-0">/,
  "The full width product list must be allowed to shrink");
assert.doesNotMatch(page, /xl:grid-cols-\[420px_minmax\(0,1fr\)\]/,
  "The old permanent side form must not constrain the product table");
assert.match(page, /function ProductTable[\s\S]*?<div className="overflow-x-auto">\s*<table className="w-full min-w-\[1040px\]/,
  "The products table must retain its internal horizontal scroller");
assert.match(editor, /<form id=\{formId\} onSubmit=\{onSubmit\} className="min-w-0">/);
assert.match(dialog, /100dvh/);
assert.match(dialog, /min-h-0 overflow-y-auto overscroll-contain/,
  "Long editors must scroll inside the dialog");
assert.match(dialog, /<header className="[^"\n]*shrink-0/);
assert.match(dialog, /<footer className="[^"\n]*shrink-0/);
assert.match(layout, /<main className="min-w-0">/);

console.log("Admin products layout contracts passed; real component geometry is covered by test:admin-v3 at one fixed viewport.");
