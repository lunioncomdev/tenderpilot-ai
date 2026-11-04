"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import type { ActionState } from "@/components/form";
import { runAction } from "@/server/actions";
import { audit } from "@/server/audit";
import { requireContext } from "@/server/auth/context";
import { NotFoundError } from "@/server/auth/rbac";
import { loadReadiness } from "@/server/applications/readiness";
import { prisma } from "@/server/db";
import { requestSectionGeneration, saveSectionEdit, setSectionValidated } from "@/server/proposals/proposal-service";
import { requestComplianceGeneration } from "@/server/proposals/compliance-service";
import { enqueue } from "@/server/queue/queues";

const Id = z.string().min(1).max(40);

async function sectionProposalId(orgId: string, sectionId: string) {
  const s = await prisma.proposalSection.findFirst({ where: { id: sectionId, proposal: { organizationId: orgId } }, select: { proposalId: true } });
  if (!s) throw new NotFoundError("Section introuvable");
  return s.proposalId;
}

export async function generateSectionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const sectionId = Id.parse(fd.get("sectionId"));
    const instruction = z.string().max(1000).optional().parse(fd.get("instruction") || undefined);
    const proposalId = await sectionProposalId(ctx.orgId, sectionId);
    await requestSectionGeneration(ctx.orgId, sectionId);
    await enqueue("generate-section", { orgId: ctx.orgId, sectionId, instruction }, { attempts: 2 });
    await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "section.generation_requested", entityType: "ProposalSection", entityId: sectionId });
    revalidatePath(`/proposals/${proposalId}`);
    return { ok: true, message: "Génération lancée." };
  });
}

/**
 * Génère par l'IA tout le mémoire : sections non rédigées (et, sur option, les
 * brouillons non validés) puis les réponses de la matrice de conformité.
 * Les sections validées ne sont jamais régénérées.
 */
export async function generateEverythingAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const proposalId = Id.parse(fd.get("proposalId"));
    const includeDrafts = fd.get("includeDrafts") === "on";
    const proposal = await prisma.proposal.findFirst({ where: { id: proposalId, organizationId: ctx.orgId }, include: { sections: true, compliance: true } });
    if (!proposal) throw new NotFoundError("Mémoire introuvable");
    const regenerable = includeDrafts ? ["PENDING", "FAILED", "AI_DRAFT", "EDITED"] : ["PENDING", "FAILED"];
    const todo = proposal.sections.filter((s) => regenerable.includes(s.status));
    for (const s of todo) {
      await requestSectionGeneration(ctx.orgId, s.id);
      await enqueue("generate-section", { orgId: ctx.orgId, sectionId: s.id }, { attempts: 2 });
    }
    const matrix = proposal.compliance.length > 0 && !proposal.complianceGeneratingAt;
    if (matrix) {
      await requestComplianceGeneration(ctx.orgId, proposalId);
      await enqueue("generate-compliance", { orgId: ctx.orgId, proposalId, overwrite: includeDrafts }, { attempts: 2 });
    }
    await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "proposal.generation_requested", entityType: "Proposal", entityId: proposalId, metadata: { sections: todo.length, matrix, includeDrafts } });
    revalidatePath(`/proposals/${proposalId}`);
    if (!todo.length && !matrix) return { message: "Rien à générer : toutes les sections sont rédigées ou validées." };
    return { ok: true, message: `Génération lancée : ${todo.length} section(s)${matrix ? " et la matrice de conformité" : ""}.` };
  });
}

export async function generateComplianceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const proposalId = Id.parse(fd.get("proposalId"));
    const overwrite = fd.get("overwrite") === "on";
    await requestComplianceGeneration(ctx.orgId, proposalId);
    await enqueue("generate-compliance", { orgId: ctx.orgId, proposalId, overwrite }, { attempts: 2 });
    revalidatePath(`/proposals/${proposalId}`);
    return { ok: true, message: "Génération des réponses de la matrice lancée." };
  });
}

