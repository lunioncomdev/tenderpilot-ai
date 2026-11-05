import { describe, expect, it } from "vitest";
import type { DossierPiece } from "@/server/applications/dossier-export";
import { countMarkers, evaluateReadiness, type ReadinessInput } from "@/server/applications/readiness";
import type { PieceDocs } from "@/server/company/documents";

const now = new Date("2026-11-07T10:00:00Z");
const DAY = 86_400_000;

const piece = (key: string, label: string, extra: Partial<DossierPiece & { profile: PieceDocs | null }> = {}) => ({
  key, label, group: "OFFRE" as const, detail: "", status: "DONE" as const, lotId: null,
  files: [{ filename: `${key}.pdf`, storageKey: `k/${key}` }], profile: null, ...extra,
});

/** Dossier complet et sans défaut ; chaque test en dégrade un aspect. */
function base(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    now,
    deadline: new Date(now.getTime() + 10 * DAY),
    lotsTotal: 0,
    lots: [],
    pieces: [piece("ae", "Acte d'engagement"), piece("memoire", "Mémoire technique", { files: [] }), piece("prix", "Offre financière", { files: [] })],
    companyDocs: [],
    proposals: [{ id: "m", lotId: null, sections: [{ title: "Solution", status: "VALIDATED", markers: 0 }], compliance: [{ status: "COMPLIANT" }] }],
    pricings: [{ id: "b", filename: "BPU.xlsx", lotId: null, lines: 4, priced: 4, missing: 0 }],
    ...over,
  };
}

const check = (r: ReturnType<typeof evaluateReadiness>, key: string) => r.checks.find((c) => c.key === key)!;

