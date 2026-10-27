import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { TenderAnalysisResult } from "../analysis/schema";
import { computeScore } from "./engine";
import { toScoringProfile, toScoringTender } from "./prescore";

/** Calcule et enregistre le score explicable d'un appel d'offres (avec l'analyse la plus récente si fournie). */
export async function computeAndStoreScore(orgId: string, tenderId: string, analysisId?: string | null) {
  const [tender, profile, references] = await Promise.all([
    prisma.tender.findFirstOrThrow({ where: { id: tenderId, organizationId: orgId } }),
    prisma.companyProfile.findUnique({ where: { organizationId: orgId } }),
    prisma.companyReference.findMany({ where: { organizationId: orgId } }),
  ]);
  const analysis = analysisId
    ? await prisma.tenderAnalysis.findFirst({ where: { id: analysisId, organizationId: orgId, status: "DONE" } })
    : await prisma.tenderAnalysis.findFirst({
        where: { tenderId, organizationId: orgId, status: "DONE" },
        orderBy: { createdAt: "desc" },
      });

  const result = computeScore({
    tender: toScoringTender(tender),
    profile: toScoringProfile(profile),
    analysis: (analysis?.result as TenderAnalysisResult | null) ?? null,
    references,
  });

  return prisma.tenderScore.create({
    data: {
      organizationId: orgId,
      tenderId,
      analysisId: analysis?.id ?? null,
      total: result.total,
      breakdown: result.breakdown as unknown as Prisma.InputJsonValue,
      eliminatory: result.eliminatory as unknown as Prisma.InputJsonValue,
      recommendation: result.recommendation,
      strengths: result.strengths,
      weaknesses: result.weaknesses,
      missingInfo: result.missingInfo,
      risks: result.risks,
      justification: result.justification,
      weights: result.weights as unknown as Prisma.InputJsonValue,
    },
  });
}
