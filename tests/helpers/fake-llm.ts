import type { LlmProvider, StructuredRequest, StructuredResponse } from "@/server/ai/provider";

/**
 * Fournisseur LLM FACTICE — réservé aux tests automatisés. Il ne fait aucun appel
 * réseau : il renvoie la réponse fournie par le test, ce qui permet de vérifier le
 * pipeline (validation de schéma, vérification des citations, journalisation,
 * scoring) de façon déterministe.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly name = "fake";
  readonly model = "fake-model";
  readonly calls: Array<StructuredRequest<unknown>> = [];

  constructor(private readonly responder: (req: StructuredRequest<unknown>) => unknown) {}

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    this.calls.push(req as StructuredRequest<unknown>);
    const data = req.schema.parse(this.responder(req as StructuredRequest<unknown>));
    return { data, model: this.model, durationMs: 1, usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  }
}
