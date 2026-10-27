/**
 * Synchronisation immédiate, sans file de tâches (utile en développement ou en
 * dépannage) : `pnpm sync [BOAMP|TED]`.
 */
import { prisma } from "@/server/db";
import { runSync } from "@/server/sync/sync-service";
import type { SourceKey } from "@prisma/client";

async function main() {
  const only = process.argv[2]?.toUpperCase() as SourceKey | undefined;
  const configs = await prisma.sourceConfig.findMany({ where: { enabled: true, ...(only ? { source: only } : {}) } });
  if (!configs.length) console.log("Aucune source active.");
  for (const c of configs) {
    console.log(`→ ${c.source} (org ${c.organizationId})…`);
    const run = await runSync(c.organizationId, c.source, { trigger: "manual" });
    console.log(`  ${run.status} : ${run.fetched} reçus, ${run.created} créés, ${run.updated} mis à jour, ${run.duplicates} doublons`);
    const errors = run.errors as Array<{ message: string }>;
    if (errors.length) console.log(`  erreurs : ${errors.slice(0, 3).map((e) => e.message).join(" | ")}`);
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
