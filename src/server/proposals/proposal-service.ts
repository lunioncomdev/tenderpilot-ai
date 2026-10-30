import type { CompanyProfile, CompanyReference, Prisma } from "@prisma/client";
import { normalizeText } from "@/lib/utils";
import { audit } from "../audit";
import { prisma } from "../db";
import { env } from "../env";
import { assertAiAllowed, callStructured } from "../ai/gateway";
import { systemWithRules } from "../ai/rules";
import {
  GENERATE_SECTION_PROMPT_VERSION,
  GENERATE_SECTION_SYSTEM,
  generateSectionPrompt,
  SectionOutputSchema,
} from "../ai/prompts/generate-section";
import { NotFoundError } from "../auth/rbac";
import { verifyAllSources } from "../analysis/citations";
import { buildDceContext } from "../analysis/context";
import type { TenderAnalysisResult, VerifiedSourceRef } from "../analysis/schema";
import { adaptOutline } from "./outline";

function cite(sources: Array<{ filename?: string; pageStart?: number | null; chunkId: string }>): string {
  return sources
    .map((s) => (s.filename ? `${s.filename}${s.pageStart ? ` p.${s.pageStart}` : ""}` : s.chunkId))
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(" ; ");
}

/** Crée un mémoire (plan adapté + matrice de conformité) à partir de la dernière analyse. */
export async function createProposal(orgId: string, tenderId: string, userId: string) {
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, organizationId: orgId } });
  if (!tender) throw new NotFoundError("Appel d'offres introuvable");
  const analysisRow = await prisma.tenderAnalysis.findFirst({
    where: { tenderId, organizationId: orgId, status: "DONE" },
    orderBy: { createdAt: "desc" },
  });
  if (!analysisRow) throw new Error("Analysez le DCE avant de créer le mémoire technique");
  const analysis = analysisRow.result as unknown as TenderAnalysisResult;
  const outline = adaptOutline(analysis);

  type Src = VerifiedSourceRef;
  const compliance: Array<{ requirement: string; source: string }> = [
    ...analysis.awardCriteria.map((c) => ({
      requirement: `Critère de notation : ${c.criterion}${c.weightPercent !== null ? ` (${c.weightPercent} %)` : ""}`,
      source: cite(c.sources as Src[]),
    })),
    ...analysis.technicalRequirements.map((r) => ({ requirement: r.text, source: cite(r.sources as Src[]) })),
    ...analysis.mandatoryDocuments.map((r) => ({ requirement: `Pièce à fournir : ${r.text}`, source: cite(r.sources as Src[]) })),
  ];

  const proposal = await prisma.proposal.create({
    data: {
      organizationId: orgId,
      tenderId,
      title: `Mémoire technique — ${tender.title}`.slice(0, 250),
      createdById: userId,
      sections: { create: outline.map((s, i) => ({ key: s.key, title: s.title, guidance: s.guidance, order: i })) },
      compliance: { create: compliance.map((c, i) => ({ ...c, order: i, response: "" })) },
    },
  });
  if (["QUALIFIED", "GO", "TO_ANALYZE", "DETECTED"].includes(tender.status)) {
    await prisma.tender.update({ where: { id: tenderId }, data: { status: "IN_PREPARATION" } });
  }
  await audit({ orgId, userId, action: "proposal.created", entityType: "Proposal", entityId: proposal.id });
  return proposal;
}

