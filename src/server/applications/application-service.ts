import type { PieceGroup, PieceStatus } from "@prisma/client";
import { audit } from "../audit";
import { NotFoundError } from "../auth/rbac";
import { prisma } from "../db";
import type { TenderAnalysisResult } from "../analysis/schema";
import { isCoveredByProfile, linkCompanyDocs } from "../company/documents";
import { planApplicationPieces, PRE_APPLICATION_STATUSES } from "./pieces";

async function ownTender(orgId: string, tenderId: string) {
  const t = await prisma.tender.findFirst({ where: { id: tenderId, organizationId: orgId } });
  if (!t) throw new NotFoundError("Appel d'offres introuvable");
  return t;
}

async function ownPiece(orgId: string, pieceId: string) {
  const p = await prisma.applicationPiece.findFirst({ where: { id: pieceId, organizationId: orgId } });
  if (!p) throw new NotFoundError("Pièce introuvable");
  return p;
}

/**
 * Engage la candidature : l'avis passe « En préparation » (il apparaît alors dans
 * « Mes candidatures ») et est affecté à l'utilisateur s'il n'a pas de responsable.
 */
export async function startApplication(orgId: string, tenderId: string, userId: string): Promise<{ started: boolean }> {
  const t = await ownTender(orgId, tenderId);
  if (!PRE_APPLICATION_STATUSES.includes(t.status)) return { started: false };
  const assigneeId = t.assigneeId ?? userId;
  await prisma.tender.update({ where: { id: t.id }, data: { status: "IN_PREPARATION", assigneeId } });
  await audit({ orgId, userId, action: "tender.status_changed", entityType: "Tender", entityId: t.id, metadata: { from: t.status, to: "IN_PREPARATION" } });
  if (t.assigneeId !== assigneeId) await audit({ orgId, userId, action: "tender.assigned", entityType: "Tender", entityId: t.id, metadata: { assigneeId } });
  return { started: true };
}

/**
 * Génère (ou complète) la liste des pièces à partir de la dernière analyse du DCE.
 * Relancée après une nouvelle analyse, elle ajoute les pièces manquantes et met à
 * jour les exigences du DCE sans toucher à l'avancement déjà saisi.
 */
export async function generateApplicationPieces(orgId: string, tenderId: string, userId: string) {
  const t = await ownTender(orgId, tenderId);
  const analysisRow = await prisma.tenderAnalysis.findFirst({
    where: { tenderId, organizationId: orgId, status: "DONE" },
    orderBy: { createdAt: "desc" },
    select: { result: true },
  });
  const planned = planApplicationPieces((analysisRow?.result as unknown as TenderAnalysisResult | undefined) ?? null);
  const existing = await prisma.applicationPiece.findMany({ where: { tenderId: t.id }, select: { key: true } });
  const known = new Set(existing.map((p) => p.key));
  // Les pièces ajoutées à la main restent en fin de liste.
  const customStart = planned.length;

  await prisma.$transaction([
    ...planned.map((p, order) =>
      known.has(p.key)
        ? prisma.applicationPiece.update({
            where: { tenderId_key: { tenderId: t.id, key: p.key } },
            data: { order, group: p.group, label: p.label, detail: p.detail, source: p.source, fromDce: p.fromDce },
          })
        : prisma.applicationPiece.create({ data: { organizationId: orgId, tenderId: t.id, order, ...p } }),
    ),
    ...existing
      .filter((p) => p.key.startsWith("custom-"))
      .map((p, i) => prisma.applicationPiece.update({ where: { tenderId_key: { tenderId: t.id, key: p.key } }, data: { order: customStart + i } })),
  ]);
  await markPiecesCoveredByProfile(orgId, [t.id]);
  const created = planned.filter((p) => !known.has(p.key)).length;
  await audit({ orgId, userId, action: "tender.application_generated", entityType: "Tender", entityId: t.id, metadata: { created, total: planned.length, withAnalysis: !!analysisRow } });
  return { created, total: planned.length, withAnalysis: !!analysisRow };
}

export async function updatePiece(orgId: string, pieceId: string, userId: string, data: { status: PieceStatus; note: string }) {
  const p = await ownPiece(orgId, pieceId);
  await prisma.applicationPiece.update({ where: { id: p.id }, data: { ...data, updatedById: userId } });
  return p;
}

export async function addCustomPiece(orgId: string, tenderId: string, userId: string, data: { label: string; group: PieceGroup }) {
  const t = await ownTender(orgId, tenderId);
  const last = await prisma.applicationPiece.findFirst({ where: { tenderId: t.id }, orderBy: { order: "desc" }, select: { order: true } });
  return prisma.applicationPiece.create({
    data: {
      organizationId: orgId, tenderId: t.id, key: `custom-${crypto.randomUUID()}`, order: (last?.order ?? -1) + 1,
      group: data.group, label: data.label, updatedById: userId,
    },
  });
}

/** Seules les pièces ajoutées à la main se suppriment ; les autres se marquent « non requises ». */
export async function deleteCustomPiece(orgId: string, pieceId: string) {
  const p = await ownPiece(orgId, pieceId);
  if (!p.key.startsWith("custom-")) throw new Error("Marquez plutôt cette pièce « Non requise ».");
  await prisma.applicationPiece.delete({ where: { id: p.id } });
  return p;
}

/**
 * Passe « Prête » les pièces encore à faire dont les pièces du profil sont présentes
 * et valables à la date limite. Ne touche ni aux pièces « Prête » ou « Non requise »,
 * ni aux dossiers déjà déposés. Sans tenderIds : tous les dossiers en préparation.
 */
export async function markPiecesCoveredByProfile(orgId: string, tenderIds?: string[]): Promise<number> {
  const [pieces, docs] = await Promise.all([
    prisma.applicationPiece.findMany({
      where: {
        organizationId: orgId,
        status: { in: ["TODO", "IN_PROGRESS"] },
        ...(tenderIds ? { tenderId: { in: tenderIds } } : {}),
        tender: { status: { in: ["IN_PREPARATION", "IN_VALIDATION", "READY_TO_SUBMIT"] } },
      },
      select: { id: true, key: true, detail: true, tender: { select: { deadlineAt: true } } },
    }),
    prisma.companyDocument.findMany({ where: { organizationId: orgId }, select: { id: true, type: true, label: true, filename: true, validUntil: true } }),
  ]);
  const ready = pieces.filter((p) => isCoveredByProfile(linkCompanyDocs(p, docs, p.tender.deadlineAt))).map((p) => p.id);
  if (ready.length) await prisma.applicationPiece.updateMany({ where: { id: { in: ready } }, data: { status: "DONE", updatedById: null } });
  return ready.length;
}
