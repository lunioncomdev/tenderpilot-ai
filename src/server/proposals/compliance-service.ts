import { audit } from "../audit";
import { assertAiAllowed, callStructured } from "../ai/gateway";
import { systemWithRules } from "../ai/rules";
import {
  ComplianceOutputSchema,
  GENERATE_COMPLIANCE_PROMPT_VERSION,
  GENERATE_COMPLIANCE_SYSTEM,
  generateCompliancePrompt,
} from "../ai/prompts/generate-compliance";
import { buildDceContext } from "../analysis/context";
import { NotFoundError } from "../auth/rbac";
import { prisma } from "../db";
import { env } from "../env";
import { companyBlock, formatReferences, rankReferences } from "./proposal-service";

const BATCH = 60;

/** Marque la matrice « en cours de génération » (avant mise en file). */
export async function requestComplianceGeneration(orgId: string, proposalId: string) {
  const proposal = await prisma.proposal.findFirst({ where: { id: proposalId, organizationId: orgId } });
  if (!proposal) throw new NotFoundError("Mémoire introuvable");
  await assertAiAllowed(orgId, "section");
  await prisma.proposal.update({ where: { id: proposalId }, data: { complianceGeneratingAt: new Date(), complianceError: null } });
}

/**
 * Propose réponse, justificatif et statut pour les exigences de la matrice
 * (worker). Par défaut, seules les lignes sans réponse sont remplies ; une ligne
 * marquée conforme ou non conforme par un humain n'est jamais écrasée.
 */
export async function generateCompliance(orgId: string, proposalId: string, overwrite = false) {
  const proposal = await prisma.proposal.findFirst({
    where: { id: proposalId, organizationId: orgId },
    include: { compliance: { orderBy: { order: "asc" } }, sections: { orderBy: { order: "asc" }, select: { title: true } } },
  });
  if (!proposal) throw new NotFoundError("Mémoire introuvable");

  try {
    await assertAiAllowed(orgId, "section");
    const [tender, profile, references] = await Promise.all([
      prisma.tender.findFirstOrThrow({
        where: { id: proposal.tenderId, organizationId: orgId },
        include: { documents: { where: { status: "EXTRACTED" }, include: { chunks: true } } },
      }),
      prisma.companyProfile.findUnique({ where: { organizationId: orgId } }),
      prisma.companyReference.findMany({ where: { organizationId: orgId } }),
    ]);

    const humanDecided = (c: (typeof proposal.compliance)[number]) => !c.aiGenerated && c.response.trim() !== "";
    const todo = proposal.compliance.filter((c) => (overwrite ? !humanDecided(c) : c.response.trim() === ""));
    const ctx = buildDceContext(tender.documents, env().AI_MAX_DCE_TOKENS);
    const ranked = rankReferences(references, `${tender.title} ${tender.description}`, 8);
    const sections = proposal.sections.map((s, i) => `${i + 1}. ${s.title}`).join("\n");

    for (let start = 0; start < todo.length; start += BATCH) {
      const batch = todo.slice(start, start + BATCH);
      const res = await callStructured(
        orgId,
        {
          operation: "generate_compliance",
          promptVersion: GENERATE_COMPLIANCE_PROMPT_VERSION,
          system: systemWithRules(GENERATE_COMPLIANCE_SYSTEM, profile?.aiRules, "compliance"),
          context: ctx.text,
          prompt: generateCompliancePrompt({
            company: companyBlock(profile),
            references: formatReferences(ranked),
            sections,
            requirements: batch.map((c, i) => `#${i + 1} ${c.requirement}${c.source ? ` (source : ${c.source})` : ""}`).join("\n"),
          }),
          schema: ComplianceOutputSchema,
          maxTokens: 32_000,
        },
        proposal.id,
      );
      // Rattachement par numéro ; les numéros inconnus ou en double sont ignorés.
      const seen = new Set<number>();
      for (const out of res.data.items) {
        const item = batch[out.index - 1];
        if (!item || seen.has(out.index)) continue;
        seen.add(out.index);
        await prisma.complianceItem.update({
          where: { id: item.id },
          data: { response: out.response, evidence: out.evidence, status: out.status, aiGenerated: true },
        });
      }
    }
    await prisma.proposal.update({ where: { id: proposal.id }, data: { complianceGeneratingAt: null } });
    await audit({ orgId, action: "compliance.generated", entityType: "Proposal", entityId: proposal.id, metadata: { items: todo.length } });
  } catch (err) {
    await prisma.proposal.update({
      where: { id: proposal.id },
      data: { complianceGeneratingAt: null, complianceError: (err as Error).message.slice(0, 500) },
    });
    throw err;
  }
}
