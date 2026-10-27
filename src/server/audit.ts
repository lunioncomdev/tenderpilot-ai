import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { logger } from "./logger";

export async function audit(entry: {
  orgId: string;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: entry.orgId,
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata ?? {},
      },
    });
  } catch (err) {
    // L'audit ne doit jamais faire échouer l'opération métier, mais l'échec est tracé.
    logger.error({ err, action: entry.action }, "échec d'écriture du journal d'audit");
  }
}
