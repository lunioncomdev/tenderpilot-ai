import type { Prisma, SourceKey, SyncStatus } from "@prisma/client";
import { prisma } from "../db";
import { DEFAULT_CPV_CODES, DEFAULT_KEYWORDS } from "../connectors/defaults";
import { getConnector } from "../connectors/registry";
import type { TenderConnector } from "../connectors/types";
import { isWebDevProject } from "../connectors/relevance";
import { logger } from "../logger";
import { enqueue } from "../queue/queues";
import { applyNotice } from "./apply-notice";

export type SourceSettings = { daysBack?: number; maxNotices?: number };

const OVERLAP_DAYS = 2;
/** Seuls les marchés d'acheteurs français sont suivis (TED est filtré sur la France). */
const COUNTRIES = ["FR"];

export async function runSync(
  orgId: string,
  source: SourceKey,
  opts: {
    trigger?: "manual" | "cron";
    connector?: TenderConnector;
    now?: Date;
    /** Pertinence d'un nouvel avis ; par défaut, projets de développement web. */
    isRelevant?: (title: string) => boolean;
    /** Met en file l'import de l'extrait PDF puis l'analyse IA des nouveaux avis BOAMP (worker). */
    autoImportNotices?: boolean;
  } = {},
) {
  const now = opts.now ?? new Date();
  const isRelevant = opts.isRelevant ?? isWebDevProject;
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
  const createdBoamp: string[] = [];
  const errors: Array<{ externalId?: string; message: string }> = [];
  let status: SyncStatus = "SUCCESS";

  try {
    const connector = opts.connector ?? getConnector(source);
    const notices = connector.fetchNotices({
      since,
      until: now,
      cpvCodes: profile?.cpvCodes.length ? profile.cpvCodes : DEFAULT_CPV_CODES,
      keywords: profile?.keywords.length ? profile.keywords : DEFAULT_KEYWORDS,
      countries: COUNTRIES,
      maxNotices: settings.maxNotices ?? 2000,
    });
    for await (const notice of notices) {
      if (notice.buyerCountry && !COUNTRIES.includes(notice.buyerCountry)) continue;
      // Annulations, attributions et rectificatifs sans objet ne font que mettre à jour un avis déjà retenu.
      if ((notice.kind === "TENDER" || (notice.kind === "CORRECTION" && notice.title)) && !isRelevant(notice.title)) continue;
      counters.fetched++;
      try {
        const outcome = await applyNotice(prisma, orgId, notice, profile, now);
        if (outcome === "created") {
          counters.created++;
          if (notice.source === "BOAMP") createdBoamp.push(notice.externalId);
        }
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

  if (opts.autoImportNotices && createdBoamp.length) await enqueueNoticeImports(orgId, createdBoamp);

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

/** Un échec de mise en file ne remet pas en cause la synchronisation : l'import reste possible à la main. */
async function enqueueNoticeImports(orgId: string, externalIds: string[]) {
  const tenders = await prisma.tender.findMany({
    where: { organizationId: orgId, origin: "BOAMP", externalId: { in: externalIds }, publishedAt: { not: null } },
    select: { id: true },
  });
  for (const t of tenders) {
    try {
      await enqueue(
        "import-notice-pdf",
        { orgId, tenderId: t.id, userId: null, analyze: true },
        { jobId: `notice-auto-${t.id}`, attempts: 3, backoff: { type: "exponential", delay: 60_000 } },
      );
    } catch (err) {
      logger.warn({ err, orgId, tenderId: t.id }, "mise en file de l'import de l'avis impossible");
    }
  }
}
