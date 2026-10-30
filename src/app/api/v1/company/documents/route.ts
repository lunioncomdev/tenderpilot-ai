import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { apiAuth, jsonError } from "@/server/api";
import { NotFoundError } from "@/server/auth/rbac";
import { saveCompanyDocument } from "@/server/company/company-document-service";
import { UploadRejectedError } from "@/server/documents/document-service";
import { env } from "@/server/env";
import { logger } from "@/server/logger";

export const runtime = "nodejs";

const optDate = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.iso.date().nullable());
const Fields = z.object({
  type: z.enum(["KBIS", "URSSAF", "FISCALE", "ASSURANCE_RC", "RIB", "DC2", "BILANS", "REFERENCES", "CERTIFICATION", "POUVOIR", "AUTRE"]),
  label: z.string().trim().max(200).optional(),
  issuedAt: optDate,
  validUntil: optDate,
  replaceId: z.string().max(40).optional(),
});

/** POST multipart/form-data { file, type, label?, issuedAt?, validUntil?, replaceId? } — pièce administrative. */
export async function POST(req: NextRequest) {
  const ctx = await apiAuth(req, "MEMBER");
  if (ctx instanceof NextResponse) return ctx;

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > (env().UPLOAD_MAX_MB + 1) * 1024 * 1024) return jsonError(413, `Fichier trop volumineux (max ${env().UPLOAD_MAX_MB} Mo)`);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "Requête multipart invalide");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return jsonError(400, "Champ « file » manquant");
  const parsed = Fields.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (!parsed.success) return jsonError(400, "Champs invalides (type ou dates)");
  const f = parsed.data;

  try {
    const doc = await saveCompanyDocument({
      orgId: ctx.orgId,
      userId: ctx.userId,
      type: f.type,
      label: f.label,
      filename: file.name,
      data: Buffer.from(await file.arrayBuffer()),
      issuedAt: f.issuedAt ? new Date(f.issuedAt) : null,
      validUntil: f.validUntil ? new Date(f.validUntil) : null,
      replaceId: f.replaceId || null,
    });
    return NextResponse.json({ id: doc.id }, { status: f.replaceId ? 200 : 201 });
  } catch (err) {
    if (err instanceof UploadRejectedError) return jsonError(415, err.message);
    if (err instanceof NotFoundError) return jsonError(404, err.message);
    logger.error({ err }, "échec d'import d'une pièce administrative");
    return jsonError(500, "Échec de l'import");
  }
}
