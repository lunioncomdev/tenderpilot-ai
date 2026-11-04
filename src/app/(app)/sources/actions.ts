"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import type { ActionState } from "@/components/form";
import { formObject, runAction } from "@/server/actions";
import { audit } from "@/server/audit";
import { requireContext } from "@/server/auth/context";
import { prisma } from "@/server/db";
import { enqueue } from "@/server/queue/queues";

const Source = z.enum(["BOAMP", "APPROCH"]);

const SettingsSchema = z.object({
  source: Source,
  enabled: z.preprocess((v) => v === "on", z.boolean()),
  daysBack: z.coerce.number().int().min(1).max(90),
  maxNotices: z.coerce.number().int().min(10).max(10_000),
});

export async function saveSourceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("ADMIN");
    const d = SettingsSchema.parse(formObject(fd));
    await prisma.sourceConfig.upsert({
      where: { organizationId_source: { organizationId: ctx.orgId, source: d.source } },
      create: { organizationId: ctx.orgId, source: d.source, enabled: d.enabled, settings: { daysBack: d.daysBack, maxNotices: d.maxNotices } },
      update: { enabled: d.enabled, settings: { daysBack: d.daysBack, maxNotices: d.maxNotices } },
    });
    await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "source.updated", entityType: "SourceConfig", entityId: d.source, metadata: d });
    revalidatePath("/sources");
    return { ok: true, message: "Configuration enregistrée." };
  });
}

export async function syncNowAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("MEMBER");
    const source = Source.parse(fd.get("source"));
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { syncPausedAt: true } });
    if (org.syncPausedAt) return { error: "Synchronisation en pause : reprenez-la pour lancer une synchronisation." };
    const cfg = await prisma.sourceConfig.findUnique({ where: { organizationId_source: { organizationId: ctx.orgId, source } } });
    if (cfg && !cfg.enabled) return { error: "Source désactivée." };
    await enqueue("sync-source", { orgId: ctx.orgId, source, trigger: "manual" }, { jobId: `sync-${ctx.orgId}-${source}-${Date.now()}` });
    await audit({ orgId: ctx.orgId, userId: ctx.userId, action: "source.sync_requested", entityType: "SourceConfig", entityId: source });
    revalidatePath("/sources");
    return { ok: true, message: "Synchronisation lancée. Le résultat apparaîtra dans l'historique." };
  });
}

/** Met en pause ou reprend toutes les synchronisations de l'organisation (planifiées et manuelles). */
export async function toggleSyncPauseAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await requireContext("ADMIN");
    const pause = z.enum(["pause", "resume"]).parse(fd.get("intent")) === "pause";
    await prisma.organization.update({
      where: { id: ctx.orgId },
      data: pause ? { syncPausedAt: new Date(), syncPausedById: ctx.userId } : { syncPausedAt: null, syncPausedById: null },
    });
    await audit({ orgId: ctx.orgId, userId: ctx.userId, action: pause ? "sync.paused" : "sync.resumed", entityType: "Organization", entityId: ctx.orgId });
    revalidatePath("/sources");
    return { ok: true, message: pause ? "Synchronisation mise en pause : aucune synchronisation planifiée ne sera lancée." : "Synchronisation reprise." };
  });
}
