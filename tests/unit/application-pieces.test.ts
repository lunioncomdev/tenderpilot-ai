import { describe, expect, it } from "vitest";
import type { TenderAnalysisResult } from "@/server/analysis/schema";
import { pieceProgress, planApplicationPieces } from "@/server/applications/pieces";

const src = (filename: string, pageStart: number) => [{ chunkId: "D1-C1", quote: "x", verified: true, filename, pageStart }];

function analysis(partial: Partial<TenderAnalysisResult>): TenderAnalysisResult {
  return { mandatoryDocuments: [], requiredCertifications: [], siteVisitMandatory: null, ...partial } as TenderAnalysisResult;
}

describe("dossier de candidature", () => {
  it("liste les pièces usuelles sans analyse, candidature avant offre", () => {
    const pieces = planApplicationPieces(null);
    const keys = pieces.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["dc1", "dc2", "kbis", "attestations", "ae", "memoire", "prix"]));
    expect(keys).not.toContain("visite");
    expect(pieces.every((p) => !p.fromDce)).toBe(true);
    const firstOffer = pieces.findIndex((p) => p.group === "OFFRE");
    expect(pieces.slice(firstOffer).every((p) => p.group === "OFFRE")).toBe(true);
  });

  it("rattache les pièces du DCE aux pièces usuelles et ajoute les autres", () => {
    const pieces = planApplicationPieces(analysis({
      mandatoryDocuments: [
        { text: "Formulaire DC1 dûment complété", sources: src("RC.pdf", 4) },
        { text: "Attestation URSSAF de moins de 6 mois", sources: src("RC.pdf", 5) },
        { text: "Charte de confidentialité signée", sources: src("RC.pdf", 6) },
        { text: "Planning prévisionnel de l'offre", sources: [] },
      ],
      requiredCertifications: [{ text: "Qualification ISO 27001", sources: src("RC.pdf", 7) }],
      siteVisitMandatory: true,
    }));
    const byKey = Object.fromEntries(pieces.map((p) => [p.key, p]));
    expect(byKey.dc1).toMatchObject({ fromDce: true, detail: "Formulaire DC1 dûment complété", source: "RC.pdf p.4" });
    expect(byKey.attestations.fromDce).toBe(true);
    expect(byKey["dce-3"]).toMatchObject({ group: "CANDIDATURE", label: "Charte de confidentialité signée" });
    expect(byKey["dce-4"].group).toBe("OFFRE");
    expect(byKey["cert-1"]).toMatchObject({ group: "CANDIDATURE", source: "RC.pdf p.7" });
    expect(byKey.visite).toBeDefined();
  });

  it("calcule l'avancement sans compter les pièces non requises", () => {
    expect(pieceProgress([{ status: "DONE" }, { status: "TODO" }, { status: "NOT_APPLICABLE" }, { status: "IN_PROGRESS" }])).toEqual({ done: 1, total: 3 });
    expect(pieceProgress([])).toEqual({ done: 0, total: 0 });
  });
});
