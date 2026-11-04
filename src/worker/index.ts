import { UnrecoverableError, Worker, type Job } from "bullmq";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { redis } from "@/server/redis";
import { requestAutoAnalysis, runAnalysis } from "@/server/analysis/analysis-service";
import { ALL_SOURCES } from "@/server/connectors/registry";
import { importBoampNoticePdf } from "@/server/documents/boamp-notice";
import { processDocument } from "@/server/documents/document-service";
import {
  analyzeAfterRetrieval, autoRetrieveDce, DceRetrievalUnavailableError, enqueuePendingDce, retrieveDce, retrievePendingDce,
} from "@/server/dce/retrieve-service";
import { generateCompliance } from "@/server/proposals/compliance-service";
import { generateSection } from "@/server/proposals/proposal-service";
import { enqueue, getQueue, type JobMap, type QueueName } from "@/server/queue/queues";
import { runSync } from "@/server/sync/sync-service";
import { AiNotAllowedError } from "@/server/ai/gateway";
import { LlmError } from "@/server/ai/provider";

async function handle(job: Job) {
  const name = job.name as keyof JobMap;
  switch (name) {
    case "sync-source": {
      const d = job.data as JobMap["sync-source"];
      // Pause décidée après la mise en file : le job est ignoré.
      const org = await prisma.organization.findUnique({ where: { id: d.orgId }, select: { syncPausedAt: true } });
      if (!org || org.syncPausedAt) return { skipped: "paused" };
      const run = await runSync(d.orgId, d.source, { trigger: d.trigger, autoImportNotices: true });
      // Puis rattrapage des DCE non retirés (offres antérieures, imports manqués).
      await enqueuePendingDce(d.orgId).catch((err) => logger.warn({ err, orgId: d.orgId }, "rattrapage des DCE non mis en file"));
      return run;
    }
    case "sync-all": {
      const configs = await prisma.sourceConfig.findMany({
        where: { enabled: true, source: { in: ALL_SOURCES }, organization: { syncPausedAt: null } },
      });
      for (const c of configs) await enqueue("sync-source", { orgId: c.organizationId, source: c.source, trigger: "cron" });
      return { enqueued: configs.length };
    }
    case "process-document": {
      const d = job.data as JobMap["process-document"];
      return processDocument(d.orgId, d.documentId);
    }
    case "import-notice-pdf": {
      const d = job.data as JobMap["import-notice-pdf"];
      const imported = await importBoampNoticePdf(d.orgId, d.tenderId, d.userId);
      if (!d.analyze || imported.duplicate) return imported;
      // Retrait automatique du DCE (si activé) avant l'analyse, pour qu'elle porte sur le dossier complet.
      const dce = await autoRetrieveDce(d.orgId, d.tenderId);
      const auto = await requestAutoAnalysis(d.orgId, d.tenderId);
      if (auto.analysis) {
        await enqueue("analyze-tender", { orgId: d.orgId, analysisId: auto.analysis.id }, { jobId: `analysis-${auto.analysis.id}`, attempts: 2 });
      }
      return { ...imported, dce, analysis: auto };
    }
    case "retrieve-dce": {
      const d = job.data as JobMap["retrieve-dce"];
      const outcome = await retrieveDce(d.orgId, d.tenderId, d.userId);
      return { ...outcome, analysisId: await analyzeAfterRetrieval(d.orgId, d.tenderId, outcome) };
    }
    case "retrieve-dce-pending": {
      const d = job.data as JobMap["retrieve-dce-pending"];
      return retrievePendingDce(d.orgId);
    }
    case "analyze-tender": {
      const d = job.data as JobMap["analyze-tender"];
      return runAnalysis(d.orgId, d.analysisId);
    }
    case "generate-section": {
      const d = job.data as JobMap["generate-section"];
      return generateSection(d.orgId, d.sectionId, d.instruction);
    }
    case "generate-compliance": {
      const d = job.data as JobMap["generate-compliance"];
      return generateCompliance(d.orgId, d.proposalId, d.overwrite);
    }
    default:
      throw new UnrecoverableError(`Job inconnu : ${job.name}`);
  }
}

/** Les erreurs de configuration / refus ne doivent pas être réessayées (coûts). */
async function processor(job: Job) {
  try {
    return await handle(job);
  } catch (err) {
    if (err instanceof AiNotAllowedError || err instanceof DceRetrievalUnavailableError || (err instanceof LlmError && err.code !== "api")) {
      throw new UnrecoverableError((err as Error).message);
    }
    throw err;
  }
}

const CONCURRENCY: Record<QueueName, number> = { sync: 1, documents: 2, ai: 2 };

async function main() {
  env(); // valide la configuration au démarrage
  const workers = (Object.keys(CONCURRENCY) as QueueName[]).map((q) => {
    const w = new Worker(q, processor, { connection: redis(), concurrency: CONCURRENCY[q] });
    w.on("completed", (job) => logger.info({ queue: q, job: job.name, id: job.id }, "job terminé"));
    w.on("failed", (job, err) => logger.error({ queue: q, job: job?.name, id: job?.id, err: err.message }, "job en échec"));
    return w;
  });

  await getQueue("sync").upsertJobScheduler("sync-all-cron", { pattern: env().SYNC_CRON, tz: "Europe/Paris" }, { name: "sync-all", data: {} });
  logger.info({ queues: Object.keys(CONCURRENCY), syncCron: env().SYNC_CRON, sources: ALL_SOURCES }, "worker démarré");

  const shutdown = async () => {
    logger.info("arrêt du worker");
    await Promise.all(workers.map((w) => w.close()));
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, "échec du démarrage du worker");
  process.exit(1);
});
