import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { LlmError, type LlmProvider, type LlmUsage, type StructuredRequest, type StructuredResponse } from "./provider";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Fournisseur Claude (SDK officiel). Sorties JSON contraintes par schéma
 * (`output_config.format`), réflexion adaptative, cache du prompt système et du
 * contexte documentaire, repli serveur en cas de refus (`fallbacks: "default"`).
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    private readonly effort: Effort,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 3, timeout: 15 * 60 * 1000 });
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const started = Date.now();
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (req.context) content.push({ type: "text", text: req.context, cache_control: { type: "ephemeral" } });
    content.push({ type: "text", text: req.prompt });

    let message: Anthropic.Beta.BetaMessage;
    try {
      // Streaming : évite les timeouts HTTP sur les longues réponses.
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: req.maxTokens ?? 32_000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: this.effort, format: betaZodOutputFormat(req.schema) },
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content }],
      });
      message = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new LlmError("Clé API Anthropic invalide", "config");
      if (err instanceof Anthropic.RateLimitError) throw new LlmError("Limite de débit Anthropic atteinte, réessayer plus tard", "api");
      if (err instanceof Anthropic.APIError) throw new LlmError(`Erreur API Anthropic (${err.status ?? "?"}) : ${err.message}`, "api");
      throw err;
    }

    const usage: LlmUsage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    };

    if (message.stop_reason === "refusal") {
      throw new LlmError("Le modèle a refusé de traiter cette demande", "refusal", usage);
    }
    if (message.stop_reason === "max_tokens") {
      throw new LlmError("Réponse tronquée (limite de tokens atteinte)", "truncated", usage);
    }
    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new LlmError("Sortie JSON illisible", "invalid_output", usage);
    }
    const result = req.schema.safeParse(parsed);
    if (!result.success) throw new LlmError(`Sortie non conforme au schéma : ${result.error.message.slice(0, 300)}`, "invalid_output", usage);

    return { data: result.data, usage, model: message.model, durationMs: Date.now() - started };
  }
}
