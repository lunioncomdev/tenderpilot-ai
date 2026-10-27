import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError } from "@/server/api";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { buildProposalDocx } from "@/server/proposals/docx-export";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const proposal = await prisma.proposal.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { tender: true, sections: { orderBy: { order: "asc" } }, compliance: { orderBy: { order: "asc" } } },
  });
  if (!proposal) return jsonError(404, "Mémoire introuvable");
  const profile = await prisma.companyProfile.findUnique({ where: { organizationId: ctx.orgId } });

  const buf = await buildProposalDocx({
    title: proposal.tender.title,
    buyer: proposal.tender.buyerName,
    reference: proposal.tender.publicationRef ?? proposal.tender.externalId,
    companyName: profile?.legalName ?? ctx.orgName,
    sections: proposal.sections.map((s) => ({ title: s.title, content: s.content, status: s.status })),
    compliance: proposal.compliance,
    generatedAt: new Date(),
  });
  await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "proposal.exported_docx", entityType: "Proposal", entityId: proposal.id });
  const filename = `memoire-technique-${(proposal.tender.publicationRef ?? proposal.id).replace(/[^\w-]/g, "_")}.docx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
