/**
 * PostgreSQL local de développement SANS Docker (binaire embarqué, données dans
 * ./.data/postgres). Lit DATABASE_URL pour l'utilisateur, le mot de passe, le
 * port et la base. pgvector n'y est pas disponible : les migrations le tolèrent.
 * Usage : `pnpm db:dev` (laisser tourner), puis `pnpm db:migrate`.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const url = new URL(process.env.DATABASE_URL ?? "");
const dir = path.resolve(".data/postgres");
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  port: Number(url.port || 5432),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

async function main() {
  const fresh = !existsSync(path.join(dir, "PG_VERSION"));
  if (fresh) await pg.initialise();
  await pg.start();
  const db = url.pathname.slice(1);
  if (fresh) await pg.createDatabase(db);
  console.log(`PostgreSQL prêt sur le port ${url.port} (base « ${db} »). Ctrl+C pour arrêter.`);
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
