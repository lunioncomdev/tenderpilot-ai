import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateApplicationPieces, startApplication } from "@/server/applications/application-service";
import { buildDossierZip, buildFormDocx } from "@/server/applications/dossier-export";
import { deletePieceFile, savePieceFile } from "@/server/applications/piece-files";
import { createOrganizationWithOwner } from "@/server/auth/accounts";
import { saveCompanyDocument } from "@/server/company/company-document-service";
import { prisma } from "@/server/db";
import { UploadRejectedError } from "@/server/documents/document-service";
import { storage } from "@/server/documents/storage";
import { makePdf } from "../helpers/fixtures-builders";

let orgId: string;
let userId: string;
let tenderId: string;
const DAY = 86_400_000;

beforeAll(async () => {
  const a = await createOrganizationWithOwner({ orgName: "Org Dossier (test)", email: "dossier@test.local", name: "Camille Martin", password: "MotDePasse-Test-123" });
  orgId = a.org.id;
  userId = a.user.id;
  await prisma.companyProfile.upsert({
    where: { organizationId: orgId },
    create: { organizationId: orgId, legalName: "Agence Exemple", siren: "12345678900012", legalForm: "SAS", address: "1 rue de la Paix", postalCode: "75002", city: "Paris", legalRepName: "Camille Martin", legalRepTitle: "Présidente" },
    update: { legalName: "Agence Exemple", siren: "12345678900012", legalForm: "SAS", address: "1 rue de la Paix", postalCode: "75002", city: "Paris", legalRepName: "Camille Martin", legalRepTitle: "Présidente" },
  });
  const t = await prisma.tender.create({
    data: {
      organizationId: orgId, origin: "MANUAL", externalId: "dossier-1", publicationRef: "26-123456", dedupKey: "dossier-1",
      title: "Refonte du portail", buyerName: "Ville de Lyon", deadlineAt: new Date(Date.now() + 30 * DAY),
    },
  });
  tenderId = t.id;
  await startApplication(orgId, tenderId, userId);
  await generateApplicationPieces(orgId, tenderId, userId);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("dossier de candidature", () => {
  it("joint un fichier à une pièce et la passe « En cours »", async () => {
    const ae = await prisma.applicationPiece.findFirstOrThrow({ where: { tenderId, key: "ae" } });
    const f = await savePieceFile({ orgId, userId, pieceId: ae.id, filename: "AE signé.pdf", data: makePdf(["Acte d'engagement signé"]) });
    expect(f.mimeType).toBe("application/pdf");
    expect((await prisma.applicationPiece.findUniqueOrThrow({ where: { id: ae.id } })).status).toBe("IN_PROGRESS");
  });

  it("refuse un format non autorisé et les pièces d'une autre organisation", async () => {
    const ae = await prisma.applicationPiece.findFirstOrThrow({ where: { tenderId, key: "ae" } });
    await expect(savePieceFile({ orgId, userId, pieceId: ae.id, filename: "script.pdf", data: Buffer.from("#!/bin/sh\necho") })).rejects.toBeInstanceOf(UploadRejectedError);
    const other = await createOrganizationWithOwner({ orgName: "Autre org", email: "autre-dossier@test.local", name: "X", password: "MotDePasse-Test-123" });
    await expect(savePieceFile({ orgId: other.org.id, userId: other.user.id, pieceId: ae.id, filename: "a.pdf", data: makePdf(["x"]) })).rejects.toThrow(/introuvable/);
  });

  it("exporte un ZIP rangé avec sommaire, pièces jointes, pièces du profil et DC1/DC2", async () => {
    await saveCompanyDocument({ orgId, userId, type: "KBIS", filename: "kbis.pdf", data: makePdf(["Extrait Kbis"]), issuedAt: new Date(), validUntil: new Date(Date.now() + 80 * DAY) });
    await saveCompanyDocument({ orgId, userId, type: "URSSAF", filename: "urssaf.pdf", data: makePdf(["URSSAF"]), issuedAt: null, validUntil: new Date(Date.now() + 10 * DAY) });

    const { buf, filename, plan } = await buildDossierZip(orgId, tenderId, "Org");
    expect(filename).toBe("Dossier_26_123456.zip");
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    expect(names).toContain("00_Sommaire.txt");
    expect(names.some((n) => /^01_Candidature\/\d\d_Lettre_de_candidature_DC1_ou_DUME\.docx$/.test(n))).toBe(true);
    expect(names.some((n) => /^01_Candidature\/\d\d_Declaration_du_candidat_DC2\.docx$/.test(n))).toBe(true);
    expect(names.some((n) => /^01_Candidature\/\d\d_Extrait_Kbis_de_moins_de_3_mois\.pdf$/.test(n))).toBe(true);
    expect(names.some((n) => /^02_Offre\/\d\d_Acte_d_engagement_complete_et_signe\.pdf$/.test(n))).toBe(true);
    // L'attestation URSSAF expire avant la date limite : exclue et signalée.
    expect(names.some((n) => n.includes("Attestations_de_regularite"))).toBe(false);
    const sommaire = await zip.file("00_Sommaire.txt")!.async("string");
    expect(sommaire).toContain("expire avant la date limite");
    expect(sommaire).toContain("Ville de Lyon");
    expect(plan.summary.every((s) => s.status !== "NOT_APPLICABLE")).toBe(true);

    const dc1 = await zip.file(names.find((n) => n.includes("DC1"))!)!.async("nodebuffer");
    const xml = await (await JSZip.loadAsync(dc1)).file("word/document.xml")!.async("string");
    expect(xml).toContain("Agence Exemple");
    expect(xml).toContain("Camille Martin, Présidente");
  });

  it("génère le DC1 seul et compte les champs à compléter", async () => {
    const { filename, todos } = await buildFormDocx(orgId, tenderId, "dc1", "Org");
    expect(filename).toBe("DC1_26_123456.docx");
    expect(todos).toBeGreaterThan(0); // NAF, TVA, téléphone… non renseignés
  });

  it("retire un fichier joint et le supprime du stockage", async () => {
    const f = await prisma.applicationPieceFile.findFirstOrThrow({ where: { organizationId: orgId } });
    await deletePieceFile(orgId, f.id, userId);
    expect(await prisma.applicationPieceFile.count({ where: { id: f.id } })).toBe(0);
    await expect(storage().get(f.storageKey)).rejects.toThrow();
  });
});
