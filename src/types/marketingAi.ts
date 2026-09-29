import type { MarketingKind, MarketingParameters } from "./marketing.js";

export type MarketingAiBrief = {
  objective: string;
  kind: MarketingKind | "free";
  scope: "all" | "category" | "products";
  category?: "flowers" | "resins" | "oils" | "packs";
  productIds?: string[];
  tone: "discovery" | "new" | "loyalty" | "clearance" | "event" | "other";
  count: number;
  period?: { startsAt: string; endsAt: string };
};
export type MarketingAiProduct = {
  id: string; name: string; category: string; price: number; stock: number;
  formats: Array<{ label: string; totalPrice: number; quantityGrams: number }>;
  aromas: string[]; tags: string[];
};
export type MarketingAiContext = { now: string; timeZone: "Europe/Paris"; products: MarketingAiProduct[] };
export type MarketingAiProposal = {
  id: string; kind: MarketingKind; title: string; concept: string; rationale: string;
  referencedProductIds: string[]; parameters: MarketingParameters;
};
export type MarketingAiProvenance = {
  generationId: string; proposalId: string; provider: string; model: string;
  promptVersion: string; generatedAt: string; requestedBy: string;
  providerResponseId?: string; usage?: { inputTokens: number; outputTokens: number };
  allowedProductIds: string[]; referencedProductIds: string[];
};
export type MarketingAiGeneration = {
  id: string; proposals: MarketingAiProposal[]; provider: string; model: string;
  promptVersion: string; createdAt: string; requestedBy: string;
  providerResponseId?: string; usage?: { inputTokens: number; outputTokens: number };
  replayed: boolean;
};
export type MarketingAiRequest = { generationId: string; brief: MarketingAiBrief };
