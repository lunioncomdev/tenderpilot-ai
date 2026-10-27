"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import type { ActionState } from "@/components/form";
import { formObject, runAction } from "@/server/actions";
import { audit } from "@/server/audit";
import { requireContext } from "@/server/auth/context";
import { computeDedupKey } from "@/server/connectors/dedup";
import { prisma } from "@/server/db";
import { computePreScore } from "@/server/scoring/prescore";

export async function saveSearchAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const name = z.string().trim().min(2).max(80).parse(fd.get("name"));
    const query = z.string().max(2000).parse(fd.get("query") ?? "");
    const filters = Object.fromEntries(new URLSearchParams(query));
    delete filters.page;
    await prisma.savedSearch.create({ data: { organizationId: ctx.orgId, userId: ctx.userId, name, filters } });
    revalidatePath("/tenders");
    return { ok: true, message: "Recherche enregistrée." };
  });
}

export async function deleteSearchAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    await prisma.savedSearch.deleteMany({ where: { id: String(fd.get("id")), organizationId: ctx.orgId, userId: ctx.userId } });
    revalidatePath("/tenders");
    return { ok: true };
  });
}

const ManualSchema = z.object({
  title: z.string().trim().min(5).max(500),
  buyerName: z.string().trim().max(300).default(""),
  description: z.string().max(10_000).default(""),
  buyerCountry: z.string().trim().length(2).transform((s) => s.toUpperCase()),
  estimatedValue: z.preprocess((v) => (v === "" ? null : Number(v)), z.number().nonnegative().nullable()),
  deadlineAt: z.preprocess((v) => (v ? new Date(String(v)) : null), z.date().nullable()),
  noticeUrl: z.preprocess((v) => (v === "" ? null : v), z.url().nullable()),
  isPublicMarket: z.preprocess((v) => v === "on", z.boolean()),
});

/** Saisie manuelle d'une consultation (marché privé, plateforme non connectée…). */
export async function createManualTenderAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const d = ManualSchema.parse(formObject(fd));
    const profile = await prisma.companyProfile.findUnique({ where: { organizationId: ctx.orgId } });
    const t = await prisma.tender.create({
      data: {
        ...d,
        organizationId: ctx.orgId,
        origin: "MANUAL",
        externalId: randomUUID(),
        dedupKey: computeDedupKey({ buyerName: d.buyerName, title: d.title, deadlineAt: d.deadlineAt }),
        publishedAt: new Date(),
        status: "TO_ANALYZE",
        preScore: computePreScore({ ...d, cpvCodes: [] }, profile).total,
      },
    });
    await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "tender.created_manual", entityType: "Tender", entityId: t.id });
    return { ok: true, message: t.id };
  });
  if (res?.ok && res.message) redirect(`/tenders/${res.message}`);
  return res;
}
