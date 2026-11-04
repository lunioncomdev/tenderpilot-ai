import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError } from "@/server/api";
import { audit } from "@/server/audit";
import { exportProposalDocx } from "@/server/proposals/proposal-export";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const out = await exportProposalDocx(ctx.orgId, id, ctx.orgName);
  if (!out) return jsonError(404, "Mémoire introuvable");
  await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "proposal.exported_docx", entityType: "Proposal", entityId: id });
  return new NextResponse(new Uint8Array(out.buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${out.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
