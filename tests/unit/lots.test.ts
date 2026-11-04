import { describe, expect, it } from "vitest";
import { dossierSummaryText, planDossier, type DossierPiece } from "@/server/applications/dossier-export";
import { dc1Content, type FormContext } from "@/server/applications/forms-docx";
import { compareLotNumbers, guessLotNumber, normalizeLotNumber, proposalMove, reconcilePieces, visiblePieces } from "@/server/applications/lots";
import { planApplicationPieces } from "@/server/applications/pieces";

describe("numéros de lot", () => {
  it.each([["1", "1"], ["Lot 02", "2"], ["Lot n° 3", "3"], ["lot no 10 - TMA", "10"], ["A", "A"], ["Lot B", "B"]])("« %s » → %s", (raw, n) => {
    expect(normalizeLotNumber(raw)).toBe(n);
  });

  it("devine le lot d'après le nom du fichier", () => {
    expect(guessLotNumber("DPGF_Lot2.xlsx")).toBe("2");
    expect(guessLotNumber("BPU lot n°03.xlsx")).toBe("3");
    expect(guessLotNumber("BPU-LOT-10.xlsx")).toBe("10");
    expect(guessLotNumber("pilote.xlsx")).toBeNull();
    expect(guessLotNumber("DPGF.xlsx")).toBeNull();
  });

  it("trie dans l'ordre naturel", () => {
    expect(["10", "B", "2", "1", "A"].sort(compareLotNumbers)).toEqual(["1", "2", "10", "A", "B"]);
  });
});

const p = (id: string, key: string, lotId: string | null = null) => ({ id, key, lotId });

describe("pièces à fournir selon les lots retenus", () => {
  const pieces = [p("c1", "kbis"), p("o1", "ae"), p("o2", "rib"), p("l1", "ae", "L1"), p("l2", "ae", "L2"), p("x", "custom-1", "L2")];

  it("sans lot retenu : uniquement les pièces communes", () => {
    expect(visiblePieces(pieces, []).map((x) => x.id)).toEqual(["c1", "o1", "o2"]);
  });

  it("avec des lots : pièces des lots retenus et pièces communes non déclinées par lot", () => {
    expect(visiblePieces(pieces, ["L2"]).map((x) => x.id)).toEqual(["c1", "o2", "l2", "x"]);
  });
});

describe("réconciliation des pièces", () => {
  const planned = planApplicationPieces(null);
  const keys = planned.map((x) => x.key);
  const L1 = { id: "L1", selected: true };
  const L2 = { id: "L2", selected: true };

  it("sans lot : une pièce par clé, créée une seule fois", () => {
    const first = reconcilePieces(planned, [], []);
    expect(first.creates.map((c) => [c.key, c.lotId])).toEqual(keys.map((k) => [k, null]));
    const again = reconcilePieces(planned, first.creates.map((c, i) => ({ id: `p${i}`, key: c.key, lotId: null })), []);
    expect(again.creates).toEqual([]);
    expect(again.updates).toHaveLength(keys.length);
  });

  it("décline les pièces de l'offre par lot retenu et déplace la pièce déjà travaillée vers le 1er lot", () => {
    const existing = keys.map((k, i) => ({ id: `p${i}`, key: k, lotId: null }));
    const ops = reconcilePieces(planned, existing, [L1, L2, { id: "L3", selected: false }]);
    const aeId = existing.find((e) => e.key === "ae")!.id;
    expect(ops.updates.find((u) => u.id === aeId)?.data.lotId).toBe("L1");
    expect(ops.creates.map((c) => `${c.key}@${c.lotId}`).sort()).toEqual(["ae@L2", "cahiers@L2", "memoire@L2", "prix@L2"]);
    // Les pièces communes restent communes.
    expect(ops.updates.find((u) => u.id === existing.find((e) => e.key === "kbis")!.id)?.data.lotId).toBeNull();
  });

  it("revient à une pièce commune à partir du lot écarté, sans perte", () => {
    const existing = [...keys.filter((k) => !["ae", "prix", "memoire", "cahiers"].includes(k)).map((k) => p(k, k)), p("ae-L1", "ae", "L1"), p("ae-L2", "ae", "L2")];
    const ops = reconcilePieces(planned, existing, [{ id: "L1", selected: false }, { id: "L2", selected: false }]);
    expect(ops.updates.find((u) => u.id === "ae-L1")?.data.lotId).toBeNull();
    expect(ops.updates.some((u) => u.id === "ae-L2")).toBe(false);
    expect(ops.creates.map((c) => c.key).sort()).toEqual(["cahiers", "memoire", "prix"]);
  });
});

