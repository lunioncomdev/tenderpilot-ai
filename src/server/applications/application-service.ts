import type { PieceGroup, PieceStatus } from "@prisma/client";
import { audit } from "../audit";
import { NotFoundError } from "../auth/rbac";
import { prisma } from "../db";
import { storage } from "../documents/storage";
import type { TenderAnalysisResult } from "../analysis/schema";
import { isCoveredByProfile, linkCompanyDocs } from "../company/documents";
import { compareLotNumbers, normalizeLotNumber, proposalMove, reconcilePieces } from "./lots";
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

/** Reprend les lots de la dernière analyse du DCE (les lots saisis à la main sont conservés). */
export async function syncLotsFromAnalysis(orgId: string, tenderId: string, analysis: TenderAnalysisResult | null) {
  const lots = analysis?.lots ?? [];
  const seen = new Set<string>();
  const rows = lots
    .map((l) => ({ number: normalizeLotNumber(l.number), title: l.title.trim().slice(0, 300) }))
    .filter((l) => l.number && !seen.has(l.number) && seen.add(l.number))
    .sort((a, b) => compareLotNumbers(a.number, b.number));
  if (!rows.length) return;
  await prisma.$transaction(
    rows.map((l, order) =>
      prisma.tenderLot.upsert({
        where: { tenderId_number: { tenderId, number: l.number } },
        create: { organizationId: orgId, tenderId, number: l.number, title: l.title, order, fromAnalysis: true },
        update: { title: l.title, order, fromAnalysis: true },
      }),
    ),
  );
}

async function orderedLots(tenderId: string) {
  const lots = await prisma.tenderLot.findMany({ where: { tenderId }, select: { id: true, number: true, title: true, selected: true } });
  return lots.sort((a, b) => compareLotNumbers(a.number, b.number));
}

/**
 * Met la liste des pièces en conformité avec la dernière analyse et les lots
 * retenus, sans toucher à l'avancement déjà saisi. Idempotent.
 */
