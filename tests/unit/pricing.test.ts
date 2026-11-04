import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { planDossier } from "@/server/applications/dossier-export";
import { formatRatesText, linePrice, parseDecimal, parseRates, parseRatesText, pricingTotals, type PriceableLine } from "@/server/pricing/compute";
import { analyzeTemplate, classifyHeader, fillTemplate } from "@/server/pricing/template";

const rates = [{ profile: "Chef de projet", rate: 750 }, { profile: "Développeur", rate: 550 }];

describe("moteur de chiffrage", () => {
  it("lit la grille de TJM saisie en texte", () => {
    const { rates: r, errors } = parseRatesText("Chef de projet : 750\nDéveloppeur = 550 € HT / jour\nExpert sécurité; 1 100,50\n\nn'importe quoi");
    expect(r).toEqual({ "Chef de projet": 750, "Développeur": 550, "Expert sécurité": 1100.5 });
    expect(errors).toEqual(["n'importe quoi"]);
    expect(formatRatesText(r)).toBe("Chef de projet : 750\nDéveloppeur : 550\nExpert sécurité : 1100.5");
    expect(parseRates({ a: 100, b: "x", c: -1, " ": 5 })).toEqual([{ profile: "a", rate: 100 }]);
  });

  it("calcule PU = Σ jours × TJM, ajusté, et le montant", () => {
    const p = linePrice({ isHeading: false, quantity: 3, manualPrice: null, days: { "Chef de projet": 1, "Développeur": 4 } }, rates, -10);
    expect(p).toEqual({ unitPrice: 2655, amount: 7965, source: "computed", unknownProfiles: [] });
  });

  it("donne la priorité au prix saisi, sans ajustement", () => {
    const p = linePrice({ isHeading: false, quantity: null, manualPrice: 1234.567, days: { "Développeur": 4 } }, rates, -10);
    expect(p).toMatchObject({ unitPrice: 1234.57, amount: null, source: "manual" });
  });

  it("signale les profils absents de la grille et totalise", () => {
    const lines: PriceableLine[] = [
      { isHeading: true, quantity: null, manualPrice: null, days: {} },
      { isHeading: false, quantity: 2, manualPrice: null, days: { "Développeur": 1, "Stagiaire": 3 } },
      { isHeading: false, quantity: 1, manualPrice: 500, days: {} },
      { isHeading: false, quantity: 1, manualPrice: null, days: {} },
    ];
    expect(linePrice(lines[1], rates, 0).unknownProfiles).toEqual(["Stagiaire"]);
    expect(pricingTotals(lines, rates, 0)).toEqual({ lines: 3, priced: 2, totalHt: 1600, daysByProfile: { "Développeur": 2, "Stagiaire": 6 } });
  });

  it("lit les nombres saisis à la française", () => {
    expect(parseDecimal("1 200,50")).toBe(1200.5);
    expect(parseDecimal("12 €")).toBe(12);
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
  });
});

describe("en-têtes de bordereau", () => {
  it.each([
    ["Prix unitaire HT (€)", "unitPrice"], ["P.U. HT", "unitPrice"], ["Prix HT", "unitPrice"], ["Montant total HT", "amount"],
    ["Prix total", "amount"], ["Qté", "quantity"], ["Quantité estimative", "quantity"], ["Unité", "unit"], ["U", "unit"],
    ["Désignation des prestations", "designation"], ["Libellé", "designation"], ["N° prix", "reference"], ["Code", "reference"], ["Observations", null],
  ])("« %s » → %s", (h, role) => expect(classifyHeader(h)).toBe(role));
});

async function dpgf() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("DPGF");
  ws.addRow(["Ville de Lyon — Refonte du portail"]);
  ws.addRow([]);
  ws.addRow(["N°", "Désignation", "Unité", "Quantité", "Prix unitaire HT", "Montant HT"]);
  ws.addRow(["1", "Conception"]);
  ws.addRow(["1.1", "Ateliers de cadrage", "jour", 5, null, { formula: "D5*E5" }]);
  ws.addRow(["1.2", "Maquettes", "forfait", 1, null, null]);
  ws.addRow(["1.3", "Hébergement de recette", "mois", 6, "Inclus", null]);
  ws.addRow(["1.4", "Recette (calculée)", "forfait", 1, { formula: "E5*2" }, null]);
  ws.addRow(["", "Total HT", "", "", "", { formula: "SUM(F5:F8)" }]);
  ws.addRow(["", "TVA 20 %", "", "", "", { formula: "F9*0.2" }]);
  const hidden = wb.addWorksheet("Paramètres");
  hidden.state = "hidden";
  hidden.addRow(["Désignation", "Prix"]);
  hidden.addRow(["x", null]);
  const notes = wb.addWorksheet("Notice");
  notes.addRow(["Remplir uniquement les cellules jaunes."]);
  return wb;
}

