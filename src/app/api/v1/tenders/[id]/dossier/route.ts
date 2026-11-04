import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError } from "@/server/api";
import { buildDossierZip } from "@/server/applications/dossier-export";
import { audit } from "@/server/audit";
import { NotFoundError } from "@/server/auth/rbac";
import { logger } from "@/server/logger";

export const runtime = "nodejs";

/** GET — dossier de réponse complet (ZIP) : pièces jointes, pièces du profil valables, DC1/DC2 et mémoire générés. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  try {
    const { buf, filename, plan } = await buildDossierZip(ctx.orgId, id, ctx.orgName);
    await audit({
      orgId: ctx.orgId, userId: ctx.userId, action: "tender.dossier_exported", entityType: "Tender", entityId: id,
      metadata: { files: plan.entries.length, piecesWithIssues: plan.summary.filter((s) => s.issues.length).length },
    });
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError(404, err.message);
    logger.error({ err }, "échec de l'export du dossier");
    return jsonError(500, "Échec de l'export du dossier");
  }
}
