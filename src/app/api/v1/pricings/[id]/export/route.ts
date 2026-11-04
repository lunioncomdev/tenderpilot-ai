import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError } from "@/server/api";
import { audit } from "@/server/audit";
import { NotFoundError } from "@/server/auth/rbac";
import { exportFilledTemplate, PricingTemplateError, XLSX_MIME } from "@/server/pricing/pricing-service";

export const runtime = "nodejs";

/** GET — bordereau de prix d'origine (XLSX) rempli avec les prix du chiffrage. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  try {
    const out = await exportFilledTemplate(ctx.orgId, id);
    await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "pricing.exported", entityType: "Pricing", entityId: id, metadata: { written: out.written, skipped: out.skipped, missing: out.missing } });
    return new NextResponse(new Uint8Array(out.buf), {
      headers: {
        "Content-Type": XLSX_MIME,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError(404, err.message);
    if (err instanceof PricingTemplateError) return jsonError(422, err.message);
    throw err;
  }
}
