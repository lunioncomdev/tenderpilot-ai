import { createHash, randomUUID } from "node:crypto";
import type { TenderDocument } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { NotFoundError } from "../auth/rbac";
import { logger } from "../logger";
import { chunkPages } from "./chunk";
import { extract, unzipSafely } from "./extract";
import { detectAllowedType, guessDocumentKind } from "./file-type";
import { storage, storageKeyFor } from "./storage";

export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  return base.replace(/[\u0000-\u001f<>:"|?*]/g, "_").slice(0, 180) || "document";
}

/**
 * Enregistre un fichier pour un appel d'offres de l'organisation : contrôle de
 * type (magic bytes) et de taille, dédoublonnage par SHA-256, stockage privé.
 */
export async function registerDocument(input: {
  orgId: string;
  tenderId: string;
  filename: string;
  data: Buffer;
  userId?: string | null;
  parentId?: string | null;
}): Promise<{ document: TenderDocument; duplicate: boolean }> {
  const tender = await prisma.tender.findFirst({ where: { id: input.tenderId, organizationId: input.orgId }, select: { id: true } });
  if (!tender) throw new NotFoundError("Appel d'offres introuvable");

  const maxBytes = env().UPLOAD_MAX_MB * 1024 * 1024;
  if (input.data.length === 0) throw new UploadRejectedError("Fichier vide");
  if (input.data.length > maxBytes) throw new UploadRejectedError(`Fichier trop volumineux (max ${env().UPLOAD_MAX_MB} Mo)`);

  const filename = sanitizeFilename(input.filename);
  const type = await detectAllowedType(input.data, filename);
  if (!type) throw new UploadRejectedError(`Format non autorisé : ${filename} (PDF, DOCX, XLSX, TXT ou ZIP)`);

  const sha256 = createHash("sha256").update(input.data).digest("hex");
  const existing = await prisma.tenderDocument.findUnique({ where: { tenderId_sha256: { tenderId: input.tenderId, sha256 } } });
  if (existing) return { document: existing, duplicate: true };

  const id = randomUUID();
  const storageKey = storageKeyFor(input.orgId, input.tenderId, id, type.ext);
  await storage().put(storageKey, input.data, type.mime);

  const document = await prisma.tenderDocument.create({
    data: {
      organizationId: input.orgId,
      tenderId: input.tenderId,
      parentId: input.parentId ?? null,
      filename,
      mimeType: type.mime,
      sizeBytes: input.data.length,
      sha256,
      storageKey,
      kind: guessDocumentKind(filename),
      uploadedById: input.userId ?? null,
    },
  });
  return { document, duplicate: false };
}

/** Traitement complet d'un document (exécuté par le worker). */
export async function processDocument(orgId: string, documentId: string): Promise<void> {
  const doc = await prisma.tenderDocument.findFirst({ where: { id: documentId, organizationId: orgId } });
  if (!doc) throw new NotFoundError("Document introuvable");
  await prisma.tenderDocument.update({ where: { id: doc.id }, data: { status: "PROCESSING", error: null } });

  try {
    const data = await storage().get(doc.storageKey);
    const type = await detectAllowedType(data, doc.filename);
    if (!type) throw new Error("Type de fichier non reconnu");

    if (type.ext === "zip") {
      const entries = await unzipSafely(data);
      let accepted = 0;
      const rejected: string[] = [];
      for (const e of entries) {
        try {
          const { document: child, duplicate } = await registerDocument({
            orgId, tenderId: doc.tenderId, filename: e.name, data: e.data, userId: doc.uploadedById, parentId: doc.id,
          });
          if (!duplicate) await processDocument(orgId, child.id);
          accepted++;
        } catch (err) {
          rejected.push(`${e.name} : ${(err as Error).message}`);
        }
      }
      await prisma.tenderDocument.update({
        where: { id: doc.id },
        data: {
          status: "EXTRACTED",
          pageCount: accepted,
          error: rejected.length ? `Fichiers ignorés : ${rejected.join(" ; ").slice(0, 1000)}` : null,
        },
      });
      return;
    }

    const result = await extract(data, type);
    const chunks = chunkPages(result.pages);
    const charCount = result.pages.reduce((a, p) => a + p.text.length, 0);

    await prisma.$transaction([
      prisma.documentChunk.deleteMany({ where: { documentId: doc.id } }),
      prisma.documentChunk.createMany({
        data: chunks.map((c) => ({
          organizationId: orgId,
          documentId: doc.id,
          index: c.index,
          pageStart: c.pageStart,
          pageEnd: c.pageEnd,
          heading: c.heading,
          text: c.text,
          tokenEstimate: c.tokenEstimate,
        })),
      }),
      prisma.tenderDocument.update({
        where: { id: doc.id },
        data: {
          status: result.needsOcr ? "NEEDS_OCR" : "EXTRACTED",
          pageCount: result.pageCount,
          charCount,
          error: result.needsOcr ? "PDF sans couche texte : OCR nécessaire (non disponible dans cette version)" : null,
        },
      }),
    ]);
  } catch (err) {
    logger.warn({ err, documentId }, "échec d'extraction");
    await prisma.tenderDocument.update({
      where: { id: doc.id },
      data: { status: "FAILED", error: (err as Error).message.slice(0, 500) },
    });
  }
}
