"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod/v4";
import type { ActionState } from "@/components/form";
import { runAction } from "@/server/actions";
import { requestAnalysis } from "@/server/analysis/analysis-service";
import { addCustomPiece, deleteCustomPiece, generateApplicationPieces, startApplication, updatePiece } from "@/server/applications/application-service";
import { audit } from "@/server/audit";
import { requireContext } from "@/server/auth/context";
import { NotFoundError } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import { storage } from "@/server/documents/storage";
import { createProposal } from "@/server/proposals/proposal-service";
import { enqueue } from "@/server/queue/queues";
import { computeAndStoreScore } from "@/server/scoring/score-service";

const Id = z.string().min(1).max(40);
const Status = z.enum(["DETECTED", "TO_ANALYZE", "QUALIFIED", "GO", "NO_GO", "IN_PREPARATION", "IN_VALIDATION", "READY_TO_SUBMIT", "SUBMITTED", "AWAITING_DECISION", "WON", "LOST"]);
const PieceStatus = z.enum(["TODO", "IN_PROGRESS", "DONE", "NOT_APPLICABLE"]);
const PieceGroup = z.enum(["CANDIDATURE", "OFFRE"]);
const Kind = z.enum(["RC", "CCTP", "CCAP", "AE", "BPU", "DPGF", "ANNEXE", "QR", "AVIS", "AUTRE"]);

async function ownTender(orgId: string, tenderId: string) {
  const t = await prisma.tender.findFirst({ where: { id: tenderId, organizationId: orgId } });
  if (!t) throw new NotFoundError("Appel d'offres introuvable");
  return t;
}

export async function updateWorkflowAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const tenderId = Id.parse(fd.get("tenderId"));
    const status = Status.parse(fd.get("status"));
    const assigneeRaw = String(fd.get("assigneeId") ?? "");
    const t = await ownTender(ctx.orgId, tenderId);
    let assigneeId: string | null = null;
    if (assigneeRaw) {
      const m = await prisma.membership.findFirst({ where: { userId: assigneeRaw, organizationId: ctx.orgId } });
      if (!m) return { error: "Responsable invalide" };
      assigneeId = assigneeRaw;
    }
    await prisma.tender.update({ where: { id: t.id }, data: { status, assigneeId } });
    if (t.status !== status) await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "tender.status_changed", entityType: "Tender", entityId: t.id, metadata: { from: t.status, to: status } });
    if (t.assigneeId !== assigneeId) await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "tender.assigned", entityType: "Tender", entityId: t.id, metadata: { assigneeId } });
    revalidatePath(`/tenders/${t.id}`);
    return { ok: true, message: "Enregistré." };
  });
}

export async function addCommentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const tenderId = Id.parse(fd.get("tenderId"));
    const body = z.string().trim().min(1, "Commentaire vide").max(5000).parse(fd.get("body"));
    await ownTender(ctx.orgId, tenderId);
    await prisma.comment.create({ data: { organizationId: ctx.orgId, tenderId, authorId: ctx.userId, body } });
    revalidatePath(`/tenders/${tenderId}`);
    return { ok: true };
  });
}

export async function recomputeScoreAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const tenderId = Id.parse(fd.get("tenderId"));
    await ownTender(ctx.orgId, tenderId);
    await computeAndStoreScore(ctx.orgId, tenderId);
    revalidatePath(`/tenders/${tenderId}`);
    return { ok: true, message: "Score recalculé." };
  });
}

export async function requestAnalysisAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const tenderId = Id.parse(fd.get("tenderId"));
    const { analysis, alreadyRunning } = await requestAnalysis(ctx.orgId, tenderId, ctx.userId);
    if (alreadyRunning) return { message: "Une analyse est déjà en cours." };
    await enqueue("analyze-tender", { orgId: ctx.orgId, analysisId: analysis.id }, { jobId: `analysis-${analysis.id}`, attempts: 2 });
    revalidatePath(`/tenders/${tenderId}`);
    return { ok: true, message: "Analyse lancée." };
  });
}

export async function createProposalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const tenderId = Id.parse(fd.get("tenderId"));
    const existing = await prisma.proposal.findFirst({ where: { tenderId, organizationId: ctx.orgId } });
    if (existing) return { ok: true, message: existing.id };
    const p = await createProposal(ctx.orgId, tenderId, ctx.userId);
    return { ok: true, message: p.id };
  });
  if (res?.ok && res.message) redirect(`/proposals/${res.message}`);
  return res;
}

