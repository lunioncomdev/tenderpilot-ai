import { Prisma } from "@prisma/client";
import { prisma } from "./db";

/** Divisions CPV (2 premiers chiffres) les plus fréquentes en informatique. */
const CPV_DIVISIONS: Record<string, string> = {
  "72": "Services informatiques",
  "48": "Logiciels",
  "30": "Matériel informatique",
  "50": "Maintenance / réparation",
  "79": "Services aux entreprises",
  "80": "Formation",
  "64": "Télécommunications",
  "32": "Équipements radio / télécom",
  "73": "Recherche et développement",
  "71": "Ingénierie",
};

export async function getDashboard(orgId: string, now = new Date()) {
  const day = 86_400_000;
  const active: Prisma.TenderWhereInput = {
    organizationId: orgId,
    duplicateOfId: null,
    noticeState: { in: ["ACTIVE", "MODIFIED"] },
    OR: [{ deadlineAt: null }, { deadlineAt: { gte: now } }],
  };

  const [newCount, qualified, priority, preparing, upcoming, won, lost, submittedValue, byCountry, cpvRows, weekly, recentScores] =
    await Promise.all([
      prisma.tender.count({ where: { organizationId: orgId, duplicateOfId: null, createdAt: { gte: new Date(now.getTime() - 7 * day) } } }),
      prisma.tender.count({ where: { ...active, status: { in: ["QUALIFIED", "GO"] } } }),
      prisma.tender.count({ where: { ...active, preScore: { gte: 80 } } }),
      prisma.tender.count({ where: { organizationId: orgId, status: { in: ["IN_PREPARATION", "IN_VALIDATION", "READY_TO_SUBMIT"] } } }),
      prisma.tender.findMany({
        where: { organizationId: orgId, duplicateOfId: null, deadlineAt: { gte: now, lte: new Date(now.getTime() + 14 * day) }, status: { notIn: ["NO_GO", "LOST", "WON", "DETECTED"] } },
        orderBy: { deadlineAt: "asc" },
        take: 8,
        select: { id: true, title: true, deadlineAt: true, status: true },
      }),
      prisma.tender.count({ where: { organizationId: orgId, status: "WON" } }),
      prisma.tender.count({ where: { organizationId: orgId, status: "LOST" } }),
      prisma.tender.aggregate({ where: { organizationId: orgId, status: { in: ["SUBMITTED", "AWAITING_DECISION", "WON", "LOST"] } }, _sum: { estimatedValue: true } }),
      prisma.tender.groupBy({ by: ["buyerCountry"], where: active, _count: { _all: true }, orderBy: { _count: { buyerCountry: "desc" } }, take: 8 }),
      prisma.$queryRaw<Array<{ division: string; n: bigint }>>(Prisma.sql`
        SELECT LEFT(c, 2) AS division, COUNT(DISTINCT t.id) AS n
        FROM "Tender" t, unnest(t."cpvCodes") AS c
        WHERE t."organizationId" = ${orgId} AND t."duplicateOfId" IS NULL
          AND t."noticeState" IN ('ACTIVE', 'MODIFIED') AND (t."deadlineAt" IS NULL OR t."deadlineAt" >= ${now})
        GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
      prisma.$queryRaw<Array<{ week: Date; n: bigint }>>(Prisma.sql`
        SELECT date_trunc('week', "publishedAt") AS week, COUNT(*) AS n
        FROM "Tender"
        WHERE "organizationId" = ${orgId} AND "duplicateOfId" IS NULL AND "publishedAt" >= ${new Date(now.getTime() - 8 * 7 * day)}
        GROUP BY 1 ORDER BY 1`),
      prisma.tender.findMany({
        where: { ...active, preScore: { not: null } },
        orderBy: { preScore: "desc" },
        take: 6,
        select: { id: true, title: true, preScore: true, buyerName: true, deadlineAt: true },
      }),
    ]);

  return {
    kpis: {
      newCount,
      qualified,
      priority,
      preparing,
      submittedValue: Number(submittedValue._sum.estimatedValue ?? 0),
      won,
      lost,
      conversion: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null,
    },
    upcoming,
    top: recentScores,
    byCountry: byCountry.map((r) => ({ label: r.buyerCountry ?? "N.P.", value: r._count._all })),
    bySector: cpvRows.map((r) => ({ label: CPV_DIVISIONS[r.division] ?? `CPV ${r.division}`, value: Number(r.n) })),
    weekly: weekly.map((r) => ({
      label: new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(r.week),
      value: Number(r.n),
    })),
  };
}