export async function saveSectionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const sectionId = Id.parse(fd.get("sectionId"));
    const content = z.string().max(100_000).parse(fd.get("content") ?? "");
    const proposalId = await sectionProposalId(ctx.orgId, sectionId);
    await saveSectionEdit(ctx.orgId, sectionId, ctx.userId, content);
    revalidatePath(`/proposals/${proposalId}`);
    return { ok: true, message: "Section enregistrée (nouvelle version)." };
  });
}

export async function validateSectionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const sectionId = Id.parse(fd.get("sectionId"));
    const validated = fd.get("validated") === "1";
    const proposalId = await sectionProposalId(ctx.orgId, sectionId);
    await setSectionValidated(ctx.orgId, sectionId, ctx.userId, validated);
    revalidatePath(`/proposals/${proposalId}`);
    return { ok: true };
  });
}

export async function restoreVersionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const versionId = Id.parse(fd.get("versionId"));
    const v = await prisma.proposalSectionVersion.findFirst({ where: { id: versionId, section: { proposal: { organizationId: ctx.orgId } } }, include: { section: true } });
    if (!v) throw new NotFoundError("Version introuvable");
    await saveSectionEdit(ctx.orgId, v.sectionId, ctx.userId, v.content);
    revalidatePath(`/proposals/${v.section.proposalId}`);
    return { ok: true, message: `Version ${v.version} restaurée.` };
  });
}

const ComplianceSchema = z.object({
  itemId: Id,
  response: z.string().max(5000),
  evidence: z.string().max(2000),
  status: z.enum(["COMPLIANT", "PARTIAL", "NON_COMPLIANT", "TO_VERIFY"]),
});

export async function saveComplianceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const d = ComplianceSchema.parse({ itemId: fd.get("itemId"), response: fd.get("response") ?? "", evidence: fd.get("evidence") ?? "", status: fd.get("status") });
    const item = await prisma.complianceItem.findFirst({ where: { id: d.itemId, proposal: { organizationId: ctx.orgId } } });
    if (!item) throw new NotFoundError("Exigence introuvable");
    await prisma.complianceItem.update({ where: { id: item.id }, data: { response: d.response, evidence: d.evidence, status: d.status, aiGenerated: false } });
    revalidatePath(`/proposals/${item.proposalId}`);
    return { ok: true, message: "Enregistré." };
  });
}

export async function setProposalStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const id = Id.parse(fd.get("proposalId"));
    const status = z.enum(["DRAFT", "IN_REVIEW", "VALIDATED"]).parse(fd.get("status"));
    const p = await prisma.proposal.findFirst({ where: { id, organizationId: ctx.orgId }, include: { sections: { select: { status: true } } } });
    if (!p) throw new NotFoundError("Mémoire introuvable");
    if (status === "VALIDATED" && p.sections.some((s) => s.status !== "VALIDATED")) {
      return { error: "Toutes les sections doivent être validées individuellement avant de valider le mémoire." };
    }
    await prisma.proposal.update({ where: { id }, data: { status } });
    if (status === "IN_REVIEW") await prisma.tender.updateMany({ where: { id: p.tenderId, organizationId: ctx.orgId, status: "IN_PREPARATION" }, data: { status: "IN_VALIDATION" } });
    let message: string | undefined;
    if (status === "VALIDATED") {
      // La consultation ne passe « Prête à déposer » que si tout le dossier l'est (autres lots, pièces, chiffrage…).
      const readiness = await loadReadiness(ctx.orgId, p.tenderId);
      const next = readiness.ready ? "READY_TO_SUBMIT" : "IN_VALIDATION";
      await prisma.tender.updateMany({ where: { id: p.tenderId, organizationId: ctx.orgId, status: { in: ["IN_PREPARATION", "IN_VALIDATION"] } }, data: { status: next } });
      message = readiness.ready
        ? "Mémoire validé. Le dossier est complet : candidature « Prête à déposer »."
        : `Mémoire validé. Il reste ${readiness.blockers} point(s) bloquant(s) avant le dépôt (voir le contrôle sur la fiche de l'appel d'offres).`;
    }
    await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "proposal.status_changed", entityType: "Proposal", entityId: id, metadata: { status } });
    revalidatePath(`/proposals/${id}`);
    revalidatePath(`/tenders/${p.tenderId}`);
    return { ok: true, message };
  });
}