export async function setDocumentKindAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const id = Id.parse(fd.get("documentId"));
    const kind = Kind.parse(fd.get("kind"));
    const doc = await prisma.tenderDocument.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!doc) throw new NotFoundError("Document introuvable");
    await prisma.tenderDocument.update({ where: { id }, data: { kind } });
    revalidatePath(`/tenders/${doc.tenderId}`);
    return { ok: true };
  });
}

export async function reprocessDocumentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const id = Id.parse(fd.get("documentId"));
    const doc = await prisma.tenderDocument.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!doc) throw new NotFoundError("Document introuvable");
    await prisma.tenderDocument.update({ where: { id }, data: { status: "UPLOADED", error: null } });
    await enqueue("process-document", { orgId: ctx.orgId, documentId: id });
    revalidatePath(`/tenders/${doc.tenderId}`);
    return { ok: true };
  });
}

export async function deleteDocumentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const id = Id.parse(fd.get("documentId"));
    const doc = await prisma.tenderDocument.findFirst({ where: { id, organizationId: ctx.orgId }, include: { children: true } });
    if (!doc) throw new NotFoundError("Document introuvable");
    for (const d of [...doc.children, doc]) await storage().delete(d.storageKey).catch(() => undefined);
    await prisma.tenderDocument.delete({ where: { id } });
    await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "document.deleted", entityType: "TenderDocument", entityId: id, metadata: { filename: doc.filename } });
    revalidatePath(`/tenders/${doc.tenderId}`);
    return { ok: true };
  });
}

export async function importNoticePdfAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const tenderId = Id.parse(fd.get("tenderId"));
    const t = await ownTender(ctx.orgId, tenderId);
    if (t.origin !== "BOAMP") return { error: "Disponible uniquement pour les avis BOAMP." };
    await enqueue("import-notice-pdf", { orgId: ctx.orgId, tenderId, userId: ctx.userId }, { jobId: `notice-${tenderId}-${Date.now()}`, attempts: 2 });
    revalidatePath(`/tenders/${tenderId}`);
    return { ok: true, message: "Import de l'extrait de l'avis lancé." };
  });
}

/** « Candidater » : la consultation rejoint « Mes candidatures ». */
export async function applyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const tenderId = Id.parse(fd.get("tenderId"));
    await startApplication(ctx.orgId, tenderId, ctx.userId);
    revalidatePath(`/tenders/${tenderId}`);
    revalidatePath("/pipeline");
    return { ok: true };
  });
  if (res?.ok) redirect("/pipeline?tab=en-cours");
  return res;
}

export async function generateApplicationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const tenderId = Id.parse(fd.get("tenderId"));
    const r = await generateApplicationPieces(ctx.orgId, tenderId, ctx.userId);
    revalidatePath(`/tenders/${tenderId}`);
    const added = r.created ? `${r.created} pièce(s) ajoutée(s).` : "Liste à jour.";
    return { ok: true, message: r.withAnalysis ? added : `${added} Sans analyse du DCE : pièces usuelles uniquement.` };
  });
}

export async function updatePieceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const id = Id.parse(fd.get("pieceId"));
    const status = PieceStatus.parse(fd.get("status"));
    const note = z.string().trim().max(1000).parse(fd.get("note") ?? "");
    const p = await updatePiece(ctx.orgId, id, ctx.userId, { status, note });
    revalidatePath(`/tenders/${p.tenderId}`);
    revalidatePath("/pipeline");
    return { ok: true };
  });
}

export async function addPieceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const tenderId = Id.parse(fd.get("tenderId"));
    const label = z.string().trim().min(1, "Intitulé vide").max(250).parse(fd.get("label"));
    const group = PieceGroup.parse(fd.get("group"));
    await addCustomPiece(ctx.orgId, tenderId, ctx.userId, { label, group });
    revalidatePath(`/tenders/${tenderId}`);
    return { ok: true };
  });
}

export async function deletePieceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const id = Id.parse(fd.get("pieceId"));
    const p = await deleteCustomPiece(ctx.orgId, id);
    revalidatePath(`/tenders/${p.tenderId}`);
    return { ok: true };
  });
}
