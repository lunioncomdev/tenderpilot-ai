import { createHash, randomUUID } from "node:crypto";
import { audit } from "../audit";
import { NotFoundError } from "../auth/rbac";
import { detectCompanyDocType } from "../company/company-document-service";
import { prisma } from "../db";
import { sanitizeFilename, UploadRejectedError } from "../documents/document-service";
import { storage } from "../documents/storage";
import { env } from "../env";

/** Nombre maximal de fichiers par pièce (ex. un CV par intervenant). */
export const MAX_FILES_PER_PIECE = 20;

/**
 * Joint un fichier propre à la consultation à une pièce du dossier (AE signé,
 * BPU rempli, CV…). Formats acceptés : ceux des pièces du profil, contrôlés sur
 * le contenu réel. Une pièce « À faire » passe « En cours ».
 */
export async function savePieceFile(input: { orgId: string; userId: string; pieceId: string; filename: string; data: Buffer }) {
  const maxBytes = env().UPLOAD_MAX_MB * 1024 * 1024;
  if (input.data.length === 0) throw new UploadRejectedError("Fichier vide");
  if (input.data.length > maxBytes) throw new UploadRejectedError(`Fichier trop volumineux (max ${env().UPLOAD_MAX_MB} Mo)`);

  const piece = await prisma.applicationPiece.findFirst({
    where: { id: input.pieceId, organizationId: input.orgId },
    include: { _count: { select: { files: true } } },
  });
  if (!piece) throw new NotFoundError("Pièce introuvable");
  if (piece._count.files >= MAX_FILES_PER_PIECE) throw new UploadRejectedError(`${MAX_FILES_PER_PIECE} fichiers au plus par pièce`);

  const filename = sanitizeFilename(input.filename);
  const type = await detectCompanyDocType(input.data, filename);
  if (!type) throw new UploadRejectedError(`Format non autorisé : ${filename} (PDF, DOCX, XLSX, JPG ou PNG)`);

  const storageKey = `org/${input.orgId}/tenders/${piece.tenderId}/pieces/${randomUUID()}.${type.ext}`;
  await storage().put(storageKey, input.data, type.mime);
  const file = await prisma.applicationPieceFile.create({
    data: {
      organizationId: input.orgId,
      pieceId: piece.id,
      filename,
      mimeType: type.mime,
      sizeBytes: input.data.length,
      sha256: createHash("sha256").update(input.data).digest("hex"),
      storageKey,
      uploadedById: input.userId,
    },
  });
  if (piece.status === "TODO") {
    await prisma.applicationPiece.update({ where: { id: piece.id }, data: { status: "IN_PROGRESS", updatedById: input.userId } });
  }
  await audit({
    orgId: input.orgId, userId: input.userId, action: "application_piece.file_uploaded",
    entityType: "Tender", entityId: piece.tenderId, metadata: { pieceId: piece.id, pieceKey: piece.key, fileId: file.id, filename },
  });
  return file;
}

export async function deletePieceFile(orgId: string, fileId: string, userId: string) {
  const file = await prisma.applicationPieceFile.findFirst({ where: { id: fileId, organizationId: orgId }, include: { piece: { select: { tenderId: true, key: true } } } });
  if (!file) throw new NotFoundError("Fichier introuvable");
  await prisma.applicationPieceFile.delete({ where: { id: file.id } });
  await storage().delete(file.storageKey).catch(() => undefined);
  await audit({
    orgId, userId, action: "application_piece.file_deleted",
    entityType: "Tender", entityId: file.piece.tenderId, metadata: { pieceId: file.pieceId, pieceKey: file.piece.key, filename: file.filename },
  });
  return file;
}
