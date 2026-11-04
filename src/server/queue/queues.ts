import { Queue, type JobsOptions } from "bullmq";
import type { SourceKey } from "@prisma/client";
import { redis } from "../redis";

export type JobMap = {
  "sync-source": { orgId: string; source: SourceKey; trigger: "manual" | "cron" };
  "sync-all": Record<string, never>;
  "process-document": { orgId: string; documentId: string };
  /** `analyze` : enchaîne l'analyse IA une fois l'extrait importé (avis reçus par synchronisation). */
  "import-notice-pdf": { orgId: string; tenderId: string; userId: string | null; analyze?: boolean };
  /** Retrait du DCE sur le profil acheteur (bouton de la fiche). */
  "retrieve-dce": { orgId: string; tenderId: string; userId: string | null };
  /** Rattrapage des DCE non encore retirés (après synchronisation ou activation de l'option). */
  "retrieve-dce-pending": { orgId: string };
  "analyze-tender": { orgId: string; analysisId: string };
  "generate-section": { orgId: string; sectionId: string; instruction?: string };
  "generate-compliance": { orgId: string; proposalId: string; overwrite: boolean };
};

export type JobName = keyof JobMap;

export const QUEUE_FOR: Record<JobName, QueueName> = {
  "sync-source": "sync",
  "sync-all": "sync",
  "process-document": "documents",
  "import-notice-pdf": "documents",
  "retrieve-dce": "documents",
  "retrieve-dce-pending": "documents",
  "analyze-tender": "ai",
  "generate-section": "ai",
  "generate-compliance": "ai",
};

export type QueueName = "sync" | "documents" | "ai";

const DEFAULTS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 10_000 },
  removeOnComplete: { age: 7 * 86_400, count: 1000 },
  removeOnFail: { age: 30 * 86_400 },
};

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redis(), defaultJobOptions: DEFAULTS });
    queues.set(name, q);
  }
  return q;
}

export async function enqueue<N extends JobName>(name: N, data: JobMap[N], opts: JobsOptions = {}) {
  return getQueue(QUEUE_FOR[name]).add(name, data, opts);
}
