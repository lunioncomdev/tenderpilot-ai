import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError } from "@/server/api";
import { audit } from "@/server/audit";
import { NotFoundError } from "@/server/auth/rbac";
import { registerDocument, UploadRejectedError } from "@/server/documents/document-service";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { enqueue } from "@/server/queue/queues";

export const runtime = "nodejs";

/** POST multipart/form-data { file } — importe une pièce du DCE. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiAuth(req, "MEMBER");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > (env().UPLOAD_MAX_MB + 1) * 1024 * 1024) return jsonError(413, `Fichier trop volumineux (max ${env().UPLOAD_MAX_MB} Mo)`);

  let file: File | null;
  try {
    file = (await req.formData()).get("file") as File | null;
  } catch {
    return jsonError(400, "Requête multipart invalide");
  }
  if (!file || typeof file === "string") return jsonError(400, "Champ « file » manquant");

  try {
    const { document, duplicate } = await registerDocument({
      orgId: ctx.orgId,
      tenderId: id,
      filename: file.name,
      data: Buffer.from(await file.arrayBuffer()),
      userId: ctx.userId,
    });
    if (!duplicate) {
      await enqueue("process-document", { orgId: ctx.orgId, documentId: document.id });
      await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "document.uploaded", entityType: "Tender", entityId: id, metadata: { filename: document.filename, sha256: document.sha256 } });
    }
    return NextResponse.json({ id: document.id, duplicate }, { status: duplicate ? 200 : 201 });
  } catch (err) {
    if (err instanceof UploadRejectedError) return jsonError(415, err.message);
    if (err instanceof NotFoundError) return jsonError(404, err.message);
    logger.error({ err }, "échec d'import");
    return jsonError(500, "Échec de l'import");
  }
}
