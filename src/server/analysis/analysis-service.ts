import type { Prisma } from "@prisma/client";
import { audit } from "../audit";
import { prisma } from "../db";
import { env } from "../env";
import { assertAiAllowed, callStructured } from "../ai/gateway";
import { ANALYZE_TENDER_PROMPT_VERSION, ANALYZE_TENDER_SYSTEM, analyzeTenderPrompt } from "../ai/prompts/analyze-tender";
import { NotFoundError } from "../auth/rbac";
import { computeAndStoreScore } from "../scoring/score-service";
import { verifyAllSources } from "./citations";
import { buildDceContext } from "./context";
import { TenderAnalysisSchema } from "./schema";

/** Crée une demande d'analyse (le traitement est fait par le worker). */
export async function requestAnalysis(orgId: string, tenderId: string, userId: string) {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, organizationId: orgId },
    include: { documents: { where: { status: "EXTRACTED" }, select: { id: true } } },
  });
  if (!tender) throw new NotFoundError("Appel d'offres introuvable");
  if (!tender.documents.length) throw new Error("Aucun document extrait : importez le DCE avant de lancer l'analyse");
  await assertAiAllowed(orgId, "analysis");
  const pending = await prisma.tenderAnalysis.findFirst({
    where: { tenderId, organizationId: orgId, status: { in: ["PENDING", "RUNNING"] } },
  });
  if (pending) return { analysis: pending, alreadyRunning: true };
  const analysis = await prisma.tenderAnalysis.create({
    data: { organizationId: orgId, tenderId, requestedById: userId },
  });
  await audit({ orgId, userId, action: "analysis.requested", entityType: "Tender", entityId: tenderId });
  return { analysis, alreadyRunning: false };
}

/** Exécute l'analyse (worker). */
export async function runAnalysis(orgId: string, analysisId: string) {
  const analysis = await prisma.tenderAnalysis.findFirst({ where: { id: analysisId, organizationId: orgId } });
  if (!analysis) throw new NotFoundError("Analyse introuvable");
  if (analysis.status === "DONE") return analysis;
  await prisma.tenderAnalysis.update({ where: { id: analysis.id }, data: { status: "RUNNING", error: null } });

  try {
    await assertAiAllowed(orgId, "analysis");
    const tender = await prisma.tender.findFirstOrThrow({
      where: { id: analysis.tenderId, organizationId: orgId },
      include: { documents: { where: { status: "EXTRACTED" }, include: { chunks: true } } },
    });
    const ctx = buildDceContext(tender.documents, env().AI_MAX_DCE_TOKENS);
    if (ctx.refs.size === 0) throw new Error("Aucun texte exploitable dans les documents");

    const res = await callStructured(
      orgId,
      {
        operation: "analyze_tender",
        promptVersion: ANALYZE_TENDER_PROMPT_VERSION,
        system: ANALYZE_TENDER_SYSTEM,
        context: ctx.text,
        prompt: analyzeTenderPrompt({
          title: tender.title,
          buyer: tender.buyerName,
          reference: tender.publicationRef ?? tender.externalId,
          excluded: ctx.excluded,
        }),
        schema: TenderAnalysisSchema,
        maxTokens: 48_000,
      },
      analysis.id,
    );

    const { value, stats } = verifyAllSources(res.data, ctx.refs);
    const done = await prisma.tenderAnalysis.update({
      where: { id: analysis.id },
      data: {
        status: "DONE",
        model: res.model,
        promptVersion: ANALYZE_TENDER_PROMPT_VERSION,
        result: value as unknown as Prisma.InputJsonValue,
        citationStats: { ...stats, excludedDocuments: ctx.excluded, contextTokens: ctx.tokens },
        finishedAt: new Date(),
      },
    });
    await computeAndStoreScore(orgId, tender.id, done.id);
    if (tender.status === "DETECTED" || tender.status === "TO_ANALYZE") {
      await prisma.tender.update({ where: { id: tender.id }, data: { status: "QUALIFIED" } });
    }
    await audit({ orgId, userId: analysis.requestedById, action: "analysis.completed", entityType: "Tender", entityId: tender.id, metadata: { analysisId: done.id, ...stats } });
    return done;
  } catch (err) {
    await prisma.tenderAnalysis.update({
      where: { id: analysis.id },
      data: { status: "FAILED", error: (err as Error).message.slice(0, 1000), finishedAt: new Date() },
    });
    throw err;
  }
}
