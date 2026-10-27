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
};

export function estimateCostUsd(model: string, u: LlmUsage): number {
  const p = PRICING[model] ?? PRICING["claude-opus-5-5"];
  const cost =
    (u.inputTokens * p.input + u.cacheWriteTokens * p.input * 1.25 + u.cacheReadTokens * p.cacheRead + u.outputTokens * p.output) /
    1_000_000;
  return Math.round(cost * 10_000) / 10_000;
}
