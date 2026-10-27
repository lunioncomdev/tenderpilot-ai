import type { Prisma, SourceKey, SyncStatus } from "@prisma/client";
import { prisma } from "../db";
import { DEFAULT_CPV_CODES, DEFAULT_KEYWORDS } from "../connectors/defaults";
import { getConnector } from "../connectors/registry";
import type { TenderConnector } from "../connectors/types";
import { logger } from "../logger";
import { applyNotice } from "./apply-notice";

export type SourceSettings = { daysBack?: number; countries?: string[]; maxNotices?: number };

const OVERLAP_DAYS = 2;

export async function runSync(
  orgId: string,
  source: SourceKey,
  opts: { trigger?: "manual" | "cron"; connector?: TenderConnector; now?: Date } = {},
) {
  const now = opts.now ?? new Date();
  const config = await prisma.sourceConfig.findUnique({
    where: { organizationId_source: { organizationId: orgId, source } },
  });
  if (config && !config.enabled) throw new Error(`La source ${source} est désactivée`);
  const settings = (config?.settings ?? {}) as SourceSettings;
  const profile = await prisma.companyProfile.findUnique({ where: { organizationId: orgId } });

  const daysBack = settings.daysBack ?? 14;
  const since = config?.lastSyncAt
    ? new Date(config.lastSyncAt.getTime() - OVERLAP_DAYS * 86_400_000)
    : new Date(now.getTime() - daysBack * 86_400_000);

  const run = await prisma.syncRun.create({
    data: { organizationId: orgId, source, trigger: opts.trigger ?? "manual" },
  });
  const counters = { fetched: 0, created: 0, updated: 0, duplicates: 0 };
  const errors: Array<{ externalId?: string; message: string }> = [];
  let status: SyncStatus = "SUCCESS";

  try {
    const connector = opts.connector ?? getConnector(source);
    const notices = connector.fetchNotices({
      since,
      until: now,
      cpvCodes: profile?.cpvCodes.length ? profile.cpvCodes : DEFAULT_CPV_CODES,
      keywords: profile?.keywords.length ? profile.keywords : DEFAULT_KEYWORDS,
      countries: settings.countries ?? profile?.eligibleCountries ?? ["FR"],
      maxNotices: settings.maxNotices ?? 2000,
    });
    for await (const notice of notices) {
      counters.fetched++;
      try {
        const outcome = await applyNotice(prisma, orgId, notice, profile, now);
        if (outcome === "created") counters.created++;
        else if (outcome === "updated") counters.updated++;
        else if (outcome === "duplicate") counters.duplicates++;
      } catch (err) {
        errors.push({ externalId: notice.externalId, message: (err as Error).message.slice(0, 300) });
        if (errors.length > 50) throw new Error("Trop d'erreurs d'enregistrement, synchronisation interrompue");
      }
    }
    if (errors.length) status = "PARTIAL";
  } catch (err) {
    logger.error({ err, orgId, source }, "échec de synchronisation");
    errors.push({ message: (err as Error).message.slice(0, 500) });
    status = counters.fetched > 0 ? "PARTIAL" : "FAILED";
  }

  const finished = await prisma.syncRun.update({
    where: { id: run.id },
    data: { ...counters, status, errors: errors as Prisma.InputJsonValue, finishedAt: new Date() },
  });
  await prisma.sourceConfig.upsert({
    where: { organizationId_source: { organizationId: orgId, source } },
    create: { organizationId: orgId, source, lastStatus: status, lastSyncAt: status === "FAILED" ? null : now },
    update: { lastStatus: status, ...(status === "FAILED" ? {} : { lastSyncAt: now }) },
  });
  logger.info({ orgId, source, status, ...counters }, "synchronisation terminée");
  return finished;
}
