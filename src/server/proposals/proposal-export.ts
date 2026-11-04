import { prisma } from "../db";
import { buildProposalDocx } from "./docx-export";

/** Mémoire technique au format DOCX (null si introuvable dans l'organisation). */
export async function exportProposalDocx(orgId: string, proposalId: string, fallbackCompanyName: string): Promise<{ buf: Buffer; filename: string } | null> {
  const proposal = await prisma.proposal.findFirst({
    where: { id: proposalId, organizationId: orgId },
    include: { tender: true, sections: { orderBy: { order: "asc" } }, compliance: { orderBy: { order: "asc" } } },
  });
  if (!proposal) return null;
  const profile = await prisma.companyProfile.findUnique({ where: { organizationId: orgId }, select: { legalName: true } });
  const buf = await buildProposalDocx({
    title: proposal.tender.title,
    buyer: proposal.tender.buyerName,
    reference: proposal.tender.publicationRef ?? proposal.tender.externalId,
    companyName: profile?.legalName ?? fallbackCompanyName,
    sections: proposal.sections.map((s) => ({ title: s.title, content: s.content, status: s.status })),
    compliance: proposal.compliance,
    generatedAt: new Date(),
  });
  return { buf, filename: `memoire-technique-${(proposal.tender.publicationRef ?? proposal.id).replace(/[^\w-]/g, "_")}.docx` };
}
