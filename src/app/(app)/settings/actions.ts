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
import { checkOpenAiAccess } from "@/server/ai/openai";
import { env } from "@/server/env";
import { AiRulesSchema } from "@/server/ai/rules";
import { enqueuePendingDce, settingsProblem } from "@/server/dce/retrieve-service";
import { decryptSecret, encryptSecret } from "@/server/dce/secrets";
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

const txt = (max: number) => z.string().trim().max(max).default("");
const DceSettingsSchema = z.object({
  mode: z.enum(["DISABLED", "ANONYMOUS", "IDENTIFIED"]),
  firstName: txt(80), lastName: txt(80),
  email: z.union([z.literal(""), z.email()]).default(""),
  phone: z.string().trim().max(30).regex(/^[+\d\s.()-]*$/, "Téléphone invalide").default(""),
  legalName: txt(200),
  siret: z.string().transform((v) => v.replace(/\s/g, "")).pipe(z.union([z.literal(""), z.string().regex(/^\d{14}$/, "Le SIRET doit comporter 14 chiffres")])).default(""),
  address: txt(200), address2: txt(200),
  postalCode: z.string().trim().max(10).regex(/^[\dA-Za-z -]*$/, "Code postal invalide").default(""),
  city: txt(100),
  acceptTerms: z.preprocess((v) => v === "on", z.boolean()),
  autoRetrieve: z.preprocess((v) => v === "on", z.boolean()),
});

/** Paramètres de retrait automatique des DCE (mode, coordonnées transmises aux acheteurs, CGU). */
export async function saveDceSettingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("ADMIN");
    const { acceptTerms, ...d } = DceSettingsSchema.parse(formObject(fd));
    const current = await prisma.dceRetrievalSettings.findUnique({ where: { organizationId: ctx.orgId } });
    const terms = acceptTerms
      ? { termsAcceptedAt: current?.termsAcceptedAt ?? new Date(), termsAcceptedById: current?.termsAcceptedById ?? ctx.userId }
      : { termsAcceptedAt: null, termsAcceptedById: null };
    const saved = await prisma.dceRetrievalSettings.upsert({
      where: { organizationId: ctx.orgId },
      create: { organizationId: ctx.orgId, ...d, ...terms },
      update: { ...d, ...terms },
    });
    await audit({
      orgId: ctx.orgId, userId: ctx.userId, action: "dce.settings_updated", entityType: "DceRetrievalSettings", entityId: saved.id,
      metadata: { mode: d.mode, autoRetrieve: d.autoRetrieve, termsAccepted: acceptTerms },
    });
    revalidatePath("/settings");
    const problem = settingsProblem(saved);
    const pending = d.autoRetrieve && !problem ? await enqueuePendingDce(ctx.orgId) : false;
    return problem && d.mode !== "DISABLED" ? { ok: true, message: `Enregistré, mais retrait encore impossible : ${problem}.` } : { ok: true, message: pending ? "Paramètres enregistrés. Retrait des DCE des offres ouvertes lancé." : "Paramètres de récupération des DCE enregistrés." };
  });
}

const AccountSchema = z.object({
  host: z.string().trim().toLowerCase()
    .transform((v) => v.replace(/^https?:\/\//, "").split("/")[0])
    .pipe(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Nom de domaine invalide (ex. www.marches-publics.info)")),
  login: z.string().trim().min(1, "Identifiant requis").max(200),
  password: z.string().max(200).default(""),
});

/** Ajout ou mise à jour d'un compte plateforme (mot de passe chiffré, jamais réaffiché). */
export async function savePlatformAccountAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("ADMIN");
    const d = AccountSchema.parse(formObject(fd));
    const key = { organizationId_host: { organizationId: ctx.orgId, host: d.host } };
    const existing = await prisma.platformAccount.findUnique({ where: key });
    if (!existing && !d.password) return { error: "Mot de passe requis pour un nouveau compte." };
    const passwordEnc = d.password ? encryptSecret(d.password) : existing!.passwordEnc;
    await prisma.platformAccount.upsert({
      where: key,
      create: { organizationId: ctx.orgId, host: d.host, login: d.login, passwordEnc, createdById: ctx.userId },
      update: { login: d.login, passwordEnc },
    });
    await audit({ orgId: ctx.orgId, userId: ctx.userId, action: existing ? "platform_account.updated" : "platform_account.added", entityType: "PlatformAccount", metadata: { host: d.host, passwordChanged: !!d.password } });
    revalidatePath("/settings");
    return { ok: true, message: `Compte ${d.host} enregistré.` };
  });
}

