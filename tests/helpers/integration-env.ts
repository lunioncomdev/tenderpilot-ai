import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inject } from "vitest";

process.env.DATABASE_URL = inject("databaseUrl");

// Variables minimales pour les services testés (aucun secret réel).
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_LOCAL_DIR = mkdtempSync(path.join(tmpdir(), "tp-storage-"));
process.env.AI_ENABLED = "false";
process.env.REDIS_URL ??= "redis://127.0.0.1:6399"; // volontairement injoignable : rate limit en fail-open
process.env.LOG_LEVEL = "silent";