export function companyBlock(p: CompanyProfile | null): string {
  if (!p) return "Profil entreprise non renseigné.";
  const lines = [
    `PROFIL.legalName : ${p.legalName}`,
    `PROFIL.country : ${p.country}`,
    p.description && `PROFIL.description : ${p.description}`,
    p.skills.length && `PROFIL.skills : ${p.skills.join(", ")}`,
    p.technologies.length && `PROFIL.technologies : ${p.technologies.join(", ")}`,
    p.certifications.length ? `PROFIL.certifications : ${p.certifications.join(", ")}` : "PROFIL.certifications : aucune déclarée",
    p.headcount !== null ? `PROFIL.headcount : ${p.headcount}` : "PROFIL.headcount : non renseigné",
    p.annualRevenueEur !== null ? `PROFIL.annualRevenueEur : ${p.annualRevenueEur}` : "PROFIL.annualRevenueEur : non renseigné",
    p.methodology && `PROFIL.methodology : ${p.methodology}`,
    p.qualityProcess && `PROFIL.qualityProcess : ${p.qualityProcess}`,
    p.securityPolicy && `PROFIL.securityPolicy : ${p.securityPolicy}`,
    p.gdprCommitments && `PROFIL.gdprCommitments : ${p.gdprCommitments}`,
    p.ecoDesign && `PROFIL.ecoDesign : ${p.ecoDesign}`,
    p.accessibility && `PROFIL.accessibility : ${p.accessibility}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Références numérotées REF-n, seules références citables par l'IA. */
export function formatReferences(refs: CompanyReference[]): string {
  return refs
    .map((r, i) => `REF-${i + 1} : ${r.title} — client : ${r.client}${r.year ? ` (${r.year})` : ""}${r.amountEur ? `, ${r.amountEur} €` : ""}. ${r.description} Technologies : ${r.technologies.join(", ")}`)
    .join("\n");
}

/** Sélection des références les plus proches (recouvrement lexical). */
export function rankReferences(refs: CompanyReference[], query: string, max = 5): CompanyReference[] {
  const q = new Set(normalizeText(query).split(" ").filter((w) => w.length >= 4));
  return refs
    .filter((r) => r.isPublic)
    .map((r) => {
      const words = normalizeText(`${r.title} ${r.description} ${r.technologies.join(" ")} ${r.sector ?? ""}`).split(" ");
      return { r, score: words.filter((w) => q.has(w)).length };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.r);
}

export async function requestSectionGeneration(orgId: string, sectionId: string) {
  const section = await prisma.proposalSection.findFirst({ where: { id: sectionId, proposal: { organizationId: orgId } } });
  if (!section) throw new NotFoundError("Section introuvable");
  await assertAiAllowed(orgId, "section");
  await prisma.proposalSection.update({
    where: { id: section.id },
    data: { status: "GENERATING", error: null },
  });
  return section;
}

/** Génère (ou régénère) une section (worker). */
export async function generateSection(orgId: string, sectionId: string, instruction?: string) {
  const section = await prisma.proposalSection.findFirst({
    where: { id: sectionId, proposal: { organizationId: orgId } },
    include: { proposal: true },
  });
  if (!section) throw new NotFoundError("Section introuvable");

  try {
    await assertAiAllowed(orgId, "section");
    const tenderId = section.proposal.tenderId;
    const [tender, profile, references, analysisRow] = await Promise.all([
      prisma.tender.findFirstOrThrow({
        where: { id: tenderId, organizationId: orgId },
        include: { documents: { where: { status: "EXTRACTED" }, include: { chunks: true } } },
      }),
      prisma.companyProfile.findUnique({ where: { organizationId: orgId } }),
      prisma.companyReference.findMany({ where: { organizationId: orgId } }),
      prisma.tenderAnalysis.findFirst({ where: { tenderId, organizationId: orgId, status: "DONE" }, orderBy: { createdAt: "desc" } }),
    ]);
    const analysis = (analysisRow?.result as unknown as TenderAnalysisResult | null) ?? null;
    const ctx = buildDceContext(tender.documents, env().AI_MAX_DCE_TOKENS);
    const ranked = rankReferences(references, `${tender.title} ${tender.description} ${analysis?.requiredSkills.join(" ") ?? ""}`);

    const res = await callStructured(
      orgId,
      {
        operation: "generate_section",
        promptVersion: GENERATE_SECTION_PROMPT_VERSION,
        system: systemWithRules(GENERATE_SECTION_SYSTEM, profile?.aiRules, "section"),
        context: ctx.text,
        prompt: generateSectionPrompt({
          sectionTitle: section.title,
          guidance: section.guidance,
          analysisSummary: analysis?.summary ?? tender.description,
          awardCriteria: (analysis?.awardCriteria ?? [])
            .map((c) => `- ${c.criterion}${c.weightPercent !== null ? ` (${c.weightPercent} %)` : ""}${c.subCriteria.length ? ` : ${c.subCriteria.join(" ; ")}` : ""}`)
            .join("\n"),
          requirements: (analysis?.technicalRequirements ?? []).slice(0, 40).map((r) => `- ${r.text}`).join("\n"),
          company: companyBlock(profile),
          references: formatReferences(ranked),
          previousContent: section.content || undefined,
          instruction,
        }),
        schema: SectionOutputSchema,
        maxTokens: 24_000,
      },
      section.id,
    );

    const { value } = verifyAllSources(res.data, ctx.refs);
    const version = section.version + 1;
    await prisma.$transaction([
      prisma.proposalSection.update({
        where: { id: section.id },
        data: {
          content: value.content,
          status: "AI_DRAFT",
          version,
          toValidate: value.claimsToValidate,
          sources: { dce: value.dceSources, companyFacts: value.companyFactsUsed, references: ranked.map((r) => ({ id: r.id, title: r.title })) } as unknown as Prisma.InputJsonValue,
        },
      }),
      prisma.proposalSectionVersion.create({
        data: { sectionId: section.id, version, content: value.content, author: `ai:${res.model}` },
      }),
    ]);
  } catch (err) {
    await prisma.proposalSection.update({
      where: { id: section.id },
      data: { status: "FAILED", error: (err as Error).message.slice(0, 500) },
    });
    throw err;
  }
}

/** Modification manuelle d'une section (nouvelle version). */
export async function saveSectionEdit(orgId: string, sectionId: string, userId: string, content: string) {
  const section = await prisma.proposalSection.findFirst({ where: { id: sectionId, proposal: { organizationId: orgId } } });
  if (!section) throw new NotFoundError("Section introuvable");
  const version = section.version + 1;
  await prisma.$transaction([
    prisma.proposalSection.update({ where: { id: section.id }, data: { content, version, status: "EDITED" } }),
    prisma.proposalSectionVersion.create({ data: { sectionId: section.id, version, content, author: userId } }),
  ]);
}

export async function setSectionValidated(orgId: string, sectionId: string, userId: string, validated: boolean) {
  const section = await prisma.proposalSection.findFirst({ where: { id: sectionId, proposal: { organizationId: orgId } } });
  if (!section) throw new NotFoundError("Section introuvable");
  await prisma.proposalSection.update({ where: { id: section.id }, data: { status: validated ? "VALIDATED" : "EDITED" } });
  await audit({ orgId, userId, action: validated ? "section.validated" : "section.unvalidated", entityType: "ProposalSection", entityId: section.id });
}
