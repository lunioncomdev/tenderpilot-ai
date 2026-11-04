import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createOrganizationWithOwner } from "@/server/auth/accounts";
import { aiStatus, resolveAiConfig } from "@/server/ai/gateway";
import { encryptSecret } from "@/server/dce/secrets";
import { resetEnvCache } from "@/server/env";

let orgId: string;

beforeAll(async () => {
  const a = await createOrganizationWithOwner({ orgName: "Org IA (test)", email: "ia@test.local", name: "Alex IA", password: "MotDePasse-Test-123" });
  orgId = a.org.id;
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_MODEL;
  process.env.AI_ENABLED = "false";
  resetEnvCache();
});

describe("paramètres IA de l'organisation", () => {
  it("retombe sur les variables d'environnement sans réglage enregistré", async () => {
    process.env.OPENAI_API_KEY = "sk-env-0123456789abcdef";
    process.env.AI_MODEL = "gpt-5";
    resetEnvCache();
    const cfg = await resolveAiConfig(orgId);
    expect(cfg).toMatchObject({ provider: "openai", model: "gpt-5", apiKey: "sk-env-0123456789abcdef", keySource: "env" });
  });

  it("utilise la clé chiffrée et le modèle de l'organisation en priorité", async () => {
    process.env.OPENAI_API_KEY = "sk-env-0123456789abcdef";
    process.env.AI_ENABLED = "true";
    resetEnvCache();
    await prisma.organization.update({ where: { id: orgId }, data: { openaiApiKeyEnc: encryptSecret("sk-org-0123456789abcdef"), aiModel: "gpt-5.5-mini" } });
    const cfg = await resolveAiConfig(orgId);
    expect(cfg).toMatchObject({ model: "gpt-5.5-mini", apiKey: "sk-org-0123456789abcdef", keySource: "organization" });
    expect(await aiStatus(orgId)).toMatchObject({ enabled: true, model: "gpt-5.5-mini", keySource: "organization" });
  });

  it("signale l'absence de clé", async () => {
    process.env.AI_ENABLED = "true";
    resetEnvCache();
    await prisma.organization.update({ where: { id: orgId }, data: { openaiApiKeyEnc: null, aiModel: null } });
    const st = await aiStatus(orgId);
    expect(st.enabled).toBe(false);
    expect(st.reason).toMatch(/Clé API OpenAI absente/);
  });
});