describe("contrôle avant dépôt", () => {
  it("valide un dossier complet", () => {
    const r = evaluateReadiness(base());
    expect(r).toMatchObject({ ready: true, blockers: 0, warnings: 0 });
    expect(r.checks.map((c) => c.key)).toEqual(["deadline", "pieces", "validity", "memoire", "compliance", "pricing", "files"]);
  });

  it("bloque après la date limite et avertit sous 48 h ou si elle est inconnue", () => {
    expect(check(evaluateReadiness(base({ deadline: new Date(now.getTime() - 1000) })), "deadline").level).toBe("blocker");
    expect(check(evaluateReadiness(base({ deadline: new Date(now.getTime() + DAY) })), "deadline").level).toBe("warning");
    expect(check(evaluateReadiness(base({ deadline: null })), "deadline").level).toBe("warning");
  });

  it("bloque les pièces non prêtes et ignore les pièces non requises", () => {
    const r = evaluateReadiness(base({ pieces: [...base().pieces, piece("rib", "RIB", { status: "IN_PROGRESS" }), piece("visite", "Visite", { status: "NOT_APPLICABLE" })] }));
    expect(check(r, "pieces")).toMatchObject({ level: "blocker", details: ["RIB — en cours"] });
    expect(r.ready).toBe(false);
  });

  it("bloque une pièce administrative expirée, sauf si un fichier propre à la consultation la remplace", () => {
    const profile: PieceDocs = { docs: [{ id: "u", label: "Attestation URSSAF", filename: "u.pdf", validUntil: null, alert: "before-deadline" }], missing: [] };
    const without = evaluateReadiness(base({ pieces: [...base().pieces, piece("attestations", "Attestations", { files: [], profile })] }));
    expect(check(without, "validity")).toMatchObject({ level: "blocker", details: ["Attestation URSSAF : expire avant la date limite"] });
    const withFile = evaluateReadiness(base({ pieces: [...base().pieces, piece("attestations", "Attestations", { profile })] }));
    expect(check(withFile, "validity").level).toBe("ok");
  });

  it("bloque un mémoire absent, une section non validée ou des marqueurs restants", () => {
    expect(check(evaluateReadiness(base({ proposals: [] })), "memoire").details).toEqual(["Mémoire technique non créé"]);
    const r = evaluateReadiness(base({
      proposals: [{ id: "m", lotId: null, compliance: [], sections: [{ title: "Équipe", status: "AI_DRAFT", markers: 0 }, { title: "Planning", status: "VALIDATED", markers: 2 }] }],
    }));
    expect(check(r, "memoire")).toMatchObject({
      level: "blocker",
      details: ["« Équipe » : section non validée", "« Planning » : 2 marqueurs [À COMPLÉTER] / [À VALIDER] restant(s)"],
    });
  });

  it("accepte un mémoire joint en fichier à la place du mémoire généré", () => {
    const uploaded = [piece("ae", "Acte d'engagement"), piece("memoire", "Mémoire technique"), piece("prix", "Offre financière", { files: [] })];
    const none = evaluateReadiness(base({ pieces: uploaded, proposals: [] }));
    expect(check(none, "memoire")).toMatchObject({ level: "ok", summary: "Mémoire technique fourni sous forme de fichier.", details: [] });
    const draft = evaluateReadiness(base({ pieces: uploaded, proposals: [{ id: "m", lotId: null, sections: [{ title: "Solution", status: "AI_DRAFT", markers: 2 }], compliance: [] }] }));
    expect(check(draft, "memoire").level).toBe("ok");
    expect(draft.ready).toBe(true);
  });

  it("signale les exigences non conformes sans bloquer", () => {
    const r = evaluateReadiness(base({ proposals: [{ ...base().proposals[0], compliance: [{ status: "COMPLIANT" }, { status: "NON_COMPLIANT" }, { status: "TO_VERIFY" }] }] }));
    expect(check(r, "compliance")).toMatchObject({ level: "warning", summary: "1 / 3 exigence(s) conforme(s)." });
    expect(r.ready).toBe(true);
  });

  it("bloque un bordereau incomplet, sauf offre financière jointe en fichier", () => {
    const pricings = [{ id: "b", filename: "BPU.xlsx", lotId: null, lines: 4, priced: 3, missing: 1 }];
    expect(check(evaluateReadiness(base({ pricings })), "pricing")).toMatchObject({ level: "blocker", details: ["BPU.xlsx : 1 ligne non chiffrée(s)"] });
    const pieces = base().pieces.map((p) => (p.key === "prix" ? { ...p, files: [{ filename: "BPU signé.pdf", storageKey: "k" }] } : p));
    expect(check(evaluateReadiness(base({ pricings, pieces })), "pricing").level).toBe("ok");
  });

  it("consultation allotie : exige un lot retenu et contrôle chaque lot", () => {
    expect(check(evaluateReadiness(base({ lotsTotal: 2 })), "lots").level).toBe("blocker");
    const lots = [{ id: "L1", number: "1", title: "Dév" }, { id: "L2", number: "2", title: "TMA" }];
    const r = evaluateReadiness(base({
      lotsTotal: 2, lots,
      pieces: [piece("memoire", "Mémoire", { files: [], lotId: "L1" }), piece("memoire", "Mémoire", { files: [], lotId: "L2" }), piece("prix", "Prix", { files: [], lotId: "L2" })],
      proposals: [{ id: "m1", lotId: "L1", sections: [{ title: "S", status: "VALIDATED", markers: 0 }], compliance: [] }],
      pricings: [{ id: "b2", filename: "DPGF2.xlsx", lotId: "L2", lines: 2, priced: 1, missing: 1 }, { id: "b0", filename: "Vieux.xlsx", lotId: null, lines: 1, priced: 1, missing: 0 }],
    }));
    expect(check(r, "lots").level).toBe("ok");
    expect(check(r, "memoire").details).toEqual(["Mémoire technique (lot 2) non créé"]);
    expect(check(r, "pricing").details).toEqual(["DPGF2.xlsx (lot 2) : 1 ligne non chiffrée(s)", "Vieux.xlsx : bordereau rattaché à aucun lot retenu"]);
  });

  it("avertit des pièces « prêtes » sans fichier dans le dossier", () => {
    const r = evaluateReadiness(base({ pieces: [...base().pieces, piece("cahiers", "CCAP et CCTP", { files: [] })] }));
    expect(check(r, "files")).toMatchObject({ level: "warning", details: ["CCAP et CCTP"] });
  });

  it("compte les marqueurs de rédaction", () => {
    expect(countMarkers("Délai [À VALIDER] et [À COMPLÉTER : nom du chef de projet], [À COMPLÉTER]")).toBe(3);
    expect(countMarkers("Texte final.")).toBe(0);
  });
});
