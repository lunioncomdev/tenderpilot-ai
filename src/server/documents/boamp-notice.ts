import { audit } from "../audit";
import { NotFoundError } from "../auth/rbac";
import { boampNoticePdfUrl } from "../connectors/boamp";
import { prisma } from "../db";
import { importRemoteDocument, processDocument } from "./document-service";

/**
 * Importe l'extrait officiel de l'avis BOAMP (PDF public) comme pièce « Avis »
 * de l'appel d'offres, puis l'extrait pour qu'il puisse être analysé.
 */
export async function importBoampNoticePdf(orgId: string, tenderId: string, userId?: string | null, fetchImpl?: typeof fetch) {
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, organizationId: orgId } });
  if (!tender) throw new NotFoundError("Appel d'offres introuvable");
  if (tender.origin !== "BOAMP" || !tender.publishedAt) throw new Error("Extrait PDF disponible uniquement pour les avis BOAMP datés");

  const url = boampNoticePdfUrl(tender.externalId, tender.publishedAt);
  const { document, duplicate } = await importRemoteDocument({
    orgId,
    tenderId,
    url,
    filename: `Avis-BOAMP-${tender.externalId}.pdf`,
    userId,
    fetchImpl,
  });
  if (!duplicate) {
    await prisma.tenderDocument.update({ where: { id: document.id }, data: { kind: "AVIS" } });
    await processDocument(orgId, document.id);
    await audit({ orgId, userId, action: "document.notice_imported", entityType: "Tender", entityId: tenderId, metadata: { url } });
  }
  return { document, duplicate, url };
}