describe("mémoire et lots", () => {
  it("rattache le mémoire commun au premier lot retenu, et inversement", () => {
    expect(proposalMove([{ id: "m", lotId: null }], [{ id: "L1", selected: true }])).toEqual({ id: "m", lotId: "L1" });
    expect(proposalMove([{ id: "m", lotId: "L1" }], [{ id: "L1", selected: true }])).toBeNull();
    expect(proposalMove([{ id: "m", lotId: "L2" }], [{ id: "L1", selected: false }, { id: "L2", selected: false }])).toEqual({ id: "m", lotId: null });
    expect(proposalMove([{ id: "m", lotId: null }, { id: "n", lotId: "L1" }], [{ id: "L1", selected: false }])).toBeNull();
  });
});

describe("dossier alloti", () => {
  const piece = (key: string, group: DossierPiece["group"], label: string, lotId: string | null = null): DossierPiece => ({ key, group, label, detail: "", status: "DONE", lotId, files: [] });
  const lots = [{ id: "L1", number: "1", title: "Développement" }, { id: "L2", number: "2", title: "TMA" }];

  it("range l'offre de chaque lot dans son dossier, avec son mémoire et son bordereau", () => {
    const plan = planDossier({
      pieces: [piece("dc1", "CANDIDATURE", "DC1"), piece("rib", "OFFRE", "RIB"), piece("memoire", "OFFRE", "Mémoire", "L2"), piece("prix", "OFFRE", "Offre financière", "L1"), piece("prix", "OFFRE", "Offre financière", "L2"), piece("memoire", "OFFRE", "Mémoire", "L1")],
      companyDocs: [], deadline: null, lots,
      proposals: [{ id: "m2", lotId: "L2" }],
      pricings: [{ id: "b1", filename: "DPGF lot 1.xlsx", lotId: "L1", priced: 3, missing: 0 }, { id: "b0", filename: "BPU.xlsx", lotId: null, priced: 2, missing: 0 }],
    });
    expect(plan.entries.map((e) => e.path)).toEqual([
      "01_Candidature/01_DC1.docx",
      "02_Offre/Lot_1_Developpement/01_Offre_financiere.xlsx",
      "02_Offre/Lot_2_TMA/01_Memoire.docx",
    ]);
    expect(plan.entries[2].source).toEqual({ kind: "memoire", proposalId: "m2" });
    const lot1Memoire = plan.summary.find((s) => s.lotId === "L1" && s.label === "Mémoire")!;
    expect(lot1Memoire.issues).toContain("mémoire technique du lot non créé");
    expect(plan.summary.find((s) => s.lotId === "L2" && s.label === "Offre financière")!.issues).toContain("BPU.xlsx : bordereau non rattaché à un lot retenu — non inclus");
    expect(plan.summary.find((s) => s.label === "RIB")!.folder).toBe("02_Offre");
    const text = dossierSummaryText({ title: "T", buyer: "B", reference: "R", deadline: null, companyName: "C", generatedAt: new Date(), summary: plan.summary, lots });
    expect(text).toContain("OFFRE — LOT N° 2 — TMA (02_Offre/Lot_2_TMA)");
    expect(text).toContain("Lots retenus : Lot n° 1 — Développement ; Lot n° 2 — TMA");
  });

  it("avec un seul lot retenu, le bordereau non rattaché lui revient", () => {
    const plan = planDossier({
      pieces: [piece("prix", "OFFRE", "Offre financière", "L1")], companyDocs: [], deadline: null, lots: [lots[0]], proposals: [],
      pricings: [{ id: "b0", filename: "BPU.xlsx", lotId: null, priced: 2, missing: 0 }],
    });
    expect(plan.entries.map((e) => e.source)).toEqual([{ kind: "pricing", pricingId: "b0" }]);
  });

  it("le DC1 coche les lots retenus", () => {
    const ctx = {
      buyer: "", consultationObject: "", consultationReference: "", references: [],
      lots: [{ number: "1", title: "Dév", selected: true }, { number: "2", title: "TMA", selected: false }],
      company: { legalName: "", siret: "", legalForm: "", nafCode: "", vatNumber: "", address: "", postalCode: "", city: "", phone: "", email: "", legalRepName: "", legalRepTitle: "", headcount: null, annualRevenueEur: null, certifications: [] },
    } satisfies FormContext;
    const lines = dc1Content(ctx).blocks.flatMap((b) => b.lines.map((l) => l.text));
    expect(lines).toContain("☒ Lot n° 1 — Dév");
    expect(lines).toContain("☐ Lot n° 2 — TMA");
    expect(lines).toContain("☐ Tous les lots");
  });
});
