import { randomUUID } from "node:crypto";
import { withdrawalReceiptText, type WithdrawalDetails, type WithdrawalReceipt } from "../../src/lib/withdrawal.js";

export function validateWithdrawalBody(body: unknown): WithdrawalDetails {
  if (!body || typeof body !== "object") throw new Error("Déclaration invalide.");
  const input = body as Record<string, unknown>;
  if (input.confirmed !== true) throw new Error("Confirmez votre rétractation après vérification.");
  const text = (key: string, maximum: number) => {
    const value = typeof input[key] === "string" ? input[key].trim() : "";
    const hasControlCharacter = Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    });
    if (value.length > maximum || hasControlCharacter) {
      throw new Error("Un champ de la déclaration est invalide ou trop long.");
    }
    return value;
  };
  const name = text("name", 120);
  const email = text("email", 254);
  const contract = text("contract", 300);
  const items = text("items", 1000) || "totalité de la commande";
  if (name.length < 2) throw new Error("Nom et prénom requis.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Adresse e-mail invalide.");
  if (!contract) throw new Error("Indiquez la commande concernée.");
  return { name, email, contract, items };
}

type DeliveryResult = { status: string };
type WithdrawalDependencies = {
  notifyMerchant: (receipt: WithdrawalReceipt) => Promise<DeliveryResult>;
  acknowledgeCustomer: (receipt: WithdrawalReceipt) => Promise<DeliveryResult>;
  now?: () => Date;
  createId?: () => string;
};

export async function receiveWithdrawal(details: WithdrawalDetails, dependencies: WithdrawalDependencies) {
  const submittedAt = (dependencies.now?.() ?? new Date()).toISOString();
  const id = dependencies.createId?.() ?? randomUUID();
  const receipt: WithdrawalReceipt = {
    ...details, id, submittedAt, text: withdrawalReceiptText(details, submittedAt, id),
  };
  const notification = await dependencies.notifyMerchant(receipt);
  // A skipped or failed contact message is not proof of a received declaration.
  if (notification.status !== "sent") throw new Error("Déclaration non transmise. Réessayez ou écrivez à contact@verdanza.fr.");
  let receiptEmailSent = false;
  try {
    receiptEmailSent = (await dependencies.acknowledgeCustomer(receipt)).status === "sent";
  } catch {
    // The declaration is already received: preserve its receipt instead of asking for a duplicate.
  }
  return { accepted: true as const, receipt, receiptEmailSent };
}