describe("analyse d'un bordereau", () => {
  it("repère l'en-tête, les titres, les lignes à chiffrer, et ignore totaux, formules et textes", async () => {
    const { lines, warnings } = analyzeTemplate(await dpgf());
    expect(lines.map((l) => [l.row, l.isHeading, l.designation, l.priceCell, l.amountCell, l.quantity])).toEqual([
      [4, true, "Conception", null, null, null],
      [5, false, "Ateliers de cadrage", "E5", null, 5],
      [6, false, "Maquettes", "E6", "F6", 1],
    ]);
    expect(warnings).toEqual([
      "Feuille « DPGF » : 1 ligne(s) calculée(s) par formule, non modifiées.",
      "Feuille « DPGF » : 1 ligne(s) avec un texte en guise de prix (« inclus »…), non modifiées.",
      "Feuille « Notice » : colonnes « désignation » et « prix » non reconnues — ignorée.",
    ]);
  });

  it("gère un en-tête sur deux lignes et une DPGF au forfait (montant seul)", () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Lot 1");
    ws.addRow(["Poste", "Désignation", "Prix"]);
    ws.addRow(["", "", "global et forfaitaire HT"]);
    ws.addRow(["A", "Développement du site", null]);
    ws.addRow(["B", "Formation", 1500]);
    const { lines } = analyzeTemplate(wb);
    expect(lines.map((l) => [l.reference, l.designation, l.priceCell, l.quantity, l.existingPrice])).toEqual([
      ["A", "Développement du site", "C3", 1, null],
      ["B", "Formation", "C4", 1, 1500],
    ]);
  });

  it("remplit les cellules de prix sans toucher aux formules ni aux textes", async () => {
    const wb = await dpgf();
    const { lines } = analyzeTemplate(wb);
    const res = fillTemplate(wb, [
      { sheet: "DPGF", priceCell: "E5", amountCell: null, unitPrice: 650, amount: 3250 },
      { sheet: "DPGF", priceCell: "E6", amountCell: "F6", unitPrice: 4000, amount: 4000 },
      { sheet: "DPGF", priceCell: "E7", amountCell: null, unitPrice: 1, amount: null }, // « Inclus » : protégé
    ]);
    expect(lines).toHaveLength(3);
    expect(res).toEqual({ written: 2, skipped: 1 });
    const out = new ExcelJS.Workbook();
    await out.xlsx.load(await wb.xlsx.writeBuffer());
    const ws = out.getWorksheet("DPGF")!;
    expect(ws.getCell("E5").value).toBe(650);
    expect(ws.getCell("F5").value).toMatchObject({ formula: "D5*E5" });
    expect(ws.getCell("F6").value).toBe(4000);
    expect(ws.getCell("E7").value).toBe("Inclus");
    expect(ws.getCell("E8").value).toMatchObject({ formula: "E5*2" });
    expect(ws.getCell("F9").value).toMatchObject({ formula: "SUM(F5:F8)" });
    expect(out.getWorksheet("Paramètres")!.state).toBe("hidden");
  });
});

describe("chiffrage dans le dossier", () => {
  it("joint le bordereau rempli à l'offre financière et signale les lignes non chiffrées", () => {
    const plan = planDossier({
      pieces: [{ key: "prix", group: "OFFRE", label: "Offre financière (BPU / DPGF / DQE)", detail: "", status: "IN_PROGRESS", lotId: null, files: [] }],
      companyDocs: [], deadline: null, proposals: [],
      pricings: [{ id: "p1", filename: "DPGF lot 1.xlsx", lotId: null, priced: 10, missing: 2 }, { id: "p2", filename: "vide.xlsx", lotId: null, priced: 0, missing: 5 }],
    });
    expect(plan.entries).toEqual([{ path: "02_Offre/01_Offre_financiere_BPU_DPGF_DQE.xlsx", source: { kind: "pricing", pricingId: "p1" } }]);
    expect(plan.summary[0].issues).toContain("DPGF lot 1.xlsx : 2 ligne(s) non chiffrée(s)");
  });
});
