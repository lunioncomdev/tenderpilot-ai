import type { z } from "zod/v4";

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type StructuredRequest<T> = {
  operation: string;
  promptVersion: string;
  /** Consignes système stables (mises en cache). */
  system: string;
  /** Contexte volumineux et réutilisable (ex. DCE), placé avant la consigne et mis en cache. */
  context?: string;
  /** Consigne spécifique à l'appel. */
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
};

export type StructuredResponse<T> = { data: T; usage: LlmUsage; model: string; durationMs: number };

/** Abstraction fournisseur : le domaine ne dépend jamais d'un SDK particulier. */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly code: "refusal" | "truncated" | "invalid_output" | "api" | "config",
    readonly usage?: LlmUsage,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/** Tarifs publics en USD par million de tokens (à tenir à jour). */
const PRICING: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  // OpenAI, tarif Standard contexte court (≤ 272K tokens en entrée), relevé le 2026-11-04 sur
  // https://developers.openai.com/api/docs/pricing — au-delà, le tarif long contexte est plus élevé (sous-estimation).
  "gpt-6-astra": { input: 10, output: 50, cacheRead: 1 },
  "gpt-6.1-sol": { input: 2, output: 10, cacheRead: 0.1 },
  "gpt-6.1-terra": { input: 1, output: 5, cacheRead: 0.05 },
  "gpt-6-luna": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "gpt-5.6-sol": { input: 4, output: 20, cacheRead: 0.4 },
  "gpt-5.6-terra": { input: 2, output: 12, cacheRead: 0.2 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2, cacheRead: 0.02 },
  "gpt-5.5": { input: 5, output: 30, cacheRead: 0.5 },
  "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
};

/** Tarif d'un modèle ; les variantes datées (ex. « gpt-5.5-2026-… ») retombent sur leur famille. */
function pricingFor(model: string) {
  if (PRICING[model]) return PRICING[model];
  const prefix = Object.keys(PRICING)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) return PRICING[prefix];
  return model.startsWith("gpt-") ? PRICING["gpt-5"] : PRICING["claude-opus-5-5"];
}

export function estimateCostUsd(model: string, u: LlmUsage): number {
  const p = pricingFor(model);
  const cost =
    (u.inputTokens * p.input + u.cacheWriteTokens * p.input * 1.25 + u.cacheReadTokens * p.cacheRead + u.outputTokens * p.output) /
    1_000_000;
  return Math.round(cost * 10_000) / 10_000;
}
