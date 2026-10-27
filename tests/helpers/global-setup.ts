import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Tests d'intégration : base PostgreSQL réelle.
 * - Si TEST_DATABASE_URL est défini (CI, Docker), on l'utilise.
 * - Sinon on démarre un PostgreSQL embarqué éphémère (sans pgvector, ce que les
 *   migrations tolèrent).
 */
export default async function setup(project: TestProject) {
  let pg: EmbeddedPostgres | undefined;
  let dir: string | undefined;
  let url = process.env.TEST_DATABASE_URL;

  if (!url) {
    dir = mkdtempSync(path.join(tmpdir(), "tp-pg-"));
    const port = 55432;
    pg = new EmbeddedPostgres({ databaseDir: dir, port, user: "test", password: "test", persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {} });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("tenderpilot_test");
    url = `postgresql://test:test@localhost:${port}/tenderpilot_test?schema=public`;
  }

  const teardown = async () => {
    if (pg) await pg.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  };
  try {
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  } catch (err) {
    await teardown();
    const e = err as { stderr?: Buffer };
    throw new Error(`Échec des migrations : ${e.stderr?.toString() ?? String(err)}`);
  }
  project.provide("databaseUrl", url);
  return teardown;
}
