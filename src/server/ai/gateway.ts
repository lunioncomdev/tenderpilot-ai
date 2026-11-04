import type { Plan } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { logger } from "../logger";
import { decryptSecret } from "../dce/secrets";
import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";
import { estimateCostUsd, LlmError, type LlmProvider, type StructuredRequest, type StructuredResponse } from "./provider";

/** Quotas mensuels d'opérations IA par offre (préparation de la commercialisation). */
export const PLAN_LIMITS: Record<Plan, { analysesPerMonth: number; sectionsPerMonth: number; maxUsers: number }> = {
  STARTER: { analysesPerMonth: 10, sectionsPerMonth: 0, maxUsers: 2 },
  PRO: { analysesPerMonth: 100, sectionsPerMonth: 1000, maxUsers: 5 },
  AGENCY: { analysesPerMonth: 500, sectionsPerMonth: 5000, maxUsers: 50 },
};

export class AiNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiNotAllowedError";
  }
}

let override: LlmProvider | undefined;

/** Réservé aux tests : injecte un fournisseur factice. */
export function setProviderForTests(p: LlmProvider | undefined) {
  override = p;
}

/** Configuration IA effective d'une organisation : réglages enregistrés, sinon variables d'environnement. */
export type AiConfig = {
  provider: "openai" | "anthropic";
  model: string;
  apiKey?: string;
  /** Origine de la clé : saisie dans Paramètres ou variable d'environnement. */
  keySource?: "organization" | "env";
};

export async function resolveAiConfig(orgId: string): Promise<AiConfig> {
  const e = env();
  if (e.AI_PROVIDER !== "openai") return { provider: "anthropic", model: e.AI_MODEL, apiKey: e.ANTHROPIC_API_KEY, keySource: e.ANTHROPIC_API_KEY ? "env" : undefined };
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { openaiApiKeyEnc: true, aiModel: true } });
  let apiKey: string | undefined;
  let keySource: AiConfig["keySource"];
  if (org?.openaiApiKeyEnc) {
    try {
      apiKey = decryptSecret(org.openaiApiKeyEnc);
      keySource = "organization";
    } catch (err) {
      logger.warn({ err, orgId }, "clé OpenAI de l'organisation illisible");
    }
  }
  if (!apiKey && e.OPENAI_API_KEY) {
    apiKey = e.OPENAI_API_KEY;
    keySource = "env";
  }
  return { provider: "openai", model: org?.aiModel || e.AI_MODEL, apiKey, keySource };
}

export async function getProvider(orgId: string): Promise<LlmProvider> {
  if (override) return override;
  const e = env();
  if (!e.AI_ENABLED) throw new AiNotAllowedError("L'IA est désactivée (AI_ENABLED=false)");
  const cfg = await resolveAiConfig(orgId);
  if (!cfg.apiKey) throw new AiNotAllowedError(missingKeyReason(cfg));
  return cfg.provider === "openai"
    ? new OpenAIProvider(cfg.apiKey, cfg.model, e.AI_EFFORT)
    : new AnthropicProvider(cfg.apiKey, cfg.model, e.AI_EFFORT);
}

function missingKeyReason(cfg: AiConfig) {
  return cfg.provider === "openai" ? "Clé API OpenAI absente (Paramètres › Intelligence artificielle ou OPENAI_API_KEY)" : "Clé ANTHROPIC_API_KEY absente";
}

export async function aiStatus(orgId: string): Promise<{ enabled: boolean; reason?: string; model: string; keySource?: AiConfig["keySource"] }> {
  const e = env();
  if (override) return { enabled: true, model: override.model };
  const cfg = await resolveAiConfig(orgId);
  if (!e.AI_ENABLED) return { enabled: false, reason: "IA désactivée (AI_ENABLED=false)", model: cfg.model, keySource: cfg.keySource };
  if (!cfg.apiKey) return { enabled: false, reason: missingKeyReason(cfg), model: cfg.model };
  return { enabled: true, model: cfg.model, keySource: cfg.keySource };
}

function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function monthlySpendUsd(orgId: string): Promise<number> {
  const agg = await prisma.aiUsageLog.aggregate({
    where: { organizationId: orgId, createdAt: { gte: monthStart() } },
    _sum: { costUsd: true },
  });
  return Number(agg._sum.costUsd ?? 0);
}

/**
 * Vérifications préalables à tout appel IA : activation, consentement à l'envoi
 * des documents, budget mensuel, quota de l'offre.
 */
export async function assertAiAllowed(orgId: string, op: "analysis" | "section"): Promise<void> {
  if (!override) {
    const st = await aiStatus(orgId);
    if (!st.enabled) throw new AiNotAllowedError(st.reason ?? "IA indisponible");
  }
  const [org, profile, spend] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: orgId } }),
    prisma.companyProfile.findUnique({ where: { organizationId: orgId } }),
    monthlySpendUsd(orgId),
  ]);
  if (!profile?.allowAiDocumentUpload) {
    throw new AiNotAllowedError(
      "L'envoi des documents au fournisseur d'IA n'est pas autorisé. Activez-le dans Profil entreprise › Confidentialité.",
    );
  }
  const budget = env().AI_MONTHLY_BUDGET_USD;
  if (spend >= budget) throw new AiNotAllowedError(`Budget IA mensuel atteint (${spend.toFixed(2)} / ${budget} USD)`);
  const limits = PLAN_LIMITS[org.plan];
  const operation = op === "analysis" ? "analyze_tender" : "generate_section";
  const count = await prisma.aiUsageLog.count({
    where: { organizationId: orgId, operation, success: true, createdAt: { gte: monthStart() } },
  });
  const max = op === "analysis" ? limits.analysesPerMonth : limits.sectionsPerMonth;
  if (count >= max) throw new AiNotAllowedError(`Quota mensuel de l'offre ${org.plan} atteint (${max})`);
}

/** Appel IA journalisé (succès comme échec) avec coût estimé. */
export async function callStructured<T>(
  orgId: string,
  req: StructuredRequest<T>,
  refId?: string,
): Promise<StructuredResponse<T>> {
  const provider = await getProvider(orgId);
  const started = Date.now();
  try {
    const res = await provider.generateStructured(req);
    await prisma.aiUsageLog.create({
      data: {
        organizationId: orgId,
        operation: req.operation,
        provider: provider.name,
        model: res.model,
        promptVersion: req.promptVersion,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        cacheReadTokens: res.usage.cacheReadTokens,
        cacheWriteTokens: res.usage.cacheWriteTokens,
        costUsd: estimateCostUsd(res.model, res.usage),
        durationMs: res.durationMs,
        success: true,
        refId: refId ?? null,
      },
    });
    return res;
  } catch (err) {
    const usage = err instanceof LlmError ? err.usage : undefined;
    await prisma.aiUsageLog
      .create({
        data: {
          organizationId: orgId,
          operation: req.operation,
          provider: provider.name,
          model: provider.model,
          promptVersion: req.promptVersion,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          cacheReadTokens: usage?.cacheReadTokens ?? 0,
          cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
          costUsd: usage ? estimateCostUsd(provider.model, usage) : 0,
          durationMs: Date.now() - started,
          success: false,
          error: (err as Error).message.slice(0, 500),
          refId: refId ?? null,
        },
      })
      .catch((e) => logger.error({ err: e }, "journal IA"));
    throw err;
  }
}
