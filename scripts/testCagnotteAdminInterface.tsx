import React from "react";
import { deepEqual, doesNotMatch, equal, match, ok, rejects, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CagnotteAdminTools,
  CagnotteAdminToolsView,
  type CagnotteAdminViewModel,
} from "../src/components/cagnotte/CagnotteAdminTools.js";
import { cagnotteAdminCorrectionMaximumNetCents, cagnotteAdminMaximumLineInput } from "../src/lib/cagnotteAdminLineInput.js";
import { cagnotteAdminDefinitiveRejectionState, cagnotteAdminFailureState, cagnotteAdminFormUpdatedState, cagnotteAdminFrozenOperationState, cagnotteAdminInspectionSuccessState, cagnotteAdminLoadingState, cagnotteAdminStorageBlockedState, cagnotteAdminTerminalReinspectionState } from "../src/lib/cagnotteAdminState.js";
import { canRecoverCagnotteAdminPreSendStorageFailure, clearCagnotteAdminPendingOperation, createCagnotteAdminRefreshChannel, createCagnotteAdminResponseIdentity, eurosInputToCents, freezeCagnotteAdminCorrection, freezeCagnotteAdminRefund, refreshCagnotteAdminAfterWrite, retryCagnotteAdminFrozenOperation, runCagnotteAdminLocked } from "../src/lib/cagnotteAdminController.js";
import { CagnotteAdminRequestError } from "../src/services/cagnotteAdminService.js";
import { cagnotteRefundDateTimeLocalToIso, cagnotteRefundDateTimeLocalValue } from "../src/lib/cagnotteAdminDate.js";
import { formatAdminDateTime } from "../src/lib/adminDatePresentation.js";
import { isExpectedNonAdminLookupError } from "../src/lib/adminLookupPresentation.js";
import { assertCagnotteAdminMutationAllowed, cagnotteAdminMutationsAllowed, shouldMountCagnotteAdminTools } from "../src/lib/cagnotteAdminEligibility.js";
import { calculateCagnotte } from "../src/lib/cagnotteCalculations.js";
import { CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED } from "../src/config/cagnotteFeatures.js";
import { cagnotteAdminCorrectionBusinessFingerprint, cagnotteAdminRefundBusinessFingerprint } from "../src/lib/cagnotteAdminOperationIdentity.js";
import type { CagnotteAdminInspection, CorrectionPreview, RefundPreview } from "../src/types/cagnotteAdmin.js";
import { adminOrderRow } from "../src/services/ordersService.js";
import type { AdminOrderRow } from "../src/services/ordersService.js";
import {
  adjustCustomerLoyalty,
  assignPromoToCustomer,
  updateCustomerAdminStatus,
  updateCustomerInternalNote,
} from "../src/services/adminCustomersService.js";
import {
  buildDashboardMetrics,
  type AdminDashboardOrder,
} from "../src/lib/adminDashboardMetrics.js";
import {
  buildCommercialCustomerEntries,
  commercialAdminCustomers,
  commercialAdminOrders,
  ordersForCommercialCustomer,
} from "../src/lib/adminCustomerCommercial.js";
import { assertOrdinaryCustomerAdminMutationAllowed } from "../src/lib/productionFixtureMarker.js";
import type { Coupon, CustomerProfile, Order } from "../src/types/index.js";

let tests = 0;
function test(name: string, run: () => void | Promise<void>) {
  return Promise.resolve().then(run).then(() => { tests += 1; console.log(`OK [Interface admin] ${name}`); });
}
const inspection = fixture();
const base: CagnotteAdminViewModel = { phase: "ready", inspection, mode: "refund", refundPreview: null, correctionPreview: null, notice: "", uncertain: false, pendingOperation: null, recoveryBlocked: false, busy: false };

