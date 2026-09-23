import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { sitemapUrls, staticSeoRoutes } from "./seoRoutes";

const path = "/compte/avantages";
const route = staticSeoRoutes.find((entry) => entry.path === path);
assert.deepEqual(route, {
  path,
  kind: "private",
  component: "AccountAdvantagesPage",
  indexable: false,
});
assert.equal(sitemapUrls().includes(`https://verdanza.fr${path}`), false);

const app = parse("src/App.tsx");
const advantagesImport = find(app, (node): node is ts.VariableDeclaration =>
  ts.isVariableDeclaration(node) && node.name.getText(app) === "AccountAdvantagesPage",
);
assert.ok(advantagesImport?.initializer && ts.isCallExpression(advantagesImport.initializer));
assert.equal(advantagesImport.initializer.expression.getText(app), "lazy");

let advantagesRouteCount = 0;
visit(app, [], (node, ancestors) => {
  if (!ts.isJsxSelfClosingElement(node) || node.tagName.getText(app) !== "Route") return;
  if (attributeText(node.attributes, "path") !== "avantages") return;
  advantagesRouteCount += 1;

  const enclosingRoutes = ancestors.filter(ts.isJsxElement).map((parent) => parent.openingElement);
  assert.ok(enclosingRoutes.some((parent) => attributeText(parent.attributes, "path") === "compte"));
  assert.ok(enclosingRoutes.some((parent) =>
    attributeExpression(parent.attributes, "element")?.getText(app).includes("<AccountAuthGate />"),
  ));
  assert.ok(!ancestors.some(ts.isConditionalExpression), "The route must exist for both flag values");

  const element = attributeExpression(node.attributes, "element");
  assert.ok(element && ts.isConditionalExpression(element));
  assert.equal(element.condition.getText(app), "CAGNOTTE_READ_DISPLAY_ENABLED");
  assert.ok(ts.isJsxSelfClosingElement(element.whenTrue));
  assert.equal(element.whenTrue.tagName.getText(app), "AccountAdvantagesPage");
  assert.ok(ts.isJsxSelfClosingElement(element.whenFalse));
  assert.equal(element.whenFalse.tagName.getText(app), "Navigate");
  assert.equal(attributeText(element.whenFalse.attributes, "to"), "/compte");
  assert.ok(element.whenFalse.attributes.properties.some((entry) =>
    ts.isJsxAttribute(entry) && entry.name.getText(app) === "replace",
  ));
});
assert.equal(advantagesRouteCount, 1);

const layout = parse("src/pages/account/AccountLayout.tsx");
let conditionalMenuLinkCount = 0;
visit(layout, [], (node, ancestors) => {
  if (!ts.isStringLiteral(node) || node.text !== path) return;
  const flagCondition = ancestors.find((parent): parent is ts.ConditionalExpression =>
    ts.isConditionalExpression(parent) && parent.condition.getText(layout) === "CAGNOTTE_READ_DISPLAY_ENABLED",
  );
  assert.ok(flagCondition, "The account menu link must be gated by the read-display flag");
  assert.ok(node.pos >= flagCondition.whenTrue.pos && node.end <= flagCondition.whenTrue.end);
  assert.ok(ts.isArrayLiteralExpression(flagCondition.whenFalse));
  assert.equal(flagCondition.whenFalse.elements.length, 0);
  conditionalMenuLinkCount += 1;
});
assert.equal(conditionalMenuLinkCount, 1);

console.log("Account advantages deep-link, auth gate, closed route and conditional menu passed.");

function parse(file: string) {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function find<T extends ts.Node>(root: ts.Node, matches: (node: ts.Node) => node is T): T | undefined {
  if (matches(root)) return root;
  return ts.forEachChild(root, (child) => find(child, matches));
}

function visit(node: ts.Node, ancestors: ts.Node[], inspect: (node: ts.Node, ancestors: ts.Node[]) => void) {
  inspect(node, ancestors);
  ts.forEachChild(node, (child) => visit(child, [...ancestors, node], inspect));
}

function attributeText(attributes: ts.JsxAttributes, name: string) {
  const attribute = attributes.properties.find((entry) =>
    ts.isJsxAttribute(entry) && entry.name.getText() === name,
  );
  return attribute && ts.isJsxAttribute(attribute) && attribute.initializer &&
    ts.isStringLiteral(attribute.initializer) ? attribute.initializer.text : undefined;
}

function attributeExpression(attributes: ts.JsxAttributes, name: string) {
  const attribute = attributes.properties.find((entry) =>
    ts.isJsxAttribute(entry) && entry.name.getText() === name,
  );
  return attribute && ts.isJsxAttribute(attribute) && attribute.initializer &&
    ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : undefined;
}
