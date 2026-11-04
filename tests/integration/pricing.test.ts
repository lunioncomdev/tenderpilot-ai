import ExcelJS from "exceljs";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateApplicationPieces, startApplication } from "@/server/applications/application-service";
import { buildDossierZip } from "@/server/applications/dossier-export";
import { createOrganizationWithOwner } from "@/server/auth/accounts";
import { prisma } from "@/server/db";
import { registerDocument } from "@/server/documents/document-service";
import { exportFilledTemplate, loadPricing, preparePricing, PricingTemplateError, priceTemplates, savePricingEntries } from "@/server/pricing/pricing-service";

let orgId: string;
let userId: string;
let tenderId: string;
let documentId: string;
let pricingId: string;

async function dpgfXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("DPGF");
  ws.addRow(["N°", "Désignation", "Unité", "Quantité", "Prix unitaire HT", "Montant HT"]);
  ws.addRow(["1", "Ateliers de cadrage", "jour", 5, null, { formula: "D2*E2" }]);
  ws.addRow(["2", "Développement du back-office", "forfait", 1, null, { formula: "D3*E3" }]);
  ws.addRow(["3", "Formation des agents", "session", 2, null, { formula: "D4*E4" }]);
  ws.addRow(["", "Total HT", "", "", "", { formula: "SUM(F2:F4)" }]);
  ws.getCell("E2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

beforeAll(async () => {
  const a = await createOrganizationWithOwner({ orgName: "Org Chiffrage (test)", email: "chiffrage@test.local", name: "Camille Martin", password: "MotDePasse-Test-123" });
  orgId = a.org.id;
  userId = a.user.id;
  await prisma.companyProfile.upsert({
    where: { organizationId: orgId },
    create: { organizationId: orgId, legalName: "Agence Exemple", dailyRates: { "Chef de projet": 800, "Développeur": 600 } },
    update: { dailyRates: { "Chef de projet": 800, "Développeur": 600 } },
  });
  const t = await prisma.tender.create({
    data: { organizationId: orgId, origin: "MANUAL", externalId: "chiffrage-1", dedupKey: "chiffrage-1", title: "Refonte du back-office", deadlineAt: new Date(Date.now() + 30 * 86_400_000) },
  });
  tenderId = t.id;
  const { document } = await registerDocument({ orgId, tenderId, filename: "DPGF.xlsx", data: await dpgfXlsx(), userId });
  documentId = document.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("chiffrage BPU / DPGF", () => {
  it("propose le DPGF du DCE comme bordereau et en extrait les lignes", async () => {
    const templates = await priceTemplates(orgId, tenderId);
    expect(templates.map((d) => [d.filename, d.kind])).toEqual([["DPGF.xlsx", "DPGF"]]);
    const { pricing, lines } = await preparePricing(orgId, tenderId, documentId, userId);
    pricingId = pricing.id;
    expect(lines).toBe(3);
  });

  it("refuse un document qui n'est pas un classeur", async () => {
    const { document } = await registerDocument({ orgId, tenderId, filename: "notes.txt", data: Buffer.from("Prix : à définir"), userId });
    await expect(preparePricing(orgId, tenderId, document.id, userId)).rejects.toBeInstanceOf(PricingTemplateError);
  });

  it("chiffre en jours × TJM avec ajustement, ou par prix saisi", async () => {
    const before = await loadPricing(orgId, pricingId);
    const [ateliers, dev, formation] = before.lines;
    await savePricingEntries(orgId, pricingId, userId, {
      adjustmentPercent: -5,
      profiles: ["Chef de projet", "Développeur"],
      lines: [
        { id: ateliers.id, manualPrice: null, days: { "Chef de projet": 1 }, note: "" },
        { id: dev.id, manualPrice: null, days: { "Chef de projet": 5, "Développeur": 20 }, note: "" },
        { id: formation.id, manualPrice: 900, days: {}, note: "" },
      ],
    });
    const { lines, totals } = await loadPricing(orgId, pricingId);
    expect(lines.map((l) => l.price.unitPrice)).toEqual([760, 15200, 900]);
    expect(totals).toMatchObject({ lines: 3, priced: 3, totalHt: 760 * 5 + 15200 + 1800 });
  });

  it("conserve les saisies quand on relit le bordereau", async () => {
    await preparePricing(orgId, tenderId, documentId, userId);
    const { lines } = await loadPricing(orgId, pricingId);
    expect(lines.map((l) => l.price.unitPrice)).toEqual([760, 15200, 900]);
  });

  it("remplit le modèle d'origine en conservant formules et mise en forme", async () => {
    const out = await exportFilledTemplate(orgId, pricingId);
    expect(out).toMatchObject({ filename: "DPGF_complete.xlsx", written: 3, skipped: 0, missing: 0 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out.buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("DPGF")!;
    expect([ws.getCell("E2").value, ws.getCell("E3").value, ws.getCell("E4").value]).toEqual([760, 15200, 900]);
    expect(ws.getCell("F2").value).toMatchObject({ formula: "D2*E2" });
    expect(ws.getCell("F5").value).toMatchObject({ formula: "SUM(F2:F4)" });
    expect(ws.getCell("E2").fill).toMatchObject({ pattern: "solid" });
    // Excel recalcule les montants à l'ouverture (ExcelJS écrit l'option sans la relire).
    const workbookXml = await (await JSZip.loadAsync(out.buf)).file("xl/workbook.xml")!.async("string");
    expect(workbookXml).toMatch(/<calcPr[^>]*fullCalcOnLoad="1"/);
  });

  it("joint le bordereau rempli à l'offre financière du dossier", async () => {
    await startApplication(orgId, tenderId, userId);
    await generateApplicationPieces(orgId, tenderId, userId);
    const { buf } = await buildDossierZip(orgId, tenderId, "Org");
    const zip = await JSZip.loadAsync(buf);
    const name = Object.keys(zip.files).find((n) => /^02_Offre\/\d\d_Offre_financiere_BPU_DPGF_DQE\.xlsx$/.test(n));
    expect(name).toBeDefined();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await zip.file(name!)!.async("nodebuffer")) as unknown as ArrayBuffer);
    expect(wb.getWorksheet("DPGF")!.getCell("E3").value).toBe(15200);
    expect(await zip.file("00_Sommaire.txt")!.async("string")).toContain("DPGF.xlsx : rempli depuis le chiffrage");
  });
});
