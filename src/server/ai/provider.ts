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
  // OpenAI : vérifier les tarifs du modèle choisi sur https://openai.com/api/pricing
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
