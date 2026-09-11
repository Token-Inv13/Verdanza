import React from "react";
import { doesNotMatch, equal, match, ok, rejects, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CagnotteAdminTools,
  CagnotteAdminToolsView,
  type CagnotteAdminViewModel,
} from "../src/components/cagnotte/CagnotteAdminTools.js";
import { cagnotteAdminDefinitiveRejectionState, cagnotteAdminFailureState, cagnotteAdminFormUpdatedState, cagnotteAdminFrozenOperationState, cagnotteAdminInspectionSuccessState, cagnotteAdminLoadingState } from "../src/lib/cagnotteAdminState.js";
import { clearCagnotteAdminPendingOperation, createCagnotteAdminRefreshChannel, createCagnotteAdminResponseIdentity, eurosInputToCents, freezeCagnotteAdminCorrection, freezeCagnotteAdminRefund, refreshCagnotteAdminAfterWrite, retryCagnotteAdminFrozenOperation, runCagnotteAdminLocked } from "../src/lib/cagnotteAdminController.js";
import { CagnotteAdminRequestError } from "../src/services/cagnotteAdminService.js";
import { cagnotteRefundDateTimeLocalToIso, cagnotteRefundDateTimeLocalValue } from "../src/lib/cagnotteAdminDate.js";
import { formatAdminDateTime } from "../src/lib/adminDatePresentation.js";
import { isExpectedNonAdminLookupError } from "../src/lib/adminLookupPresentation.js";
import { shouldMountCagnotteAdminTools } from "../src/lib/cagnotteAdminEligibility.js";
import { calculateCagnotte } from "../src/lib/cagnotteCalculations.js";
import { CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED } from "../src/config/cagnotteFeatures.js";
import { cagnotteAdminCorrectionBusinessFingerprint, cagnotteAdminRefundBusinessFingerprint } from "../src/lib/cagnotteAdminOperationIdentity.js";
import type { CagnotteAdminInspection, CorrectionPreview, RefundPreview } from "../src/types/cagnotteAdmin.js";
import { adminOrderRow } from "../src/services/ordersService.js";
import type { Order } from "../src/types/index.js";

let tests = 0;
function test(name: string, run: () => void | Promise<void>) {
  return Promise.resolve().then(run).then(() => { tests += 1; console.log(`OK [Interface admin] ${name}`); });
}
const inspection = fixture();
const base: CagnotteAdminViewModel = { phase: "ready", inspection, mode: "refund", refundPreview: null, correctionPreview: null, notice: "", uncertain: false, pendingOperation: null, recoveryBlocked: false, busy: false };