await test("garde normal desactive : aucun rendu ni appel", () => {
  equal(CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED, false);
  equal(renderToStaticMarkup(<CagnotteAdminTools mutationsEnabled orderId="demo" enabled={false} />), "");
});
await test("commande historique : aucun montage meme avec garde simulee ouverte", () => {
  equal(shouldMountCagnotteAdminTools({ displayEnabled: true, orderSource: "firestore", order: { id: "historique", customerId: "client" } }), false);
});
await test("projection admin conserve une inscription acquisition seule sans intention", () => {
  const source = projectableOrder(eligibleOrder());
  const projected = adminOrderRow(source);
  equal(projected.cagnotte, source.cagnotte);
  equal(projected.cagnotteReservationIntent, undefined);
  equal(Object.hasOwn(projected, "productionFixture"), false);
  equal(cagnotteAdminMutationsAllowed(projected), true);
  equal(shouldMountCagnotteAdminTools({ displayEnabled: true, orderSource: "firestore", order: projected }), true);
});
await test("projection admin conserve une inscription mixte et son intention canonique", () => {
  const source = projectableOrder(mixedEligibleOrder());
  const projected = adminOrderRow(source);
  equal(projected.cagnotte, source.cagnotte);
  equal(projected.cagnotteReservationIntent, source.cagnotteReservationIntent);
  equal(shouldMountCagnotteAdminTools({ displayEnabled: true, orderSource: "firestore", order: projected }), true);
});
await test("projection admin conserve le marqueur Production fixture sans transformation", () => {
  const productionFixture = {
    schemaVersion: 1 as const,
    marker: "verdanza-cagnotte-production-fixture-v1",
    projectId: "verdanza-1f621",
    uid: "fixture-user",
    productId: "fixture-product",
    orderId: "fixture-order",
    checkoutRequestId: "fixture-request",
  };
  const source = { ...projectableOrder(eligibleOrder()), productionFixture };
  equal(adminOrderRow(source).productionFixture, productionFixture);
});
await test("fixture exacte ou corrompue reste montee mais interdit explicitement les mutations", () => {
  const enrolled = projectableOrder(eligibleOrder());
  const exactFixture = { ...enrolled, productionFixture: {
    schemaVersion: 1 as const,
    marker: "verdanza-cagnotte-production-fixture-v1",
    projectId: "verdanza-1f621",
    uid: "fixture-user",
    productId: "fixture-product",
    orderId: "fixture-order",
    checkoutRequestId: "fixture-request",
  } };
  const corruptFixture = { ...enrolled, productionFixture: { marker: "corrompu" } };
  const projectedCorruptFixture = adminOrderRow(corruptFixture as unknown as Order);
  equal(shouldMountCagnotteAdminTools({ displayEnabled: true, orderSource: "firestore", order: exactFixture }), true);
  equal(shouldMountCagnotteAdminTools({ displayEnabled: true, orderSource: "firestore", order: corruptFixture }), true);
  equal(cagnotteAdminMutationsAllowed(exactFixture), false);
  equal(cagnotteAdminMutationsAllowed(corruptFixture), false);
  equal(Object.hasOwn(projectedCorruptFixture, "productionFixture"), true);
  equal(cagnotteAdminMutationsAllowed(projectedCorruptFixture), false);
  equal(cagnotteAdminMutationsAllowed(enrolled), true);
});
await test("dashboard exclut toutes les fixtures de ses metriques commerciales", () => {
  const commercialOrder: AdminDashboardOrder = {
    paymentStatus: "paid",
    orderStatus: "confirmed",
    delivery: "Livraison locale",
    total: "100,00 EUR",
  };
  const fixtureMarker = {
    schemaVersion: 1 as const,
    marker: "verdanza-cagnotte-production-fixture-v1",
    projectId: "verdanza-1f621",
    uid: "fixture-user",
    productId: "fixture-product",
    orderId: "fixture-order",
    checkoutRequestId: "fixture-request",
  };
  const fixtureOrders: AdminDashboardOrder[] = [
    {
      ...commercialOrder,
      productionFixture: fixtureMarker,
    },
    {
      paymentStatus: "to_confirm",
      orderStatus: "preparing",
      delivery: "Livraison locale",
      total: "100,00 EUR",
      productionFixture: fixtureMarker,
    },
    {
      paymentStatus: "paid",
      orderStatus: "out_for_delivery",
      delivery: "Livraison locale",
      total: "100,00 EUR",
      productionFixture: fixtureMarker,
    },
  ];
  const commercialMetrics = buildDashboardMetrics([], [commercialOrder]);
  const mixedMetrics = buildDashboardMetrics([], [commercialOrder, ...fixtureOrders]);
  deepEqual(mixedMetrics, commercialMetrics);
  equal(
    mixedMetrics.find((metric) => metric.label === "Règlements à suivre")?.detail,
    "1 déjà réglé(s)",
  );
  equal(mixedMetrics.find((metric) => metric.label === "À préparer")?.value, "1");
  equal(mixedMetrics.find((metric) => metric.label === "En livraison")?.value, "0");
});
await test("section clients exclut profils et commandes fixture de tous les calculs commerciaux", () => {
  const fixtureMarker = {
    schemaVersion: 1 as const,
    marker: "verdanza-cagnotte-production-fixture-v1",
    projectId: "verdanza-1f621",
    uid: "fixture-user",
    productId: "fixture-product",
    orderId: "fixture-order",
    checkoutRequestId: "fixture-request",
  };
  const commercialCustomer: CustomerProfile = {
    id: "customer-commercial",
    uid: "customer-commercial",
    email: "client@verdanza.test",
    displayName: "Client commercial",
    phone: "0600000001",
    loyaltyPoints: 0,
    orderCount: 0,
    totalSpent: 0,
    role: "customer",
  };
  const fixtureCustomer: CustomerProfile = {
    ...commercialCustomer,
    id: "customer-fixture",
    uid: "customer-fixture",
    email: "fixture@verdanza.test",
    displayName: "Client fixture",
    productionFixture: fixtureMarker,
  };
  const commercialOrder = {
    id: "order-commercial",
    customerId: commercialCustomer.uid,
    customerEmail: commercialCustomer.email,
    customerPhone: commercialCustomer.phone,
    paymentStatus: "paid",
    orderStatus: "confirmed",
    delivery: "Livraison locale",
    total: "100,00 EUR",
    createdAt: "2026-09-01T10:00:00.000Z",
  } as AdminOrderRow;
  const fixtureOrder = {
    ...commercialOrder,
    id: "order-fixture",
    customerId: fixtureCustomer.uid,
    customerEmail: fixtureCustomer.email,
    customerPhone: fixtureCustomer.phone,
    total: "999,00 EUR",
    createdAt: "2026-09-02T10:00:00.000Z",
    productionFixture: fixtureMarker,
  } as AdminOrderRow;

  const baseline = buildCommercialCustomerEntries(
    [commercialCustomer],
    [commercialOrder],
  );
  const mixed = buildCommercialCustomerEntries(
    [commercialCustomer, fixtureCustomer],
    [commercialOrder, fixtureOrder],
  );

  deepEqual(mixed, baseline);
  equal(commercialAdminCustomers([commercialCustomer, fixtureCustomer]).length, 1);
  equal(commercialAdminOrders([commercialOrder, fixtureOrder]).length, 1);
  equal(mixed.length, 1);
  equal(mixed[0]?.customer.id, commercialCustomer.id);
  equal(mixed.filter((entry) => entry.orders.length > 0).length, 1);
  equal(mixed[0]?.stats.orderCount, 1);
  equal(mixed[0]?.stats.totalSpent, 100);
  equal(mixed[0]?.stats.averageCart, 100);
  equal(mixed[0]?.stats.status.label, "Actif");
  equal(mixed.some((entry) => entry.customer.id === fixtureCustomer.id), false);
  equal(ordersForCommercialCustomer([fixtureOrder], fixtureCustomer).length, 0);
  equal(
    ordersForCommercialCustomer(
      [{ ...fixtureOrder, customerId: commercialCustomer.uid }],
      commercialCustomer,
    ).length,
    0,
  );
});
await test("mutations client ordinaires refusent tout profil portant le marqueur fixture", async () => {
  const ordinary = {
    id: "customer-commercial",
    uid: "customer-commercial",
    email: "client@verdanza.test",
    displayName: "Client commercial",
    phone: "0600000001",
    loyaltyPoints: 0,
    orderCount: 0,
    totalSpent: 0,
    role: "customer",
  } satisfies CustomerProfile;
  const exactFixture = {
    ...ordinary,
    productionFixture: {
      schemaVersion: 1 as const,
      marker: "verdanza-cagnotte-production-fixture-v1",
      projectId: "verdanza-1f621",
      uid: "fixture-user",
      productId: "fixture-product",
      orderId: "fixture-order",
      checkoutRequestId: "fixture-request",
    },
  } satisfies CustomerProfile;
  const partialFixture = {
    ...ordinary,
    productionFixture: { marker: "partiel" },
  } as unknown as CustomerProfile;

  assertOrdinaryCustomerAdminMutationAllowed(ordinary);
  throws(
    () => assertOrdinaryCustomerAdminMutationAllowed(exactFixture),
    /production_fixture_customer_admin_mutation_forbidden/,
  );
  throws(
    () => assertOrdinaryCustomerAdminMutationAllowed(partialFixture),
    /production_fixture_customer_admin_mutation_forbidden/,
  );
  await rejects(
    () => adjustCustomerLoyalty(exactFixture, 1, "test"),
    /production_fixture_customer_admin_mutation_forbidden/,
  );
  await rejects(
    () => assignPromoToCustomer(exactFixture, {} as Coupon, "test"),
    /production_fixture_customer_admin_mutation_forbidden/,
  );
  await rejects(
    () => updateCustomerInternalNote(exactFixture, "test"),
    /production_fixture_customer_admin_mutation_forbidden/,
  );
  await rejects(
    () => updateCustomerAdminStatus(exactFixture, { status: "archived" }),
    /production_fixture_customer_admin_mutation_forbidden/,
  );
});
await test("projection admin refuse historique, inscription invalide, source non Firestore et garde fermee", () => {
  const ordinary = adminOrderRow(projectableOrder({ id: "CMD-HISTORIQUE", customerId: "client-fictif" }));
  equal(shouldMountCagnotteAdminTools({ displayEnabled: true, orderSource: "firestore", order: ordinary }), false);
  const invalid = adminOrderRow(projectableOrder({ ...eligibleOrder(), cagnotte: { ...eligibleOrder().cagnotte, beneficiaryId: "autre-client" } }));
  equal(shouldMountCagnotteAdminTools({ displayEnabled: true, orderSource: "firestore", order: invalid }), false);
  const enrolled = adminOrderRow(projectableOrder(eligibleOrder()));
  equal(shouldMountCagnotteAdminTools({ displayEnabled: true, orderSource: "archive", order: enrolled }), false);
  equal(shouldMountCagnotteAdminTools({ displayEnabled: false, orderSource: "firestore", order: enrolled }), false);
});
await test("meme projection admin alimente mobile et bureau puis recharge par getAdminOrder", async () => {
  const [adminPage, adminData] = await Promise.all([
    readFile(resolve("src/pages/admin/AdminPage.tsx"), "utf8"),
    readFile(resolve("src/hooks/useAdminData.ts"), "utf8"),
  ]);
  equal((adminPage.match(/shouldMountCagnotteAdminTools\(\{ displayEnabled: CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED, orderSource, order \}\)/g) ?? []).length, 2);
  match(adminPage, /<DesktopOrderCard[\s\S]*?order=\{order\}[\s\S]*?onRefresh=\{\(\) => onRefreshOrder \? onRefreshOrder\(order\.id\) : Promise\.resolve\(\)\}/);
  match(adminPage, /onOrderReload=\{\(\) => onRefreshOrder\?\.\(order\.id\)\}/);
  match(adminPage, /<AdminCagnotteTools[\s\S]*?onOrderReload=\{onRefresh\}/);
  match(adminData, /const order = await getAdminOrder\(orderId\);[\s\S]*?entry\.id === orderId \? order : entry/);
});
await test("vrai composant : libelles, financement et operations applicables", () => {
  const html = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={base} />);
  for (const text of ["Enregistrer un remboursement déjà confirmé", "Cette action enregistre votre déclaration.",
    "Elle n’effectue aucun remboursement bancaire.", "Consulter", "Confirmer paiement / livraison",
    "Enregistrer un retour", "Corriger une déclaration", "Tout le montant restant"]) match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  doesNotMatch(html, /Revoir \/ annuler un impayé/);
});
await test("fixture UI conserve inspection et previews mais ferme chaque mutation", () => {
  const preview = { ...refund(), kind: "refund_preview" as const, recordedAt: undefined };
  const refundHtml = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled={false} model={{ ...base, refundPreview: preview }} />);
  match(refundHtml, /Fixture Production : inspection et prévisualisation uniquement/);
  match(refundHtml, /Journal cagnotte de la commande|Historique administratif/);
  match(refundHtml, />Prévisualiser sur le serveur<\/button>/);
  match(refundHtml, /button[^>]*disabled=""[^>]*>Confirmer l’enregistrement<\/button>/);

  const correctionPreview = { ...correctionReview(), kind: "refund_correction_preview" as const, reviewReason: undefined };
  const correctionHtml = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled={false} model={{ ...base, mode: "correction", correctionPreview }} />);
  match(correctionHtml, />Prévisualiser la correction<\/button>/);
  match(correctionHtml, /button[^>]*disabled=""[^>]*>Confirmer après vérification externe<\/button>/);

  const reserved = { ...inspection,
    reservation: { ...inspection.reservation, state: "reserved" as const, cumulativeRestitutedCents: 0 },
    unpaid: { ...inspection.unpaid, reservationState: "reserved" as const } };
  const unpaidHtml = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled={false} model={{ ...base, inspection: reserved, mode: "unpaid" }} />);
  doesNotMatch(unpaidHtml, /Revoir \/ annuler un impayé|Enregistrer la revue|Annuler après revue/);

  const operation = freezeCagnotteAdminRefund({ orderId: inspection.order.id,
    additionalReturns: [{ lineId: "line-0", additionalNetCents: 2500 }], deliveryRefundCents: 0,
    source: "admin", reference: "fixture-frozen", declaredFinancialCents: 2300, reason: "product_return",
    confirmedAt: "2026-09-06T10:00:00.000Z", expectedPreviewVersion: "c".repeat(64) });
  const frozen = cagnotteAdminFrozenOperationState({ ...base, refundPreview: preview }, operation,
    new CagnotteAdminRequestError("Réponse absente", "response_unknown", true));
  const frozenHtml = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled={false} model={frozen} />);
  match(frozenHtml, /réinspecter le payload conservé pour diagnostic/);
  doesNotMatch(frozenHtml, /Rejouer exactement l’opération précédente/);
  throws(() => assertCagnotteAdminMutationAllowed(false), /inspection et prévisualisation uniquement/);
  assertCagnotteAdminMutationAllowed(true);
});
await test("inspection lisible distingue inscription, gain commande et portefeuille global", () => {
  const html = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={base} />);
  for (const text of ["REMBOURSEMENT/CORRECTION ENREGISTRÉ", "Inscription de la commande", "Acquisition fidélité :", "inscrite", "Gain de cette commande",
    "Gain estimé", "Gain en attente", "Gain disponible", "Gain annulé ou réduit", "Portefeuille global du client",
    "Disponible global", "La régularisation est globale au client et peut provenir d’autres commandes.", "Réservation de cette commande", "Consommée", "Journal cagnotte de la commande"]) match(html, new RegExp(text));
});
await test("historique legacy partiel affiche un avertissement discret sans corruption", () => {
  const partial = { ...inspection, movementHistory: { complete: false, omittedLegacyUndatedCount: 2 } };
  const html = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={{ ...base, inspection: partial }} />);
  match(html, /Journal partiel : certains anciens mouvements/);
  match(html, /ne sont pas affichés dans cette chronologie/);
  match(html, /\(2\)/);
  doesNotMatch(html, /corruption/i);
});
await test("etats par commande paiement en attente livre et annule sont explicites", () => {
  const cases = [
    [{ code: "payment_confirmed_pending" as const, label: "PAIEMENT CONFIRMÉ", detail: "5 % EN ATTENTE" }, /PAIEMENT CONFIRMÉ[\s\S]*5 % EN ATTENTE/],
    [{ code: "delivered_available" as const, label: "LIVRÉE", detail: "GAIN DISPONIBLE POUR CETTE COMMANDE" }, /LIVRÉE[\s\S]*Gain disponible pour cette commande/],
    [{ code: "cancelled" as const, label: "ANNULÉE", detail: "Le gain de cette commande est annulé." }, /ANNULÉE/],
  ] as const;
  for (const [operationalState, pattern] of cases) match(renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={{ ...base, inspection: { ...inspection, operationalState } }} />), pattern);
});
await test("preview et resultat persisté presentent les effets separement", () => {
  const html = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={{ ...base, refundPreview: refund(), notice: "Déclaration enregistrée." }} />);
  for (const text of ["Part financière déclarée", "Cagnotte brute restituée", "Correction du gain", "Compensation", "Disponible estimé"]) match(html, new RegExp(text));
});
await test("correction a verifier affiche le refus cible et sa limite", () => {
  const html = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={{ ...base, mode: "correction", correctionPreview: correctionReview(), notice: "Vérification requise" }} />);
  match(html, /CORRECTION_REQUIRES_REVIEW/); match(html, /réservé ou utilisé/); match(html, /L’original reste dans l’historique/);
  match(html, /Révision actuelle : 0/); match(html, /nouvelle révision : 1/); match(html, /Variation régularisation/);
});
await test("impaye separe transport et reglement, seuil sans automatisme", () => {
  const reserved = { ...inspection,
    reservation: { ...inspection.reservation, state: "reserved" as const, cumulativeRestitutedCents: 0 },
    unpaid: { ...inspection.unpaid, reservationState: "reserved" as const } };
  const html = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={{ ...base, inspection: reserved, mode: "unpaid" }} />);
  for (const text of ["À revoir · plus de 72 heures", "Cagnotte réservée", "Règlement de la commande", "Lien CB envoyé", "Transmission du lien", "Résultat à vérifier", "n’est ni une preuve de paiement ni une preuve d’impayé", "ne révoque pas le lien externe"]) match(html, new RegExp(text));
  doesNotMatch(html, />to_confirm<|>unknown<|Cagnotte consommée/);
});
await test("impaye est masque hors reservation active", () => {
  for (const state of ["consumed", "released", null] as const) {
    const inactive = { ...inspection,
      reservation: { ...inspection.reservation, state },
      unpaid: { ...inspection.unpaid, reservationState: state } };
    const html = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={{ ...base, inspection: inactive, mode: "unpaid" }} />);
    doesNotMatch(html, /Revoir \/ annuler un impayé|Enregistrer la revue|Annuler la commande/);
  }
  const inconsistent = { ...inspection,
    reservation: { ...inspection.reservation, state: "reserved" as const },
    unpaid: { ...inspection.unpaid, reservationState: "consumed" as const } };
  doesNotMatch(renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={{ ...base, inspection: inconsistent, mode: "unpaid" }} />),
    /Revoir \/ annuler un impayé|Enregistrer la revue|Annuler la commande/);
});
await test("financement consomme utilise le libelle correspondant", () => {
  const consumed = { ...inspection, unpaid: { ...inspection.unpaid, reservationState: "consumed", reservedAmountCents: 0 } };
  const html = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={{ ...base, inspection: consumed }} />);
  match(html, /Cagnotte consommée/);
  doesNotMatch(html, /Cagnotte réservée/);
});
await test("historique apres neutralisation conserve l original et rend la correction effective", () => {
  const zero = { lines: [{ lineId: "line-0", returnedNetCents: 0 }], returnedProductNetCents: 0, productFinancialCents: 0,
    cagnotteRestitutionCents: 0, deliveryFinancialCents: 0, totalFinancialCents: 0 };
  const corrected: CagnotteAdminInspection = { ...inspection, effective: zero,
    wallet: { ...inspection.wallet!, availableCents: 1660 },
    lines: inspection.lines.map((line) => ({ ...line, returnedNetCents: 0, remainingNetCents: line.initialNetCents })),
    history: [
      { ...inspection.history[0], effective: false },
      { id: "e".repeat(64), type: "correction", revision: 1, recordedAt: "2026-09-06T10:05:00.000Z", reference: "neutralisation-demo", businessFingerprint: "e".repeat(64),
        declaredFinancialCents: 0, returnedProductNetCents: 0, financialCents: 0, cagnotteRestitutionCents: 0,
        resultingAvailableCents: 1660, effective: true, targetEventId: inspection.history[0].id, targetReference: "demo" },
    ], correctionTarget: { eventId: inspection.history[0].id, revision: 1, effective: zero,
      lines: inspection.correctionTarget!.lines } };
  const html = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={{ ...base, inspection: corrected, mode: "correction" }} />);
  for (const text of ["Historique administratif", "Déclaration initiale", "Corrigée / inactive", "Correction · neutralisation",
    "Active / effective", "Retour net", "25,00", "Financier", "23,00", "Cagnotte restituée", "2,00",
    "Solde disponible résultant", "16,60", "Aucun flux bancaire n’est modifié"]) match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  doesNotMatch(html, /Conséquences calculées par le serveur|Effet différentiel/);
});
await test("H19 correction utilise le plafond serveur de la cible et refund garde le restant global", () => {
  const multipleRefunds: CagnotteAdminInspection = {
    ...inspection,
    lines: inspection.lines.map((line) => ({ ...line, returnedNetCents: 5000, remainingNetCents: 5000 })),
    correctionTarget: { ...inspection.correctionTarget!, effective: { ...inspection.effective, returnedProductNetCents: 5000 },
      lines: [{ lineId: "line-0", maxReplacementNetCents: 7000 }] },
  };
  const correctionHtml = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={{ ...base, inspection: multipleRefunds, mode: "correction" }} />);
  match(correctionHtml, /70,00\s*€ admissibles/);
  doesNotMatch(correctionHtml, /100,00\s*€ admissibles|50,00\s*€ admissibles/);
  const maximum = cagnotteAdminCorrectionMaximumNetCents(multipleRefunds, "line-0");
  equal(maximum, 7000);
  equal(cagnotteAdminMaximumLineInput({}, "line-0", maximum)["line-0"], "70,00");
  const refundHtml = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={{ ...base, inspection: multipleRefunds, mode: "refund" }} />);
  match(refundHtml, /50,00\s*€ admissibles/);
  doesNotMatch(refundHtml, /70,00\s*€ admissibles/);
});
await test("revue et date sont presentees sans codes internes", () => {
  const reviewed = { ...inspection,
    reservation: { ...inspection.reservation, state: "reserved" as const },
    unpaid: { ...inspection.unpaid, reservationState: "reserved" as const,
      review: { outcome: "unpaid_confirmed" as const, source: "fixture", reason: "fixture", reviewedAt: "2026-09-06T10:00:00.000Z", reviewedByEmail: "admin@example.test", current: true } } };
  const html = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={{ ...base, inspection: reviewed, mode: "unpaid" }} />);
  match(html, /Dernière revue : Impayé confirmé après vérification/);
  match(html, /6 sept. 2026/);
  doesNotMatch(html, />unpaid_confirmed<|2026-09-06T10:00:00.000Z/);
});
await test("bouton desactive visuellement distinct", async () => {
  const css = await readFile(resolve("src/styles/cagnotte-admin.css"), "utf8");
  match(css, /\.cagnotte-admin button:disabled\{[^}]*cursor:not-allowed[^}]*opacity:/);
});
await test("mutation en cours desactive les controles et expose aria-busy", () => {
  const html = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={{ ...base, busy: true }} />);
  match(html, /aria-busy="true"/); match(html, /<fieldset disabled=""/); match(html, /button[^>]*disabled=""/);
});
await test("operation refund incertaine reste gelee jusqu a sa preuve exacte", async () => {
  const input = { orderId: inspection.order.id, additionalReturns: [{ lineId: "line-0", additionalNetCents: 2500 }], deliveryRefundCents: 0,
    source: "admin" as const, reference: "Reference-Figee", declaredFinancialCents: 2300, reason: "product_return" as const,
    confirmedAt: "2026-09-06T10:00:00.000Z", expectedPreviewVersion: "c".repeat(64) };
  const operation = freezeCagnotteAdminRefund(input);
  input.reference = "nouvelle-reference-interdite";
  let state = cagnotteAdminFrozenOperationState({ ...base, refundPreview: refund() }, operation,
    new CagnotteAdminRequestError("Réponse absente", "response_unknown", true));
  equal(state.uncertain, true); equal(operation.payload.reference, "Reference-Figee");
  for (const [code, uncertain] of [["admin_token_required", false], ["admin_required", false], ["conflict", false], ["rate_limited", false], ["server", true], ["network", true]] as const) {
    state = cagnotteAdminFailureState(state, new CagnotteAdminRequestError(code, code, uncertain), "error");
    equal(state.uncertain, true, code); equal(state.pendingOperation, operation, code);
  }
  state = cagnotteAdminLoadingState(state); equal(state.uncertain, true);
  state = cagnotteAdminFormUpdatedState(state); equal(state.uncertain, true);
  const raced = cagnotteAdminInspectionSuccessState(state, { ...inspection, history: [] });
  equal(raced.uncertain, true); equal(raced.pendingOperation, operation); ok(raced.refundPreview);
  const html = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={{ ...raced, phase: "ready" }} />);
  match(html, /Une opération précédente reste à confirmer/); match(html, /Réinspecter avant toute nouvelle tentative/); match(html, /Rejouer exactement l’opération précédente/);
  match(html, /Type : remboursement/); match(html, /Référence métier : Reference-Figee/); match(html, /Aucune nouvelle déclaration ne peut être créée/);
  match(html, /Confirmer l’enregistrement<\/button>/); match(html, /button[^>]*disabled=""[^>]*>Confirmer l’enregistrement/);
  const wrongReference = cagnotteAdminInspectionSuccessState(raced, { ...inspection, history: [{ ...inspection.history[0], source: "admin", reference: "autre-reference" }] });
  equal(wrongReference.uncertain, true); equal(wrongReference.pendingOperation, operation);
  const committed = { ...inspection, history: [{ ...inspection.history[0], source: "admin" as const, reference: "reference-figee",
    businessFingerprint: cagnotteAdminRefundBusinessFingerprint(operation.payload) }] };
  let replayed = "";
  await retryCagnotteAdminFrozenOperation(operation, inspection.order.id, { refund: async (payload) => { replayed = JSON.stringify(payload); return { ...refund(), alreadyRecorded: true }; }, correction: async () => correctionReview() });
  equal(replayed, JSON.stringify(operation.payload));
  const resolved = cagnotteAdminInspectionSuccessState(raced, committed, "Déclaration retrouvée");
  equal(resolved.uncertain, false); equal(resolved.pendingOperation, null); equal(resolved.refundPreview, null);
});
await test("operation correction incertaine survit a la course et ne change pas de commande", async () => {
  const input = { orderId: inspection.order.id, targetEventId: inspection.history[0].id, expectedRevision: 0,
    replacementReturns: [{ lineId: "line-0", additionalNetCents: 2500 }], deliveryRefundCents: 0, declaredFinancialCents: 2300,
    correctionReason: "Correction figée", correctionReference: "Correction-Figee", expectedPreviewVersion: "d".repeat(64) };
  const operation = freezeCagnotteAdminCorrection(input);
  input.correctionReference = "seconde-reference-interdite";
  let state = cagnotteAdminFrozenOperationState({ ...base, mode: "correction", correctionPreview: correctionReview() }, operation,
    new CagnotteAdminRequestError("Serveur indisponible", "server", true));
  state = cagnotteAdminInspectionSuccessState(state, inspection);
  equal(state.uncertain, true); equal(state.pendingOperation, operation); ok(state.correctionPreview);
  await rejects(() => retryCagnotteAdminFrozenOperation(operation, "AUTRE-COMMANDE", { refund: async () => refund(), correction: async () => correctionReview() }), /autre commande/);
  const committed = { ...inspection, history: [...inspection.history, { id: "e".repeat(64), type: "correction" as const, revision: 1,
    recordedAt: "2026-09-06T10:05:00.000Z", reference: "correction-figee", businessFingerprint: cagnotteAdminCorrectionBusinessFingerprint(operation.payload), declaredFinancialCents: 2300,
    returnedProductNetCents: 2500, financialCents: 2300, cagnotteRestitutionCents: 200, resultingAvailableCents: 1660,
    effective: true, targetEventId: inspection.history[0].id }] };
  let replayed = "";
  await retryCagnotteAdminFrozenOperation(operation, inspection.order.id, { refund: async () => refund(), correction: async (payload) => { replayed = JSON.stringify(payload); return { ...correctionReview(), alreadyRecorded: true }; } });
  equal(replayed, JSON.stringify(operation.payload)); equal(operation.payload.correctionReference, "Correction-Figee");
  const resolved = cagnotteAdminInspectionSuccessState(state, committed);
  equal(resolved.uncertain, false); equal(resolved.pendingOperation, null); equal(resolved.correctionPreview, null);
  const pending = { current: operation };
  clearCagnotteAdminPendingOperation(pending); equal(pending.current, null);
});
await test("rejet definitif du premier envoi invalide les apercus et rend une nouvelle preview obligatoire", () => {
  const operation = freezeCagnotteAdminRefund({ orderId: inspection.order.id,
    additionalReturns: [{ lineId: "line-0", additionalNetCents: 2500 }], deliveryRefundCents: 0,
    source: "admin", reference: "rejet-definitif", declaredFinancialCents: 2300, reason: "product_return",
    confirmedAt: "2026-09-06T10:00:00.000Z", expectedPreviewVersion: "c".repeat(64) });
  const state = cagnotteAdminDefinitiveRejectionState({ ...base, refundPreview: refund(), correctionPreview: correctionReview(),
    uncertain: true, pendingOperation: operation, recoveryBlocked: true },
  new CagnotteAdminRequestError("Prévisualisation périmée.", "refund_preview_stale", false));
  equal(state.refundPreview, null); equal(state.correctionPreview, null); equal(state.pendingOperation, null);
  equal(state.uncertain, false); equal(state.recoveryBlocked, false); match(state.notice, /périmée/i);
  const html = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={state} />);
  doesNotMatch(html, /Conséquences calculées par le serveur|Rejouer exactement l’opération précédente/);
});
await test("storage pre-send revenu vide debloque apres reinspection sans remount", () => {
  const blocked = cagnotteAdminStorageBlockedState({ ...base, refundPreview: refund() }, "Stockage temporairement indisponible.", null);
  equal(blocked.recoveryBlocked, true);
  equal(blocked.uncertain, true);
  const recovered = canRecoverCagnotteAdminPreSendStorageFailure({
    recoveryBlocked: blocked.recoveryBlocked,
    reconciliation: { status: "empty" },
    currentOperation: null,
    mutationInFlight: null,
  });
  equal(recovered, true);
  let ready = cagnotteAdminInspectionSuccessState({ ...blocked, recoveryBlocked: !recovered }, inspection);
  ready = cagnotteAdminFormUpdatedState(ready);
  equal(ready.recoveryBlocked, false);
  equal(ready.uncertain, false);
  equal(ready.pendingOperation, null);
  equal(ready.refundPreview, null);
  equal(ready.correctionPreview, null);
  const html = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={ready} />);
  doesNotMatch(html, /<fieldset disabled=""/);
  match(html, />Prévisualiser sur le serveur<\/button>/);
  doesNotMatch(html, /Reprise locale bloquée|Rejouer exactement l’opération précédente/);
});
await test("H19 preuve terminale abandonne le pending puis la reinspection rend une nouvelle operation possible", () => {
  const operation = freezeCagnotteAdminRefund({ orderId: inspection.order.id,
    additionalReturns: [{ lineId: "line-0", additionalNetCents: 2500 }], deliveryRefundCents: 0,
    source: "admin", reference: "h19-terminal", declaredFinancialCents: 2300, reason: "product_return",
    confirmedAt: "2026-09-06T10:00:00.000Z", expectedPreviewVersion: "d".repeat(64) });
  const terminal = cagnotteAdminTerminalReinspectionState({ ...base, refundPreview: refund(), correctionPreview: correctionReview(),
    uncertain: true, pendingOperation: operation, recoveryBlocked: true }, "Fingerprint terminal.");
  equal(terminal.pendingOperation, null);
  equal(terminal.recoveryBlocked, false);
  equal(terminal.refundPreview, null);
  equal(terminal.correctionPreview, null);
  const ready = cagnotteAdminInspectionSuccessState(terminal, inspection, terminal.notice);
  equal(ready.uncertain, false);
  equal(ready.recoveryBlocked, false);
  equal(ready.pendingOperation, null);
});
await test("acquisition non inscrite affiche zero gain mais conserve financement et reservation", () => {
  const notEnrolled: CagnotteAdminInspection = { ...inspection,
    operationalState: { code: "accrual_not_enrolled", label: "AUCUN GAIN POUR CETTE COMMANDE", detail: "La commande utilise éventuellement la cagnotte, mais l’acquisition fidélité n’était pas active lors de sa création." },
    enrollment: { ...inspection.enrollment, enrolled: false, accrualEnrollment: "not_enrolled" },
    accrual: { present: false, initialGainCents: 0, remainingGainCents: 0, paymentConfirmed: false, deliveryConfirmed: false, credited: false, compartment: "none", cancelled: false },
  };
  const html = renderToStaticMarkup(<CagnotteAdminToolsView mutationsEnabled model={{ ...base, inspection: notEnrolled }} />);
  for (const text of ["AUCUN GAIN POUR CETTE COMMANDE", "Acquisition fidélité :", "non inscrite", "Aucun gain attribué", "Gain attribué", "0,00", "Consommée", "Cagnotte consommée", "8,00", "Paiement externe total", "92,00"]) match(html, new RegExp(text));
  doesNotMatch(html, /Gain estimé|Gain en attente|Gain disponible|PAIEMENT À CONFIRMER/);
});
await test("verrou synchrone : double clic et entree ne lancent qu une operation", async () => {
  const lock = { current: false }; let calls = 0, release!: () => void;
  const pending = new Promise<void>((resolvePromise) => { release = resolvePromise; });
  const first = runCagnotteAdminLocked(lock, async () => { calls += 1; await pending; }, () => undefined);
  const second = runCagnotteAdminLocked(lock, async () => { calls += 1; }, () => undefined);
  equal(calls, 1); release(); await Promise.all([first, second]); equal(lock.current, false);
});
await test("changement commande ou identite invalide les reponses anciennes", () => {
  const identity = createCagnotteAdminResponseIdentity(); const first = identity.next(); ok(identity.isCurrent(first));
  identity.invalidate(); equal(identity.isCurrent(first), false); const second = identity.next(); ok(identity.isCurrent(second));
});
await test("ecriture reussie recharge inspection et resume de la seule commande", async () => {
  const calls: string[] = [];
  await refreshCagnotteAdminAfterWrite(async () => { calls.push("inspection"); }, async () => { calls.push("order"); });
  equal(calls.sort().join(","), "inspection,order");
});
await test("deux rendus de la meme commande invalident seulement leur inspection paire", () => {
  const channel = createCagnotteAdminRefreshChannel();
  const calls: string[] = [];
  const desktop = () => { calls.push("desktop"); };
  const mobile = () => { calls.push("mobile"); };
  const other = () => { calls.push("other"); };
  const stopDesktop = channel.subscribe("commande-a", desktop);
  const stopMobile = channel.subscribe("commande-a", mobile);
  channel.subscribe("commande-b", other);
  channel.publish("commande-a", desktop);
  equal(calls.join(","), "mobile");
  stopDesktop(); stopMobile();
  channel.publish("commande-a");
  equal(calls.join(","), "mobile");
});
await test("un rejet definitif resout l instance source et synchronise le panneau pair de la meme page", () => {
  const channel = createCagnotteAdminRefreshChannel();
  const calls: string[] = [];
  const desktop = () => { calls.push("desktop"); };
  const mobile = () => { calls.push("mobile"); };
  channel.subscribe("commande-a", desktop);
  channel.subscribe("commande-a", mobile);
  channel.publishAfterLocalResolution("commande-a", desktop, () => { calls.push("local-resolution"); });
  equal(calls.join(","), "local-resolution,mobile");
});
await test("inspection concluante synchronise deux composants montes sans mutation ni boucle", async () => {
  await exerciseMountedInspectionSynchronization();
});
await test("datetime-local Europe Paris conserve l instant local sans proposer le futur", () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "Europe/Paris";
  try {
    const now = new Date("2026-07-15T12:34:45.000Z");
    const proposed = cagnotteRefundDateTimeLocalValue(now);
    equal(proposed, "2026-07-15T14:34:45");
    const serialized = cagnotteRefundDateTimeLocalToIso(proposed);
    equal(serialized, "2026-07-15T12:34:45.000Z");
    ok(Date.parse(serialized) <= now.valueOf());
    throws(() => cagnotteRefundDateTimeLocalToIso("2026-07-15T14:34"), /invalide/);
    throws(() => cagnotteRefundDateTimeLocalToIso("2026-07-15T25:99"), /invalide/);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});
