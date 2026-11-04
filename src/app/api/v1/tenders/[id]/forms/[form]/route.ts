import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError } from "@/server/api";
import { buildFormDocx } from "@/server/applications/dossier-export";
import { audit } from "@/server/audit";
import { NotFoundError } from "@/server/auth/rbac";

export const runtime = "nodejs";

/** GET — formulaire DC1 ou DC2 pré-rempli (DOCX). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; form: string }> }) {
  const ctx = await apiAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id, form } = await params;
  if (form !== "dc1" && form !== "dc2") return jsonError(404, "Formulaire inconnu");
  try {
    const { buf, filename, todos } = await buildFormDocx(ctx.orgId, id, form, ctx.orgName);
    await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "tender.form_exported", entityType: "Tender", entityId: id, metadata: { form, todos } });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError(404, err.message);
    throw err;
  }
}