export async function deletePlatformAccountAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("ADMIN");
    const id = z.string().min(1).parse(fd.get("id"));
    const acc = await prisma.platformAccount.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!acc) return { error: "Compte introuvable." };
    await prisma.platformAccount.delete({ where: { id } });
    await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "platform_account.deleted", entityType: "PlatformAccount", metadata: { host: acc.host } });
    revalidatePath("/settings");
    return { ok: true, message: `Compte ${acc.host} supprimé.` };
  });
}

const AiSettingsSchema = z.object({
  model: z.string().trim().max(100).regex(/^[A-Za-z0-9._:-]*$/, "Nom de modèle invalide (ex. gpt-5.5)").default(""),
  apiKey: z.string().trim().max(500).regex(/^(sk-[A-Za-z0-9_-]{16,})?$/, "Clé API OpenAI invalide (elle commence par « sk- »)").default(""),
  clearKey: z.preprocess((v) => v === "on", z.boolean()),
});

/** Clé API (chiffrée, jamais réaffichée) et modèle OpenAI de l'organisation. Champs vides : variables d'environnement. */
export async function saveAiSettingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("ADMIN");
    const d = AiSettingsSchema.parse(formObject(fd));
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { openaiApiKeyEnc: true, aiModel: true } });
    const e = env();
    const model = d.model || null;
    const keyChanged = !!d.apiKey || (d.clearKey && !!org.openaiApiKeyEnc);
    let effectiveKey: string | undefined = d.apiKey || undefined;
    if (!effectiveKey && !d.clearKey && org.openaiApiKeyEnc) {
      try { effectiveKey = decryptSecret(org.openaiApiKeyEnc); } catch { /* clé illisible : repli sur l'environnement */ }
    }
    effectiveKey ??= e.OPENAI_API_KEY;
    // Vérification auprès d'OpenAI dès que la clé ou le modèle change.
    if (effectiveKey && (keyChanged || model !== org.aiModel)) {
      const problem = await checkOpenAiAccess(effectiveKey, model ?? e.AI_MODEL);
      if (problem) return { error: `${problem}. Paramètres non enregistrés.` };
    }
    await prisma.organization.update({
      where: { id: ctx.orgId },
      data: {
        aiModel: model,
        ...(d.apiKey ? { openaiApiKeyEnc: encryptSecret(d.apiKey) } : d.clearKey ? { openaiApiKeyEnc: null } : {}),
      },
    });
    await audit({
      orgId: ctx.orgId, userId: ctx.userId, action: "ai.settings_updated", entityType: "Organization", entityId: ctx.orgId,
      metadata: { model, keyChanged: !!d.apiKey, keyCleared: d.clearKey && !d.apiKey },
    });
    revalidatePath("/settings");
    if (e.AI_PROVIDER !== "openai") return { ok: true, message: "Enregistré, mais le fournisseur actif est Anthropic (AI_PROVIDER) : ces réglages ne s'appliquent qu'à OpenAI." };
    if (!effectiveKey) return { ok: true, message: "Enregistré. Aucune clé API OpenAI disponible : l'IA reste inactive." };
    return { ok: true, message: `Paramètres IA enregistrés — modèle ${model ?? e.AI_MODEL}.` };
  });
}