await test("date admin francaise gere valeur absente et invalide", () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "Europe/Paris";
  try {
    match(formatAdminDateTime("2026-09-06T20:15:00.000Z"), /6 sept\. 2026, 22:15/);
    equal(formatAdminDateTime(undefined), "");
    equal(formatAdminDateTime("date-invalide"), "");
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});
await test("non admin attendu reste silencieux, vrais echecs restent visibles", () => {
  equal(isExpectedNonAdminLookupError({ code: "permission-denied" }), true);
  equal(isExpectedNonAdminLookupError({ code: "firestore/permission-denied" }), true);
  equal(isExpectedNonAdminLookupError({ code: "unavailable" }), false);
  equal(isExpectedNonAdminLookupError(new Error("network")), false);
});
await test("date de confirmation admin formatee", async () => {
  const admin = await readFile(resolve("src/pages/admin/AdminPage.tsx"), "utf8");
  match(admin, /formatAdminDateTime\(order\.paymentConfirmedAt\)/);
  doesNotMatch(admin, /Confirmé le \{order\.paymentConfirmedAt\}/);
});
await test("conversion euros stricte sans calcul de fidelite client", () => {
  equal(eurosInputToCents("23,00"), 2300); equal(eurosInputToCents("0"), 0);
  for (const invalid of ["-1", "1.234", "1e3", "abc"]) { let failed = false; try { eurosInputToCents(invalid); } catch { failed = true; } ok(failed); }
});
await test("aperçu genere autonome, statique et sans ressource distante", async () => {
  const path = resolve("node_modules/.cache/verdanza-cagnotte-preview/administration-cagnotte.html");
  const html = await readFile(path, "utf8"); match(html, /Démonstration — données fictives/); match(html, /Outils administratifs de cagnotte/);
  equal(/<script\b|https?:\/\/|firebase|analytics|href\s*=|<form\b/i.test(html), false);
});
console.log(`FINALISATION 2 : ${tests} contrôles d’interface réussis, aperçu inerte.`);

