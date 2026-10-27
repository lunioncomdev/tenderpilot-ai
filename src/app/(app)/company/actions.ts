"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import type { ActionState } from "@/components/form";
import { splitList } from "@/lib/utils";
import { formObject, runAction } from "@/server/actions";
import { audit } from "@/server/audit";
import { requireContext } from "@/server/auth/context";
import { prisma } from "@/server/db";
import { computePreScore } from "@/server/scoring/prescore";

const list = z.string().optional().transform((s) => splitList(s ?? ""));
const optInt = z.preprocess((v) => (v === "" || v === undefined ? null : Number(String(v).replace(/\s/g, ""))), z.number().int().nonnegative().nullable());
const text = (max = 5000) => z.string().max(max).optional().transform((s) => (s ?? "").trim());
const checkbox = z.preprocess((v) => v === "on" || v === "true", z.boolean());

const ProfileSchema = z
  .object({
    legalName: z.string().trim().min(2).max(200),
    siren: z.string().trim().regex(/^(\d{9}|\d{14})?$/, "SIREN (9 chiffres) ou SIRET (14 chiffres)").optional(),
    country: z.string().trim().length(2, "Code pays ISO à 2 lettres").transform((s) => s.toUpperCase()),
    eligibleCountries: list.transform((l) => l.map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c))),
    description: text(),
    skills: list,
    technologies: list,
    certifications: list,
    headcount: optInt,
    annualRevenueEur: optInt,
    minBudgetEur: optInt,
    maxBudgetEur: optInt,
    cpvCodes: list.transform((l) => l.map((c) => c.replace(/\D/g, "")).filter((c) => c.length === 8)),
    keywords: list,
    canSubcontract: checkbox,
    canJoinConsortium: checkbox,
    insuranceRc: checkbox,
    methodology: text(),
    qualityProcess: text(),
    securityPolicy: text(),
    gdprCommitments: text(),
    ecoDesign: text(),
    accessibility: text(),
  })
  .refine((d) => d.minBudgetEur === null || d.maxBudgetEur === null || d.minBudgetEur <= d.maxBudgetEur, {
    message: "Le budget minimum doit être inférieur au maximum",
    path: ["minBudgetEur"],
  });

/** Recalcule le pré-score des avis actifs après modification du profil. */
async function refreshPreScores(orgId: string) {
  const profile = await prisma.companyProfile.findUnique({ where: { organizationId: orgId } });
  const tenders = await prisma.tender.findMany({
    where: { organizationId: orgId, noticeState: { in: ["ACTIVE", "MODIFIED"] }, OR: [{ deadlineAt: null }, { deadlineAt: { gte: new Date() } }] },
    take: 3000,
  });
  for (const t of tenders) {
    const s = computePreScore(t, profile).total;
    if (s !== t.preScore) await prisma.tender.update({ where: { id: t.id }, data: { preScore: s } });
  }
}

export async function saveProfileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("ADMIN");
    const data = ProfileSchema.parse(formObject(fd));
    if (!data.eligibleCountries.length) data.eligibleCountries = [data.country];
    await prisma.companyProfile.upsert({
      where: { organizationId: ctx.orgId },
      create: { organizationId: ctx.orgId, ...data, siren: data.siren || null },
      update: { ...data, siren: data.siren || null },
    });
    await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "profile.updated", entityType: "CompanyProfile" });
    await refreshPreScores(ctx.orgId);
    revalidatePath("/company");
    return { ok: true, message: "Profil enregistré. Pré-scores recalculés." };
  });
}

export async function savePrivacyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("OWNER");
    const allow = fd.get("allowAiDocumentUpload") === "on";
    await prisma.companyProfile.update({ where: { organizationId: ctx.orgId }, data: { allowAiDocumentUpload: allow } });
    await audit({ orgId: ctx.orgId, userId: ctx.userId, action: allow ? "privacy.ai_upload_allowed" : "privacy.ai_upload_revoked", entityType: "CompanyProfile" });
    revalidatePath("/company");
    return { ok: true, message: allow ? "Envoi des DCE à l'IA autorisé." : "Envoi des DCE à l'IA désactivé." };
  });
}

const ReferenceSchema = z.object({
  title: z.string().trim().min(3).max(200),
  client: z.string().trim().min(2).max(200),
  clientType: z.string().max(40).optional(),
  year: optInt,
  amountEur: optInt,
  durationMonths: optInt,
  description: z.string().trim().min(10, "Décrivez le projet (10 caractères minimum)").max(5000),
  technologies: list,
  sector: z.string().max(100).optional(),
  isPublic: checkbox,
});

export async function addReferenceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const data = ReferenceSchema.parse(formObject(fd));
    const ref = await prisma.companyReference.create({ data: { ...data, organizationId: ctx.orgId } });
    await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "reference.created", entityType: "CompanyReference", entityId: ref.id });
    revalidatePath("/company");
    return { ok: true, message: "Référence ajoutée." };
  });
}

export async function deleteReferenceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("ADMIN");
    const id = z.string().min(1).parse(fd.get("id"));
    const res = await prisma.companyReference.deleteMany({ where: { id, organizationId: ctx.orgId } });
    if (res.count) await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "reference.deleted", entityType: "CompanyReference", entityId: id });
    revalidatePath("/company");
    return { ok: true };
  });
}
