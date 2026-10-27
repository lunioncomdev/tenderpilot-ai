import type { CompanyProfile, Prisma } from "@prisma/client";
import { computeScore, type ScoringProfile, type ScoringTender } from "./engine";

type TenderLike = {
  title: string;
  description?: string | null;
  cpvCodes: string[];
  estimatedValue?: number | Prisma.Decimal | string | null;
  deadlineAt?: Date | null;
  buyerCountry?: string | null;
  noticeState?: ScoringTender["noticeState"];
};

export function toScoringTender(t: TenderLike): ScoringTender {
  const v = t.estimatedValue;
  return {
    title: t.title,
    description: t.description ?? "",
    cpvCodes: t.cpvCodes,
    estimatedValue: v === null || v === undefined ? null : Number(v),
    deadlineAt: t.deadlineAt ?? null,
    buyerCountry: t.buyerCountry ?? null,
    noticeState: t.noticeState ?? "ACTIVE",
  };
}

export function toScoringProfile(p: CompanyProfile | null): ScoringProfile | null {
  if (!p) return null;
  return {
    skills: p.skills,
    technologies: p.technologies,
    keywords: p.keywords,
    cpvCodes: p.cpvCodes,
    certifications: p.certifications,
    eligibleCountries: p.eligibleCountries,
    minBudgetEur: p.minBudgetEur,
    maxBudgetEur: p.maxBudgetEur,
    annualRevenueEur: p.annualRevenueEur,
    scoringWeights: p.scoringWeights,
  };
}

/** Pré-score calculé à l'import, à partir des seules métadonnées de l'avis. */
export function computePreScore(t: TenderLike, profile: CompanyProfile | null, now = new Date()) {
  return computeScore({
    tender: toScoringTender(t),
    profile: toScoringProfile(profile),
    analysis: null,
    references: [],
    now,
  });
}