await test("garde normal desactive : aucun rendu ni appel", () => {
  equal(CAGNOTTE_ADMIN_TOOLS_DISPLAY_ENABLED, false);
  equal(renderToStaticMarkup(<CagnotteAdminTools orderId="demo" enabled={false} />), "");
});
await test("commande historique : aucun montage meme avec garde simulee ouverte", () => {
  equal(shouldMountCagnotteAdminTools({ displayEnabled: true, orderSource: "firestore", order: { id: "historique", customerId: "client" } }), false);
});
await test("projection admin conserve une inscription acquisition seule sans intention", () => {
  const source = projectableOrder(eligibleOrder());
  const projected = adminOrderRow(source);
  equal(projected.cagnotte, source.cagnotte);
  equal(projected.cagnotteReservationIntent, undefined);
  equal(shouldMountCagnotteAdminTools({ displayEnabled: true, orderSource: "firestore", order: projected }), true);
});
await test("projection admin conserve une inscription mixte et son intention canonique", () => {
  const source = projectableOrder(mixedEligibleOrder());
  const projected = adminOrderRow(source);
  equal(projected.cagnotte, source.cagnotte);
  equal(projected.cagnotteReservationIntent, source.cagnotteReservationIntent);
  equal(shouldMountCagnotteAdminTools({ displayEnabled: true, orderSource: "firestore", order: projected }), true);
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
  const html = renderToStaticMarkup(<CagnotteAdminToolsView model={base} />);
  for (const text of ["Enregistrer un remboursement déjà confirmé", "Cette action enregistre votre déclaration.",
    "Elle n’effectue aucun remboursement bancaire.", "Consulter", "Confirmer paiement / livraison",
    "Enregistrer un retour", "Corriger une déclaration", "Tout le montant restant"]) match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  doesNotMatch(html, /Revoir \/ annuler un impayé/);
});
await test("inspection lisible distingue inscription, gain commande et portefeuille global", () => {
  const html = renderToStaticMarkup(<CagnotteAdminToolsView model={base} />);
  for (const text of ["REMBOURSEMENT/CORRECTION ENREGISTRÉ", "Inscription de la commande", "Acquisition fidélité :", "inscrite", "Gain de cette commande",
    "Gain estimé", "Gain en attente", "Gain disponible", "Gain annulé ou réduit", "Portefeuille global du client",
    "Disponible global", "La régularisation est globale au client et peut provenir d’autres commandes.", "Réservation de cette commande", "Consommée", "Journal cagnotte de la commande"]) match(html, new RegExp(text));
});
await test("historique legacy partiel affiche un avertissement discret sans corruption", () => {
  const partial = { ...inspection, movementHistory: { complete: false, omittedLegacyUndatedCount: 2 } };
  const html = renderToStaticMarkup(<CagnotteAdminToolsView model={{ ...base, inspection: partial }} />);
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
  for (const [operationalState, pattern] of cases) match(renderToStaticMarkup(<CagnotteAdminToolsView model={{ ...base, inspection: { ...inspection, operationalState } }} />), pattern);
});
await test("preview et resultat persisté presentent les effets separement", () => {
  const html = renderToStaticMarkup(<CagnotteAdminToolsView model={{ ...base, refundPreview: refund(), notice: "Déclaration enregistrée." }} />);
  for (const text of ["Part financière déclarée", "Cagnotte brute restituée", "Correction du gain", "Compensation", "Disponible estimé"]) match(html, new RegExp(text));
});
await test("correction a verifier affiche le refus cible et sa limite", () => {
  const html = renderToStaticMarkup(<CagnotteAdminToolsView model={{ ...base, mode: "correction", correctionPreview: correctionReview(), notice: "Vérification requise" }} />);
  match(html, /CORRECTION_REQUIRES_REVIEW/); match(html, /réservé ou utilisé/); match(html, /L’original reste dans l’historique/);
  match(html, /Révision actuelle : 0/); match(html, /nouvelle révision : 1/); match(html, /Variation régularisation/);
});
await test("impaye separe transport et reglement, seuil sans automatisme", () => {
  const reserved = { ...inspection,
    reservation: { ...inspection.reservation, state: "reserved" as const, cumulativeRestitutedCents: 0 },
    unpaid: { ...inspection.unpaid, reservationState: "reserved" as const } };
  const html = renderToStaticMarkup(<CagnotteAdminToolsView model={{ ...base, inspection: reserved, mode: "unpaid" }} />);
  for (const text of ["À revoir · plus de 72 heures", "Cagnotte réservée", "Règlement de la commande", "Lien CB envoyé", "Transmission du lien", "Résultat à vérifier", "n’est ni une preuve de paiement ni une preuve d’impayé", "ne révoque pas le lien externe"]) match(html, new RegExp(text));
  doesNotMatch(html, />to_confirm<|>unknown<|Cagnotte consommée/);
});
await test("impaye est masque hors reservation active", () => {
  for (const state of ["consumed", "released", null] as const) {
    const inactive = { ...inspection,
      reservation: { ...inspection.reservation, state },
      unpaid: { ...inspection.unpaid, reservationState: state } };
    const html = renderToStaticMarkup(<CagnotteAdminToolsView model={{ ...base, inspection: inactive, mode: "unpaid" }} />);
    doesNotMatch(html, /Revoir \/ annuler un impayé|Enregistrer la revue|Annuler la commande/);
  }
  const inconsistent = { ...inspection,
    reservation: { ...inspection.reservation, state: "reserved" as const },
    unpaid: { ...inspection.unpaid, reservationState: "consumed" as const } };
  doesNotMatch(renderToStaticMarkup(<CagnotteAdminToolsView model={{ ...base, inspection: inconsistent, mode: "unpaid" }} />),
    /Revoir \/ annuler un impayé|Enregistrer la revue|Annuler la commande/);
});
await test("financement consomme utilise le libelle correspondant", () => {
  const consumed = { ...inspection, unpaid: { ...inspection.unpaid, reservationState: "consumed", reservedAmountCents: 0 } };
  const html = renderToStaticMarkup(<CagnotteAdminToolsView model={{ ...base, inspection: consumed }} />);
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
    ], correctionTarget: { eventId: inspection.history[0].id, revision: 1, effective: zero } };
  const html = renderToStaticMarkup(<CagnotteAdminToolsView model={{ ...base, inspection: corrected, mode: "correction" }} />);
  for (const text of ["Historique administratif", "Déclaration initiale", "Corrigée / inactive", "Correction · neutralisation",
    "Active / effective", "Retour net", "25,00", "Financier", "23,00", "Cagnotte restituée", "2,00",
    "Solde disponible résultant", "16,60", "Aucun flux bancaire n’est modifié"]) match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  doesNotMatch(html, /Conséquences calculées par le serveur|Effet différentiel/);
});
await test("revue et date sont presentees sans codes internes", () => {
  const reviewed = { ...inspection,
    reservation: { ...inspection.reservation, state: "reserved" as const },
    unpaid: { ...inspection.unpaid, reservationState: "reserved" as const,
      review: { outcome: "unpaid_confirmed" as const, source: "fixture", reason: "fixture", reviewedAt: "2026-09-06T10:00:00.000Z", reviewedByEmail: "admin@example.test", current: true } } };
  const html = renderToStaticMarkup(<CagnotteAdminToolsView model={{ ...base, inspection: reviewed, mode: "unpaid" }} />);
  match(html, /Dernière revue : Impayé confirmé après vérification/);
  match(html, /6 sept. 2026/);
  doesNotMatch(html, />unpaid_confirmed<|2026-09-06T10:00:00.000Z/);
});
await test("bouton desactive visuellement distinct", async () => {
  const css = await readFile(resolve("src/styles/cagnotte-admin.css"), "utf8");
  match(css, /\.cagnotte-admin button:disabled\{[^}]*cursor:not-allowed[^}]*opacity:/);
});
await test("mutation en cours desactive les controles et expose aria-busy", () => {
  const html = renderToStaticMarkup(<CagnotteAdminToolsView model={{ ...base, busy: true }} />);
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
  const html = renderToStaticMarkup(<CagnotteAdminToolsView model={{ ...raced, phase: "ready" }} />);
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
  const html = renderToStaticMarkup(<CagnotteAdminToolsView model={state} />);
  doesNotMatch(html, /Conséquences calculées par le serveur|Rejouer exactement l’opération précédente/);
});
await test("acquisition non inscrite affiche zero gain mais conserve financement et reservation", () => {
  const notEnrolled: CagnotteAdminInspection = { ...inspection,
    operationalState: { code: "accrual_not_enrolled", label: "AUCUN GAIN POUR CETTE COMMANDE", detail: "La commande utilise éventuellement la cagnotte, mais l’acquisition fidélité n’était pas active lors de sa création." },
    enrollment: { ...inspection.enrollment, enrolled: false, accrualEnrollment: "not_enrolled" },
    accrual: { present: false, initialGainCents: 0, remainingGainCents: 0, paymentConfirmed: false, deliveryConfirmed: false, credited: false, compartment: "none", cancelled: false },
  };
  const html = renderToStaticMarkup(<CagnotteAdminToolsView model={{ ...base, inspection: notEnrolled }} />);
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
    correctionTarget: { eventId: "a".repeat(64), revision: 0, effective }, unpaid: { reservedAmountCents: 0, reservationState: "consumed", reservedAt: "2026-09-02T08:00:00.000Z", ageHours: 100, reviewRequired: true,
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
