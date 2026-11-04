import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError } from "@/server/api";
import { savePieceFile } from "@/server/applications/piece-files";
import { NotFoundError } from "@/server/auth/rbac";
import { UploadRejectedError } from "@/server/documents/document-service";
import { env } from "@/server/env";
import { logger } from "@/server/logger";

export const runtime = "nodejs";

/** POST multipart/form-data { file } — fichier joint à une pièce du dossier de candidature. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiAuth(req, "MEMBER");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

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

  try {
    const saved = await savePieceFile({ orgId: ctx.orgId, userId: ctx.userId, pieceId: id, filename: file.name, data: Buffer.from(await file.arrayBuffer()) });
    return NextResponse.json({ id: saved.id }, { status: 201 });
  } catch (err) {
    if (err instanceof UploadRejectedError) return jsonError(415, err.message);
    if (err instanceof NotFoundError) return jsonError(404, err.message);
    logger.error({ err }, "échec d'import d'un fichier de pièce");
    return jsonError(500, "Échec de l'import");
  }
}
