"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import type { ActionState } from "@/components/form";
import { formObject, runAction } from "@/server/actions";
import { audit } from "@/server/audit";
import { hashPassword, PasswordSchema } from "@/server/auth/password";
import { requireContext } from "@/server/auth/context";
import { prisma } from "@/server/db";
import { PLAN_LIMITS } from "@/server/ai/gateway";
import { AiRulesSchema } from "@/server/ai/rules";
import { CRITERIA } from "@/server/scoring/engine";

export async function saveWeightsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("ADMIN");
    const raw = formObject(fd);
    const weights = Object.fromEntries(CRITERIA.map((c) => [c.key, z.coerce.number().min(0).max(100).parse(raw[c.key])]));
    if (Object.values(weights).reduce((a, b) => a + b, 0) <= 0) return { error: "Au moins une pondération doit être positive." };
    await prisma.companyProfile.update({ where: { organizationId: ctx.orgId }, data: { scoringWeights: weights } });
    await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "scoring.weights_updated", entityType: "CompanyProfile", metadata: weights });
    revalidatePath("/settings");
    return { ok: true, message: "Pondérations enregistrées (normalisées à 100). Recalculez les scores depuis les fiches." };
  });
}

const MemberSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email(),
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]),
  password: PasswordSchema,
});

/** Ajout d'un collaborateur avec mot de passe initial (pas d'envoi d'e-mail dans le MVP). */
export async function addMemberAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("ADMIN");
    const d = MemberSchema.parse(formObject(fd));
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, include: { _count: { select: { memberships: true } } } });
    if (org._count.memberships >= PLAN_LIMITS[org.plan].maxUsers) return { error: `Limite d'utilisateurs de l'offre ${org.plan} atteinte.` };
    const email = d.email.toLowerCase();
    if (await prisma.user.findUnique({ where: { email } })) return { error: "Un compte existe déjà avec cette adresse." };
    const user = await prisma.user.create({ data: { email, name: d.name, passwordHash: await hashPassword(d.password) } });
    await prisma.membership.create({ data: { userId: user.id, organizationId: ctx.orgId, role: d.role } });
    await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "member.added", entityType: "User", entityId: user.id, metadata: { role: d.role } });
    revalidatePath("/settings");
    return { ok: true, message: "Collaborateur ajouté. Communiquez-lui son mot de passe initial par un canal sûr." };
  });
}

export async function saveAiRulesAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("ADMIN");
    const rules = AiRulesSchema.parse(formObject(fd));
    await prisma.companyProfile.update({ where: { organizationId: ctx.orgId }, data: { aiRules: rules } });
    await audit({
      orgId: ctx.orgId, userId: ctx.userId, action: "ai.rules_updated", entityType: "CompanyProfile",
      metadata: Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, v.length])),
    });
    revalidatePath("/settings");
    return { ok: true, message: "Règles enregistrées. Elles s'appliquent aux prochains traitements IA." };
  });
}
