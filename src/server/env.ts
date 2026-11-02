import { z } from "zod/v4";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET doit contenir au moins 32 caractères"),
  COOKIE_SECURE: bool,

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("tenderpilot"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
  UPLOAD_MAX_MB: z.coerce.number().int().positive().default(50),

  AI_ENABLED: bool,
  AI_PROVIDER: z.enum(["openai", "anthropic"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("gpt-5.5"),
  AI_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
  AI_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(200),
  AI_MAX_DCE_TOKENS: z.coerce.number().int().positive().default(400_000),

  SYNC_CRON: z.string().default("0 */6 * * *"),
  BOAMP_BASE_URL: z
    .string()
    .default("https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp"),
  TED_BASE_URL: z.string().default("https://api.ted.europa.eu/v3"),
  APPROCH_BASE_URL: z
    .string()
    .default("https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/projets-dachats-publics"),
  LOG_LEVEL: z.enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Configuration invalide :\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Réservé aux tests. */
export function resetEnvCache() {
  cached = undefined;
}
