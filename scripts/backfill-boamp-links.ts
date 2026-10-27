/**
 * Renseigne le lien du dossier de consultation des avis BOAMP déjà synchronisés
 * qui n'en ont pas (formats FNSimple / MAPA ajoutés après coup).
 * Usage : `pnpm tsx scripts/backfill-boamp-links.ts`
 */
import { normalizeBoampRecord, type BoampRecord } from "@/server/connectors/boamp";
import { ThrottledHttp } from "@/server/connectors/http";
import { prisma } from "@/server/db";
import { env } from "@/server/env";

async function main() {
  const missing = await prisma.tender.findMany({ where: { origin: "BOAMP", documentsUrl: null }, select: { id: true, externalId: true } });
  console.log(`${missing.length} avis BOAMP sans lien de dossier de consultation`);
  const http = new ThrottledHttp({ minIntervalMs: 1000 });
  let updated = 0;
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    const ids = batch.map((t) => `"${t.externalId.replace(/"/g, "")}"`).join(",");
    const params = new URLSearchParams({ where: `idweb IN (${ids})`, limit: "100" });
    const page = await http.json<{ results: BoampRecord[] }>(`${env().BOAMP_BASE_URL}/records?${params}`);
    for (const r of page.results) {
      const url = normalizeBoampRecord(r).documentsUrl;
      if (!url) continue;
      const res = await prisma.tender.updateMany({ where: { origin: "BOAMP", externalId: r.idweb, documentsUrl: null }, data: { documentsUrl: url } });
      updated += res.count;
    }
  }
  console.log(`${updated} lien(s) ajouté(s)`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
