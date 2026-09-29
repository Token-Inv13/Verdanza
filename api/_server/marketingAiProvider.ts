import type { MarketingAiBrief, MarketingAiContext } from "../../src/types/marketingAi.js";
import { MARKETING_AI_POLICY, MARKETING_AI_SCHEMA } from "./marketingAiSchema.js";

export class MarketingAiError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}
export type MarketingAiProviderResult = {
  payload: unknown; provider: string; model: string; responseId?: string;
  usage?: { inputTokens: number; outputTokens: number };
};
export interface MarketingAiProvider {
  generateMarketingProposals(context: MarketingAiContext, brief: MarketingAiBrief,
    signal: AbortSignal): Promise<MarketingAiProviderResult>;
}
export const marketingAiLimits = {
  maxProposals: 3, maxBrief: 2000, maxProducts: 60, maxSelectedProducts: 30,
  timeoutMs: 25000, maxOutputTokens: 5000, maxOutputBytes: 64000,
  maxResponseBytes: 160000, maxContextBytes: 36000, perHour: 6, minIntervalMs: 10000
} as const;

async function boundedJson(response: Response) {
  if (!response.body) throw new MarketingAiError("Réponse IA vide.", "ai_invalid_response", 502);
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > marketingAiLimits.maxResponseBytes) throw new MarketingAiError("Réponse IA trop volumineuse.", "ai_output_limit", 502);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; }
  catch { throw new MarketingAiError("Réponse IA illisible.", "ai_invalid_response", 502); }
}
export function createOpenAiMarketingProvider(apiKey: string, model: string, transport: typeof fetch = fetch): MarketingAiProvider {
  return {
    async generateMarketingProposals(context, brief, signal) {
      let response: Response;
      try {
        response = await transport("https://api.openai.com/v1/responses", {
          method: "POST", redirect: "error", signal,
          headers: { authorization: "Bearer " + apiKey, "content-type": "application/json" },
          body: JSON.stringify({ model, store: false, instructions: MARKETING_AI_POLICY,
            input: [{ role: "user", content: JSON.stringify({ catalogData: context, adminBriefData: brief }) }],
            max_output_tokens: marketingAiLimits.maxOutputTokens,
            text: { format: { type: "json_schema", name: "verdanza_marketing_proposals", strict: true, schema: MARKETING_AI_SCHEMA } }
          })
        });
      } catch {
        throw new MarketingAiError(signal.aborted ? "Délai de génération dépassé." : "Fournisseur IA indisponible.",
          signal.aborted ? "ai_timeout" : "ai_unavailable", 503);
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new MarketingAiError(response.status === 429 ? "Quota du fournisseur IA atteint." : "Le fournisseur IA a refusé la génération.",
          response.status === 429 ? "ai_quota" : response.status === 401 || response.status === 403 ? "ai_configuration" : "ai_unavailable",
          response.status === 429 ? 429 : 503);
      }
      const data = await boundedJson(response);
      if (data.status !== "completed") throw new MarketingAiError("La réponse IA est interrompue ou tronquée. Aucune proposition enregistrée.", "ai_truncated", 502);
      const texts: string[] = [];
      for (const item of Array.isArray(data.output) ? data.output : []) {
        if (!item || item.type !== "message") continue;
        for (const content of Array.isArray(item.content) ? item.content : []) {
          if (content.type === "refusal") throw new MarketingAiError("Le fournisseur IA a refusé cette demande.", "ai_refused", 422);
          if (content.type === "output_text" && typeof content.text === "string") texts.push(content.text);
        }
      }
      if (texts.length !== 1 || Buffer.byteLength(texts[0] || "") > marketingAiLimits.maxOutputBytes)
        throw new MarketingAiError("La réponse structurée IA est absente ou trop volumineuse.", "ai_invalid_response", 502);
      let payload: unknown;
      try { payload = JSON.parse(texts[0]); } catch { throw new MarketingAiError("JSON IA invalide.", "ai_invalid_response", 502); }
      if (typeof data.model !== "string" || !data.model || data.model.length > 150)
        throw new MarketingAiError("Modèle réellement utilisé non identifié.", "ai_invalid_response", 502);
      const usage = data.usage as Record<string, unknown> | undefined;
      return { payload, provider: "openai", model: data.model,
        ...(typeof data.id === "string" && data.id.length <= 200 ? { responseId: data.id } : {}),
        ...(usage && Number.isInteger(usage.input_tokens) && Number.isInteger(usage.output_tokens)
          && Number(usage.input_tokens) >= 0 && Number(usage.output_tokens) >= 0
          ? { usage: { inputTokens: Number(usage.input_tokens), outputTokens: Number(usage.output_tokens) } } : {})
      };
    }
  };
}
export function configuredMarketingAiProvider(env: NodeJS.ProcessEnv = process.env): MarketingAiProvider | null {
  if (env.MARKETING_AI_ENABLED !== "true" || (env.MARKETING_AI_PROVIDER && env.MARKETING_AI_PROVIDER !== "openai")
    || !env.OPENAI_API_KEY?.trim() || !env.MARKETING_AI_MODEL?.trim()) return null;
  return createOpenAiMarketingProvider(env.OPENAI_API_KEY.trim(), env.MARKETING_AI_MODEL.trim());
}

export function marketingAiConfigurationState(env: NodeJS.ProcessEnv = process.env): "disabled" | "missing_configuration" | "ready" {
  if (env.MARKETING_AI_ENABLED !== "true") return "disabled";
  if ((env.MARKETING_AI_PROVIDER && env.MARKETING_AI_PROVIDER !== "openai")
    || !env.OPENAI_API_KEY?.trim() || !env.MARKETING_AI_MODEL?.trim()) return "missing_configuration";
  return "ready";
}
