import { createHash, randomUUID } from "node:crypto";
import type { CompanyDocType } from "@prisma/client";
import { fileTypeFromBuffer } from "file-type";
import { markPiecesCoveredByProfile } from "../applications/application-service";
import { audit } from "../audit";
import { NotFoundError } from "../auth/rbac";
import { prisma } from "../db";
import { sanitizeFilename, UploadRejectedError } from "../documents/document-service";
import { detectAllowedType } from "../documents/file-type";
import { storage } from "../documents/storage";
import { env } from "../env";
import { COMPANY_DOC_TYPES, defaultValidUntil } from "./documents";

/** PDF, bureautique ou scan (JPG / PNG), d'après le contenu réel du fichier. */
async function detectCompanyDocType(buf: Buffer, filename: string): Promise<{ ext: string; mime: string } | null> {
  const ft = await fileTypeFromBuffer(buf);
  if (ft && (ft.ext === "jpg" || ft.ext === "png")) return { ext: ft.ext, mime: ft.mime };
  const t = await detectAllowedType(buf, filename);
  return t && (t.ext === "pdf" || t.ext === "docx" || t.ext === "xlsx") ? t : null;
}

export async function saveCompanyDocument(input: {
  orgId: string;
  userId: string;
  type: CompanyDocType;
  label?: string;
  filename: string;
  data: Buffer;
  issuedAt: Date | null;
  validUntil: Date | null;
  /** Remplace le fichier d'une pièce existante (mise à jour d'une attestation expirée). */
  replaceId?: string | null;
}) {
  const maxBytes = env().UPLOAD_MAX_MB * 1024 * 1024;
  if (input.data.length === 0) throw new UploadRejectedError("Fichier vide");
  if (input.data.length > maxBytes) throw new UploadRejectedError(`Fichier trop volumineux (max ${env().UPLOAD_MAX_MB} Mo)`);
  const filename = sanitizeFilename(input.filename);
  const type = await detectCompanyDocType(input.data, filename);
  if (!type) throw new UploadRejectedError(`Format non autorisé : ${filename} (PDF, DOCX, XLSX, JPG ou PNG)`);

  const previous = input.replaceId
    ? await prisma.companyDocument.findFirst({ where: { id: input.replaceId, organizationId: input.orgId } })
    : null;
  if (input.replaceId && !previous) throw new NotFoundError("Pièce introuvable");

  const storageKey = `org/${input.orgId}/company/${randomUUID()}.${type.ext}`;
  await storage().put(storageKey, input.data, type.mime);
  const data = {
    type: input.type,
    label: (input.label?.trim() || COMPANY_DOC_TYPES[input.type].label).slice(0, 200),
    filename,
    mimeType: type.mime,
    sizeBytes: input.data.length,
    sha256: createHash("sha256").update(input.data).digest("hex"),
    storageKey,
    issuedAt: input.issuedAt,
    validUntil: input.validUntil ?? defaultValidUntil(input.type, input.issuedAt),
    uploadedById: input.userId,
  };

  const doc = previous
    ? await prisma.companyDocument.update({ where: { id: previous.id }, data })
    : await prisma.companyDocument.create({ data: { organizationId: input.orgId, ...data } });
  if (previous) await storage().delete(previous.storageKey).catch(() => undefined);
  await audit({
    orgId: input.orgId, userId: input.userId, action: previous ? "company_document.replaced" : "company_document.uploaded",
    entityType: "CompanyDocument", entityId: doc.id, metadata: { type: doc.type, filename, validUntil: doc.validUntil?.toISOString() ?? null },
  });
  await markPiecesCoveredByProfile(input.orgId);
  return doc;
}

export async function deleteCompanyDocument(orgId: string, id: string, userId: string) {
  const doc = await prisma.companyDocument.findFirst({ where: { id, organizationId: orgId } });
  if (!doc) throw new NotFoundError("Pièce introuvable");
  await prisma.companyDocument.delete({ where: { id: doc.id } });
  await storage().delete(doc.storageKey).catch(() => undefined);
  await audit({ orgId, userId, action: "company_document.deleted", entityType: "CompanyDocument", entityId: doc.id, metadata: { type: doc.type, filename: doc.filename } });
}
