import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateApplicationPieces, startApplication } from "@/server/applications/application-service";
import { guardStatusChange, loadReadiness } from "@/server/applications/readiness";
import { createOrganizationWithOwner } from "@/server/auth/accounts";
import { prisma } from "@/server/db";

let orgId: string;
let userId: string;
let tenderId: string;
const DAY = 86_400_000;
const toReady = { from: "IN_PREPARATION", to: "READY_TO_SUBMIT" } as const;

beforeAll(async () => {
  const a = await createOrganizationWithOwner({ orgName: "Org Contrôle (test)", email: "controle@test.local", name: "Camille Martin", password: "MotDePasse-Test-123" });
  orgId = a.org.id;
  userId = a.user.id;
  const t = await prisma.tender.create({
    data: { organizationId: orgId, origin: "MANUAL", externalId: "ctrl-1", dedupKey: "ctrl-1", title: "Maintenance applicative", deadlineAt: new Date(Date.now() + 20 * DAY) },
  });
  tenderId = t.id;
  await startApplication(orgId, tenderId, userId);
  await generateApplicationPieces(orgId, tenderId, userId);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("contrôle « prêt à déposer »", () => {
  it("bloque un dossier incomplet avec la liste des points", async () => {
    const r = await loadReadiness(orgId, tenderId);
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.key === "pieces")?.level).toBe("blocker");
    expect(r.checks.find((c) => c.key === "memoire")?.details).toContain("Mémoire technique non créé");
    const g = await guardStatusChange(orgId, tenderId, toReady, { override: false, reason: "", isAdmin: true });
    expect(g).toMatchObject({ allowed: false });
    expect(!g.allowed && g.error).toMatch(/^Dépôt bloqué — \d+ point\(s\) à traiter : Pièces du dossier/);
  });

  it("n'accepte de dérogation que d'un administrateur, avec un motif", async () => {
    expect(await guardStatusChange(orgId, tenderId, toReady, { override: true, reason: "Déposé à part sur PLACE", isAdmin: false })).toMatchObject({ allowed: false, error: expect.stringMatching(/administrateur/) });
    expect(await guardStatusChange(orgId, tenderId, toReady, { override: true, reason: "ok", isAdmin: true })).toMatchObject({ allowed: false, error: expect.stringMatching(/Motivez/) });
    const g = await guardStatusChange(orgId, tenderId, toReady, { override: true, reason: "Pièces déposées à part sur PLACE", isAdmin: true });
    expect(g.allowed && g.overridden?.ready).toBe(false);
  });

  it("ne contrôle pas les autres transitions", async () => {
    expect(await guardStatusChange(orgId, tenderId, { from: "IN_PREPARATION", to: "IN_VALIDATION" }, { override: false, reason: "", isAdmin: false })).toEqual({ allowed: true, overridden: null });
  });

  it("autorise le passage une fois le dossier complet", async () => {
    const proposal = await prisma.proposal.create({
      data: { organizationId: orgId, tenderId, title: "Mémoire", status: "VALIDATED", sections: { create: [{ key: "solution", title: "Solution", order: 0, status: "VALIDATED", content: "Texte final." }] } },
    });
    await prisma.applicationPiece.updateMany({ where: { tenderId }, data: { status: "NOT_APPLICABLE" } });
    await prisma.applicationPiece.updateMany({ where: { tenderId, key: "memoire" }, data: { status: "DONE" } });
    let r = await loadReadiness(orgId, tenderId);
    expect(r.ready).toBe(true);

    // Un marqueur oublié dans une section validée rebloque le dépôt.
    await prisma.proposalSection.updateMany({ where: { proposalId: proposal.id }, data: { content: "Délai d'intervention de 4 h [À VALIDER]." } });
    r = await loadReadiness(orgId, tenderId);
    expect(r.checks.find((c) => c.key === "memoire")?.level).toBe("blocker");
    await prisma.proposalSection.updateMany({ where: { proposalId: proposal.id }, data: { content: "Délai d'intervention de 4 h." } });

    expect(await guardStatusChange(orgId, tenderId, toReady, { override: false, reason: "", isAdmin: false })).toEqual({ allowed: true, overridden: null });
  });
});
