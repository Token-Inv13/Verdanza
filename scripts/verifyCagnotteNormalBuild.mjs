import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = resolve(root, "dist");
const forbidden = [
  "demo-verdanza-cagnotte",
  "RECETTE LOCALE — DONNÉES FICTIVES",
  "local-interactive",
  "/api/__recette/health",
  "19099",
  "18086",
  "cagnotte-produit-fictif.svg",
];
const files = await list(dist);
const textual = files.filter((file) => /\.(?:css|html|js|json|map|svg|txt|xml)$/i.test(file));
for (const file of textual) {
  const contents = await readFile(file, "utf8");
  for (const marker of forbidden) {
    assert.ok(!contents.includes(marker), `Le build normal embarque un marqueur de recette (${marker}) dans ${file}.`);
  }
}
console.log(`Build normal contrôlé : ${files.length} fichier(s), aucun adaptateur, endpoint, port, projet ou repère de recette interactive embarqué.`);

async function list(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? list(path) : [path];
  }));
  return nested.flat();
}
