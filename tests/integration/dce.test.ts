import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrganizationWithOwner } from "@/server/auth/accounts";
import { prisma } from "@/server/db";
import { DceRetrievalUnavailableError, pendingDceTenders, retrieveDce } from "@/server/dce/retrieve-service";
import { makePdf, makeZip } from "../helpers/fixtures-builders";

const html = (f: string) => readFileSync(path.join(__dirname, "..", "fixtures", "atexo", f), "utf8");
const PLACE = "https://www.marches-publics.gouv.fr/entreprise/consultation/3095827?orgAcronyme=s2d";

let orgId: string;
let tenderId: string;
let dceZip: Buffer;

/** Plateforme PLACE simulée à partir des pages réelles. */
const fakePlace: typeof fetch = async (input, init) => {
  const url = String(input);
  const file = (name: string, body: Buffer) =>
    new Response(new Uint8Array(body), { headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${name}"` } });
  if (url.includes("/entreprise/consultation/")) return new Response(html("consultation.html"), { headers: { "content-type": "text/html" } });
  if (url.includes("DownloadReglement")) return file("RC.pdf", makePdf(["Règlement de la consultation : TMA du portail. Date limite de remise des offres le 26 novembre 2026."]));
  if (url.includes("DownloadComplement")) return file("QR.pdf", makePdf(["Questions et réponses : la plateforme est développée en Symfony avec une base PostgreSQL."]));
  if (url.includes("DemandeTelechargementDce") && init?.method === "POST") return file("DCE.zip", dceZip);
  if (url.includes("DemandeTelechargementDce")) return new Response(html("demande.html"), { headers: { "content-type": "text/html" } });
  return new Response("introuvable", { status: 404 });
};

beforeAll(async () => {
  const a = await createOrganizationWithOwner({ orgName: "Org DCE (test)", email: "dce@test.local", name: "Camille Martin", password: "MotDePasse-Test-123" });
  orgId = a.org.id;
  dceZip = await makeZip({ "CCTP.pdf": makePdf(["Cahier des clauses techniques particulières : maintenance corrective et évolutive du portail Drupal 10."]) });
  const t = await prisma.tender.create({
    data: {
      organizationId: orgId, origin: "MANUAL", externalId: "dce-1", dedupKey: "dce-1", title: "TMA du portail",
      documentsUrl: PLACE, deadlineAt: new Date(Date.now() + 20 * 86_400_000),
    },
  });
  tenderId = t.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("retrait automatique des DCE", () => {
  it("refuse sans configuration et l'indique sur l'offre", async () => {
    await expect(retrieveDce(orgId, tenderId, null, fakePlace)).rejects.toBeInstanceOf(DceRetrievalUnavailableError);
    expect((await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } })).dceFetchError).toMatch(/désactivé/);
    await prisma.tender.update({ where: { id: tenderId }, data: { dceFetchError: null } });
  });

  it("retire RC, Q/R et DCE complet, puis les extrait", async () => {
    await prisma.dceRetrievalSettings.create({
      data: {
        organizationId: orgId, mode: "IDENTIFIED", autoRetrieve: true, termsAcceptedAt: new Date(),
        firstName: "Camille", lastName: "Martin", email: "ao@example.fr", phone: "0140506070", legalName: "Agence Exemple",
        siret: "12345678900012", address: "1 rue de la Paix", postalCode: "75002", city: "Paris",
      },
    });
    expect(await pendingDceTenders(orgId)).toEqual([tenderId]);

    const outcome = await retrieveDce(orgId, tenderId, null, fakePlace);
    expect(outcome.warnings).toEqual([]);
    expect(outcome.imported).toEqual(["RC.pdf", "QR.pdf", "DCE.zip"]);

    const docs = await prisma.tenderDocument.findMany({ where: { tenderId }, orderBy: { createdAt: "asc" } });
    expect(docs.map((d) => d.filename).sort()).toEqual(["CCTP.pdf", "DCE.zip", "QR.pdf", "RC.pdf"]);
    expect(docs.every((d) => d.status === "EXTRACTED")).toBe(true);
    expect(docs.find((d) => d.filename === "RC.pdf")?.kind).toBe("RC");
    expect(docs.find((d) => d.filename === "CCTP.pdf")?.kind).toBe("CCTP");
    expect(docs.find((d) => d.filename === "CCTP.pdf")?.parentId).toBe(docs.find((d) => d.filename === "DCE.zip")?.id);

    const t = await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });
    expect(t.dceFetchedAt).not.toBeNull();
    expect(t.dceFetchError).toBeNull();
    // Retiré : n'est plus en attente ; un second retrait ne réimporte rien.
    expect(await pendingDceTenders(orgId)).toEqual([]);
    expect((await retrieveDce(orgId, tenderId, null, fakePlace)).duplicates).toHaveLength(3);
  });
});