async function reconcileApplication(orgId: string, tenderId: string) {
  const analysisRow = await prisma.tenderAnalysis.findFirst({
    where: { tenderId, organizationId: orgId, status: "DONE" },
    orderBy: { createdAt: "desc" },
    select: { result: true },
  });
  const planned = planApplicationPieces((analysisRow?.result as unknown as TenderAnalysisResult | undefined) ?? null);
  const [existing, lots, proposals] = await Promise.all([
    prisma.applicationPiece.findMany({ where: { tenderId }, select: { id: true, key: true, lotId: true }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
    orderedLots(tenderId),
    prisma.proposal.findMany({ where: { tenderId, organizationId: orgId }, select: { id: true, lotId: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const ops = reconcilePieces(planned, existing, lots);
  const move = proposalMove(proposals, lots);
  // Les pièces ajoutées à la main restent en fin de liste.
  const customStart = planned.length;

  await prisma.$transaction([
    ...ops.updates.map((u) => prisma.applicationPiece.update({ where: { id: u.id }, data: u.data })),
    ...ops.creates.map((c) => prisma.applicationPiece.create({ data: { organizationId: orgId, tenderId, ...c } })),
    ...existing
      .filter((p) => p.key.startsWith("custom-"))
      .map((p, i) => prisma.applicationPiece.update({ where: { id: p.id }, data: { order: customStart + i } })),
    ...(move ? [prisma.proposal.update({ where: { id: move.id }, data: { lotId: move.lotId } })] : []),
  ]);
  await markPiecesCoveredByProfile(orgId, [tenderId]);
  return { created: ops.creates.length, total: planned.length, withAnalysis: !!analysisRow };
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
  await syncLotsFromAnalysis(orgId, t.id, (analysisRow?.result as unknown as TenderAnalysisResult | undefined) ?? null);
  const res = await reconcileApplication(orgId, t.id);
  await audit({ orgId, userId, action: "tender.application_generated", entityType: "Tender", entityId: t.id, metadata: res });
  return res;
}

async function ownLot(orgId: string, lotId: string) {
  const lot = await prisma.tenderLot.findFirst({ where: { id: lotId, organizationId: orgId } });
  if (!lot) throw new NotFoundError("Lot introuvable");
  return lot;
}

async function reconcileIfStarted(orgId: string, tenderId: string) {
  if (await prisma.applicationPiece.count({ where: { tenderId } })) await reconcileApplication(orgId, tenderId);
}

/**
 * Retient (ou écarte) un lot. Rien n'est supprimé : les pièces, le mémoire et
 * les bordereaux d'un lot écarté sont conservés et réapparaissent s'il est retenu à nouveau.
 */
export async function setLotSelected(orgId: string, lotId: string, selected: boolean, userId: string) {
  const lot = await ownLot(orgId, lotId);
  await prisma.tenderLot.update({ where: { id: lot.id }, data: { selected } });
  await reconcileIfStarted(orgId, lot.tenderId);
  await audit({ orgId, userId, action: selected ? "tender.lot_selected" : "tender.lot_unselected", entityType: "Tender", entityId: lot.tenderId, metadata: { lot: lot.number } });
  return lot;
}

export async function addLot(orgId: string, tenderId: string, userId: string, data: { number: string; title: string }) {
  const t = await ownTender(orgId, tenderId);
  const number = normalizeLotNumber(data.number);
  if (!number) throw new LotError("Numéro de lot invalide");
  if (await prisma.tenderLot.findUnique({ where: { tenderId_number: { tenderId: t.id, number } } })) throw new LotError(`Le lot n° ${number} existe déjà`);
  const lot = await prisma.tenderLot.create({ data: { organizationId: orgId, tenderId: t.id, number, title: data.title.trim().slice(0, 300), selected: true } });
  await reconcileIfStarted(orgId, t.id);
  await audit({ orgId, userId, action: "tender.lot_added", entityType: "Tender", entityId: t.id, metadata: { lot: number } });
  return lot;
}

/** Seuls les lots saisis à la main se suppriment, avec leurs pièces (les autres s'écartent). */
export async function deleteLot(orgId: string, lotId: string, userId: string) {
  const lot = await ownLot(orgId, lotId);
  if (lot.fromAnalysis) throw new LotError("Ce lot provient de l'analyse du DCE : décochez-le plutôt.");
  const files = await prisma.applicationPieceFile.findMany({ where: { piece: { lotId: lot.id } }, select: { storageKey: true } });
  await prisma.tenderLot.delete({ where: { id: lot.id } });
  await Promise.all(files.map((f) => storage().delete(f.storageKey).catch(() => undefined)));
  await reconcileIfStarted(orgId, lot.tenderId);
  await audit({ orgId, userId, action: "tender.lot_deleted", entityType: "Tender", entityId: lot.tenderId, metadata: { lot: lot.number } });
  return lot;
}

export class LotError extends Error {}

export async function updatePiece(orgId: string, pieceId: string, userId: string, data: { status: PieceStatus; note: string }) {
  const p = await ownPiece(orgId, pieceId);
  await prisma.applicationPiece.update({ where: { id: p.id }, data: { ...data, updatedById: userId } });
  return p;
}

export async function addCustomPiece(orgId: string, tenderId: string, userId: string, data: { label: string; group: PieceGroup; lotId?: string | null }) {
  const t = await ownTender(orgId, tenderId);
  const lotId = data.lotId ? (await ownLot(orgId, data.lotId)).id : null;
  if (lotId && (await prisma.tenderLot.count({ where: { id: lotId, tenderId: t.id } })) === 0) throw new NotFoundError("Lot introuvable");
  const last = await prisma.applicationPiece.findFirst({ where: { tenderId: t.id }, orderBy: { order: "desc" }, select: { order: true } });
  return prisma.applicationPiece.create({
    data: {
      organizationId: orgId, tenderId: t.id, key: `custom-${crypto.randomUUID()}`, order: (last?.order ?? -1) + 1,
      group: data.group, label: data.label, lotId, updatedById: userId,
    },
  });
}

/** Seules les pièces ajoutées à la main se suppriment ; les autres se marquent « non requises ». */
export async function deleteCustomPiece(orgId: string, pieceId: string) {
  const p = await ownPiece(orgId, pieceId);
  if (!p.key.startsWith("custom-")) throw new Error("Marquez plutôt cette pièce « Non requise ».");
  const files = await prisma.applicationPieceFile.findMany({ where: { pieceId: p.id }, select: { storageKey: true } });
  await prisma.applicationPiece.delete({ where: { id: p.id } });
  await Promise.all(files.map((f) => storage().delete(f.storageKey).catch(() => undefined)));
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