async function exerciseMountedInspectionSynchronization() {
  const entry = `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { CagnotteAdminTools } from "./src/components/cagnotte/CagnotteAdminTools.tsx";
    import { freezeCagnotteAdminCorrection, freezeCagnotteAdminRefund } from "./src/lib/cagnotteAdminController.ts";
    import { createCagnotteAdminFrozenOperationStore } from "./src/lib/cagnotteAdminFrozenOperationStorage.ts";
    import { cagnotteAdminCorrectionBusinessFingerprint, cagnotteAdminRefundBusinessFingerprint } from "./src/lib/cagnotteAdminOperationIdentity.ts";

    const scenario = globalThis.__scenario;
    const mainOrderId = "commande-a";
    const otherOrderId = "commande-b";
    const entries = new Map();
    const stats = { inspections: {}, mutations: 0 };
    const modes = { [mainOrderId]: "absent", [otherOrderId]: "absent" };
    const storage = {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => {
        if (scenario.outcome === "persistence_error" && key.includes("frozen-resolution")) {
          throw new Error("Persistance terminale simulée indisponible");
        }
        entries.set(key, value);
      },
      removeItem: (key) => { entries.delete(key); },
    };
    const store = createCagnotteAdminFrozenOperationStore({
      storage,
      now: () => 1_789_315_200_000,
      exclusiveClaim: { request: async (_name, run) => run() },
    });
    const operationFor = (kind, orderId, suffix) => kind === "refund"
      ? freezeCagnotteAdminRefund({
          orderId,
          additionalReturns: [{ lineId: "line-0", additionalNetCents: 2500 }],
          deliveryRefundCents: 0,
          source: "admin",
          reference: "inspection-refund-" + suffix,
          declaredFinancialCents: 2300,
          reason: "product_return",
          confirmedAt: "2026-09-06T10:00:00.000Z",
          expectedPreviewVersion: "c".repeat(64),
        })
      : freezeCagnotteAdminCorrection({
          orderId,
          targetEventId: "a".repeat(64),
          expectedRevision: 0,
          replacementReturns: [{ lineId: "line-0", additionalNetCents: 2500 }],
          deliveryRefundCents: 0,
          declaredFinancialCents: 2300,
          correctionReason: "Correction fictive " + suffix,
          correctionReference: "inspection-correction-" + suffix,
          expectedPreviewVersion: "d".repeat(64),
        });
    const mainOperation = operationFor(scenario.kind, mainOrderId, "a");
    const otherOperation = operationFor("refund", otherOrderId, "b");
    const operations = { [mainOrderId]: mainOperation, [otherOrderId]: otherOperation };
    for (const operation of Object.values(operations)) {
      store.persistBeforeSend(operation);
      store.updateState(operation, "uncertain");
    }
    const baseInspection = ${JSON.stringify(fixture())};
    const inspectionFor = (orderId, mode) => {
      const operation = operations[orderId];
      const fingerprint = operation.kind === "refund"
        ? cagnotteAdminRefundBusinessFingerprint(operation.payload)
        : cagnotteAdminCorrectionBusinessFingerprint(operation.payload);
      const returnedFingerprint = mode === "mismatch"
        ? (fingerprint[0] === "0" ? "1" : "0") + fingerprint.slice(1)
        : fingerprint;
      const history = mode === "recorded" || mode === "mismatch"
        ? [{
            id: "e".repeat(64),
            type: operation.kind === "refund" ? "initial_declaration" : "correction",
            revision: operation.kind === "refund" ? 0 : operation.payload.expectedRevision + 1,
            recordedAt: "2026-09-06T10:05:00.000Z",
            reference: operation.kind === "refund" ? operation.payload.reference : operation.payload.correctionReference,
            businessFingerprint: returnedFingerprint,
            source: "admin",
            declaredFinancialCents: operation.payload.declaredFinancialCents,
            returnedProductNetCents: 2500,
            financialCents: 2300,
            cagnotteRestitutionCents: 200,
            resultingAvailableCents: 1745,
            effective: true,
          }]
        : [];
      return { ...baseInspection, order: { ...baseInspection.order, id: orderId }, history };
    };
    globalThis.__adminHarness = {
      inspect: async (orderId) => {
        stats.inspections[orderId] = (stats.inspections[orderId] ?? 0) + 1;
        const mode = modes[orderId] ?? "absent";
        if (mode === "request_error") throw new Error("Inspection simulée indisponible");
        return inspectionFor(orderId, mode);
      },
      mutation: () => {
        stats.mutations += 1;
        throw new Error("Une mutation ne doit pas être appelée par ce test");
      },
    };
    globalThis.__setInspectionMode = (orderId, mode) => { modes[orderId] = mode; };
    globalThis.__adminStats = stats;
    createRoot(document.getElementById("root")).render(
      <main>
        <div data-panel="desktop"><CagnotteAdminTools mutationsEnabled orderId={mainOrderId} enabled frozenOperationStore={store} /></div>
        <div data-panel="mobile"><CagnotteAdminTools mutationsEnabled orderId={mainOrderId} enabled frozenOperationStore={store} /></div>
        <div data-panel="other"><CagnotteAdminTools mutationsEnabled orderId={otherOrderId} enabled frozenOperationStore={store} /></div>
      </main>,
    );
  `;
  const bundle = await build({
    stdin: { contents: entry, loader: "tsx", resolveDir: process.cwd(), sourcefile: "cagnotte-admin-dom-harness.tsx" },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    define: { "import.meta.env": "{}" },
    logLevel: "silent",
    plugins: [{
      name: "cagnotte-admin-dom-services",
      setup(buildApi) {
        buildApi.onResolve({ filter: /cagnotteAdminService$/ }, () => ({ path: "admin-service", namespace: "cagnotte-admin-test" }));
        buildApi.onResolve({ filter: /ordersService$/ }, () => ({ path: "orders-service", namespace: "cagnotte-admin-test" }));
        buildApi.onLoad({ filter: /^admin-service$/, namespace: "cagnotte-admin-test" }, () => ({
          loader: "ts",
          contents: `
            export class CagnotteAdminRequestError extends Error {
              constructor(message, code, uncertain) { super(message); this.code = code; this.uncertain = uncertain; }
            }
            export const inspectCagnotteOrder = (orderId) => globalThis.__adminHarness.inspect(orderId);
            const mutation = () => globalThis.__adminHarness.mutation();
            export const previewOrderRefund = mutation;
            export const previewRefundCorrection = mutation;
            export const recordOrderRefund = mutation;
            export const recordRefundCorrection = mutation;
            export const recordUnpaidReview = mutation;
          `,
        }));
        buildApi.onLoad({ filter: /^orders-service$/, namespace: "cagnotte-admin-test" }, () => ({
          loader: "ts",
          contents: "export const updateOrderAdminFields = () => globalThis.__adminHarness.mutation();",
        }));
      },
    }],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of [
      { kind: "refund", outcome: "recorded" },
      { kind: "correction", outcome: "recorded" },
      { kind: "refund", outcome: "absent" },
      { kind: "refund", outcome: "mismatch" },
      { kind: "refund", outcome: "request_error" },
      { kind: "refund", outcome: "persistence_error" },
    ]) {
      const context = await browser.newContext();
      let networkRequests = 0;
      await context.route("**/*", (route) => {
        networkRequests += 1;
        return route.abort();
      });
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => { pageErrors.push(error.message); });
      await page.setContent("<!doctype html><html lang=\"fr\"><body><div id=\"root\"></div></body></html>");
      await page.evaluate((value) => { (globalThis as unknown as { __scenario: unknown }).__scenario = value; }, scenario);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const buttonName = "Réinspecter avant toute nouvelle tentative";
      const desktopButton = page.locator('[data-panel="desktop"]').getByRole("button", { name: buttonName });
      const mobileButton = page.locator('[data-panel="mobile"]').getByRole("button", { name: buttonName });
      const otherButton = page.locator('[data-panel="other"]').getByRole("button", { name: buttonName });
      await Promise.all([
        desktopButton.waitFor({ timeout: 2_000 }),
        mobileButton.waitFor({ timeout: 2_000 }),
        otherButton.waitFor({ timeout: 2_000 }),
      ]);
      const before = await readAdminHarnessStats(page);
      equal(before.inspections["commande-a"], 2, `${scenario.kind}/${scenario.outcome} monte deux instances de la commande cible`);
      equal(before.inspections["commande-b"], 1, `${scenario.kind}/${scenario.outcome} monte une commande isolée`);
      await page.evaluate((outcome) => {
        const scope = globalThis as unknown as { __setInspectionMode: (orderId: string, mode: string) => void };
        scope.__setInspectionMode("commande-a", outcome === "persistence_error" ? "recorded" : outcome);
      }, scenario.outcome);
      await desktopButton.click();
      if (scenario.outcome === "recorded") {
        await desktopButton.waitFor({ state: "detached", timeout: 2_000 });
        try {
          await mobileButton.waitFor({ state: "detached", timeout: 1_000 });
        } catch {
          equal(await mobileButton.count(), 0, `${scenario.kind} : le panneau pair reste verrouillé après la preuve serveur`);
        }
        equal(await otherButton.count(), 1, `${scenario.kind} : une autre commande reste isolée`);
      } else {
        await page.waitForTimeout(100);
        equal(await desktopButton.count(), 1, `${scenario.kind}/${scenario.outcome} conserve le verrou source`);
        equal(await mobileButton.count(), 1, `${scenario.kind}/${scenario.outcome} conserve le verrou pair`);
        equal(await otherButton.count(), 1, `${scenario.kind}/${scenario.outcome} conserve la commande isolée`);
      }
      await page.waitForTimeout(100);
      const converged = await readAdminHarnessStats(page);
      await page.waitForTimeout(100);
      deepEqual(await readAdminHarnessStats(page), converged, `${scenario.kind}/${scenario.outcome} se stabilise sans boucle d inspection`);
      if (scenario.outcome === "recorded") {
        ok(converged.inspections["commande-a"] >= 4 && converged.inspections["commande-a"] <= 5,
          `${scenario.kind} limite la convergence aux inspections automatiques des deux panneaux`);
      } else {
        equal(converged.inspections["commande-a"], 3, `${scenario.kind}/${scenario.outcome} ne notifie pas le panneau pair`);
      }
      equal(converged.mutations, 0, `${scenario.kind}/${scenario.outcome} n envoie aucune mutation`);
      equal(converged.inspections["commande-b"], 1, `${scenario.kind}/${scenario.outcome} ne réinspecte pas l autre commande`);
      equal(networkRequests, 0, `${scenario.kind}/${scenario.outcome} ne contacte aucune ressource externe`);
      deepEqual(pageErrors, [], `${scenario.kind}/${scenario.outcome} ne produit aucune erreur navigateur non gérée`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function readAdminHarnessStats(page: import("playwright").Page) {
  return page.evaluate(() => {
    const stats = (globalThis as unknown as { __adminStats: { inspections: Record<string, number>; mutations: number } }).__adminStats;
    return { inspections: { ...stats.inspections }, mutations: stats.mutations };
  });
}

function fixture(): CagnotteAdminInspection {
  const effective = { lines: [{ lineId: "line-0", returnedNetCents: 2500 }], returnedProductNetCents: 2500, productFinancialCents: 2300,
    cagnotteRestitutionCents: 200, deliveryFinancialCents: 0, totalFinancialCents: 2300 };
  return { kind: "administrative_refund_inspection", order: { id: "CMD-FICTIVE", customer: { id: "client-fictif", name: "Camille Fictive", email: "camille@example.test" },
    orderStatus: "delivered", paymentStatus: "paid", totalCents: 10000, paymentAmountCents: 9200, deliveryCents: 0 },
    financing: { productsNetCents: 10000, cagnotteCents: 800, externalProductsCents: 9200, externalTotalCents: 9200, deliveryCents: 0 },
    operationalState: { code: "refund_recorded", label: "REMBOURSEMENT/CORRECTION ENREGISTRÉ", detail: "Consultez l’historique administratif effectif." },
    enrollment: { enrolled: true, accrualEnrollment: "enrolled", beneficiaryId: "client-fictif", programVersion: "programme-fictif-v1", calculationVersion: "cagnotte-math-v1", createdAtEpochMs: 1000 },
    accrual: { present: true, initialGainCents: 460, remainingGainCents: 345, paymentConfirmed: true, deliveryConfirmed: true, credited: true, compartment: "available", cancelled: false },
    wallet: { pendingCents: 0, availableCents: 1745, reservedCents: 0, regularizationCents: 0 },
    reservation: { applicable: true, amountCents: 800, state: "consumed", requiresReview: false, cumulativeRestitutedCents: 200 },
    refund: { history: [{ id: "a".repeat(64), type: "initial_declaration", revision: 0, recordedAt: "2026-09-06T10:00:00.000Z", effective: true }],
      latest: { id: "a".repeat(64), type: "initial_declaration", revision: 0, recordedAt: "2026-09-06T10:00:00.000Z" }, latestRevision: 0, requiresReview: false },
    movements: [{ id: "f".repeat(64), event: "credit_refunded_after_return", pendingDeltaCents: 0, availableDeltaCents: 200, reservedDeltaCents: 0, regularizationDeltaCents: 0, recordedAtEpochMs: 1000 }],
    movementHistory: { complete: true, omittedLegacyUndatedCount: 0 },
    lines: [{ lineId: "line-0", label: "Produit fictif", initialNetCents: 10000, returnedNetCents: 2500, remainingNetCents: 7500 }], effective,
    history: [{ id: "a".repeat(64), type: "initial_declaration", revision: 0, recordedAt: "2026-09-06T10:00:00.000Z", reference: "demo", businessFingerprint: "a".repeat(64), source: "admin", declaredFinancialCents: 2300,
      returnedProductNetCents: 2500, financialCents: 2300, cagnotteRestitutionCents: 200, resultingAvailableCents: 1745, effective: true }],
    correctionTarget: { eventId: "a".repeat(64), revision: 0, effective,
      lines: [{ lineId: "line-0", maxReplacementNetCents: 10000 }] }, unpaid: { reservedAmountCents: 0, reservationState: "consumed", reservedAt: "2026-09-02T08:00:00.000Z", ageHours: 100, reviewRequired: true,
      payment: { status: "payment_link_sent", uncertain: true, confirmedAt: null }, linkTransmission: { requestId: "demo", status: "unknown", transportStatus: "unknown", sendingActive: false, uncertain: true },
      stateVersion: "b".repeat(64), review: null } };
}
function eligibleOrder() {
  const snapshot = calculateCagnotte({ lines: [{ lineId: "line", initialCents: 10000 }], discounts: [], requestedCagnotteCents: 0, availableCagnotteCents: 0 });
  return { id: "CMD-INSCRITE", customerId: "client-fictif", cagnotte: { schemaVersion: 1 as const, beneficiaryId: "client-fictif",
    programVersion: "programme-fictif-v1", calculationVersion: "cagnotte-math-v1" as const, createdAtEpochMs: 1000, snapshot } };
}
function mixedEligibleOrder() {
  const snapshot = calculateCagnotte({ lines: [{ lineId: "line", initialCents: 10000 }], discounts: [], requestedCagnotteCents: 800, availableCagnotteCents: 2000 });
  const enrollment = { schemaVersion: 1 as const, beneficiaryId: "client-fictif", programVersion: "programme-fictif-v1",
    calculationVersion: "cagnotte-math-v1" as const, createdAtEpochMs: 1000, snapshot };
  return { id: "CMD-MIXTE", customerId: "client-fictif", cagnotte: enrollment,
    cagnotteReservationIntent: { schemaVersion: 1 as const, reservationVersion: "cagnotte-reservation-v1" as const,
      order: { orderId: "CMD-MIXTE", beneficiaryId: enrollment.beneficiaryId, programVersion: enrollment.programVersion,
        createdAtEpochMs: enrollment.createdAtEpochMs, snapshot }, amountCents: snapshot.appliedCagnotteCents } };
}
function projectableOrder(enrollment: Pick<Order, "id" | "customerId" | "cagnotte" | "cagnotteReservationIntent">): Order {
  return {
    ...enrollment,
    customerEmail: "client@example.test",
    customerPhone: "0600000000",
    items: [],
    subtotal: 100,
    deliveryFee: 0,
    total: 100,
    paymentStatus: "paid",
    orderStatus: "delivered",
    deliveryMethod: "postal",
    deliveryAddress: { firstName: "Camille", lastName: "Fictive", line1: "1 rue du Test", postalCode: "13000", city: "Marseille", country: "France" },
    createdAt: "2026-09-11T08:00:00.000Z",
    updatedAt: "2026-09-11T08:00:00.000Z",
  };
}
function refund(): RefundPreview { return { kind: "administrative_refund_recorded", orderId: "CMD-FICTIVE", currency: "EUR", additionalReturns: [{ lineId: "line-0", additionalNetCents: 2500 }],
  productFinancialCents: 2300, cagnotteRestitutionCents: 200, deliveryFinancialCents: 0, totalFinancialCents: 2300,
  correction: { theoreticalCents: 115, appliedCents: 115, pendingDeltaCents: 0, availableDeltaCents: -115, regularizationDeltaCents: 0, remainingGainCents: 345 },
  restitution: { grossCents: 200, compensationCents: 0, availableIncreaseCents: 200, availableAfterCents: 1745, cumulativeCents: 200, reservationState: "consumed" },
  before: { lines: [{ lineId: "line-0", returnedNetCents: 0 }], returnedProductNetCents: 0, productFinancialCents: 0, cagnotteRestitutionCents: 0, deliveryFinancialCents: 0, totalFinancialCents: 0 },
  after: inspection.effective, previewVersion: "c".repeat(64), recordedAt: "2026-09-06T10:00:00.000Z" }; }
function correctionReview(): CorrectionPreview { return { kind: "correction_requires_review", orderId: "CMD-FICTIVE", currency: "EUR", targetEventId: "a".repeat(64), previousRevision: 0, revision: 1,
  replacementReturns: [], deliveryRefundCents: 0, declaredFinancialCents: 0, previousEffective: inspection.effective,
  effective: { lines: [{ lineId: "line-0", returnedNetCents: 0 }], returnedProductNetCents: 0, productFinancialCents: 0, cagnotteRestitutionCents: 0, deliveryFinancialCents: 0, totalFinancialCents: 0 },
  differential: { returnedProductNetCents: -2500, productFinancialCents: -2300, cagnotteRestitutionCents: -200, deliveryFinancialCents: 0, totalFinancialCents: -2300, loyaltyCents: 115, pendingDeltaCents: 0, availableDeltaCents: -85, regularizationDeltaCents: 0 },
  walletAfter: { pendingCents: 0, availableCents: 40, reservedCents: 800, regularizationCents: 0 }, remainingGainCents: 460, reservationState: "consumed", previewVersion: "d".repeat(64),
  reviewReason: "Le crédit restitué a été réservé ou utilisé après la déclaration." }; }
