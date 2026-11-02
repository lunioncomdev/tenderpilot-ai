import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { LlmError, type LlmProvider, type LlmUsage, type StructuredRequest, type StructuredResponse } from "./provider";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Fournisseur OpenAI (API Responses). Sorties JSON contraintes par schéma
 * (`text.format` json_schema strict), raisonnement réglable. Le cache de prompt
 * d'OpenAI est automatique sur le préfixe commun : on place donc les consignes
 * système puis le contexte documentaire avant la consigne spécifique.
 */
export class OpenAIProvider implements LlmProvider {
  readonly name = "openai";
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
    private readonly effort: Effort,
  ) {
    this.client = new OpenAI({ apiKey, maxRetries: 3, timeout: 15 * 60 * 1000 });
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const started = Date.now();
    const content: OpenAI.Responses.ResponseInputContent[] = [];
    if (req.context) content.push({ type: "input_text", text: req.context });
    content.push({ type: "input_text", text: req.prompt });

    let response: OpenAI.Responses.Response;
    try {
      // Streaming : évite les timeouts HTTP sur les longues réponses.
      const stream = this.client.responses.stream({
        model: this.model,
        max_output_tokens: req.maxTokens ?? 32_000,
        reasoning: { effort: this.effort },
        instructions: req.system,
        input: [{ role: "user", content }],
        text: { format: zodTextFormat(req.schema, req.operation.replace(/[^a-zA-Z0-9_-]/g, "_")) },
        prompt_cache_key: `${req.operation}:${req.promptVersion}`,
        store: false,
      });
      response = await stream.finalResponse();
    } catch (err) {
      if (err instanceof OpenAI.AuthenticationError) throw new LlmError("Clé API OpenAI invalide", "config");
      if (err instanceof OpenAI.RateLimitError) throw new LlmError("Limite de débit OpenAI atteinte, réessayer plus tard", "api");
      if (err instanceof OpenAI.APIError) throw new LlmError(`Erreur API OpenAI (${err.status ?? "?"}) : ${err.message}`, "api");
      throw err;
    }

    const cached = response.usage?.input_tokens_details?.cached_tokens ?? 0;
    const usage: LlmUsage = {
      // `input_tokens` inclut les tokens servis depuis le cache : on les sépare pour le calcul du coût.
      inputTokens: (response.usage?.input_tokens ?? 0) - cached,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheReadTokens: cached,
      cacheWriteTokens: 0,
    };

    const parts = response.output.flatMap((o) => (o.type === "message" ? o.content : []));
    if (parts.some((p) => p.type === "refusal")) {
      throw new LlmError("Le modèle a refusé de traiter cette demande", "refusal", usage);
    }
    if (response.status === "incomplete") {
      if (response.incomplete_details?.reason === "max_output_tokens") {
        throw new LlmError("Réponse tronquée (limite de tokens atteinte)", "truncated", usage);
      }
      if (response.incomplete_details?.reason === "content_filter") {
        throw new LlmError("Le modèle a refusé de traiter cette demande", "refusal", usage);
      }
    }
    const text = parts
      .filter((p): p is OpenAI.Responses.ResponseOutputText => p.type === "output_text")
      .map((p) => p.text)
      .join("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new LlmError("Sortie JSON illisible", "invalid_output", usage);
    }
    const result = req.schema.safeParse(parsed);
    if (!result.success) throw new LlmError(`Sortie non conforme au schéma : ${result.error.message.slice(0, 300)}`, "invalid_output", usage);

    return { data: result.data, usage, model: response.model, durationMs: Date.now() - started };
  }
}
