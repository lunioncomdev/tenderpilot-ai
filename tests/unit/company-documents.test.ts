import { describe, expect, it } from "vitest";
import { defaultValidUntil, isCoveredByProfile, linkCompanyDocs, pieceDocAlert, validityOf } from "@/server/company/documents";

const now = new Date("2026-10-29T10:00:00Z");
const d = (iso: string) => new Date(iso);

describe("pièces administratives", () => {
  it("déduit la fin de validité de la date de délivrance selon le type", () => {
    expect(defaultValidUntil("KBIS", d("2026-09-15"))?.toISOString().slice(0, 10)).toBe("2026-12-15");
    expect(defaultValidUntil("URSSAF", d("2026-05-01"))?.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(defaultValidUntil("RIB", d("2026-05-01"))).toBeNull();
    expect(defaultValidUntil("KBIS", null)).toBeNull();
  });

  it("signale les pièces expirées et celles qui expirent sous 30 jours", () => {
    expect(validityOf(d("2026-10-01"), now)).toBe("expired");
    expect(validityOf(d("2026-11-15"), now)).toBe("expiring");
    expect(validityOf(d("2027-03-01"), now)).toBe("valid");
    expect(validityOf(null, now)).toBe("none");
  });

  it("alerte si la pièce ne sera plus valable à la date limite du dossier", () => {
    expect(pieceDocAlert(d("2027-01-10"), d("2027-02-01"), now)).toBe("before-deadline");
    expect(pieceDocAlert(d("2027-03-10"), d("2027-02-01"), now)).toBeNull();
    expect(pieceDocAlert(d("2026-10-01"), d("2027-02-01"), now)).toBe("expired");
    expect(pieceDocAlert(d("2026-11-10"), null, now)).toBe("expiring");
  });

  it("rattache les pièces du profil aux pièces du dossier", () => {
    const docs = [
      { id: "1", type: "URSSAF" as const, label: "Attestation URSSAF", filename: "u.pdf", validUntil: d("2026-11-10") },
      { id: "2", type: "CERTIFICATION" as const, label: "ISO 27001", filename: "iso.pdf", validUntil: null },
      { id: "3", type: "CERTIFICATION" as const, label: "Qualiopi", filename: "q.pdf", validUntil: null },
    ];
    const attestations = linkCompanyDocs({ key: "attestations", detail: "" }, docs, d("2026-12-01"), now)!;
    expect(attestations.docs).toEqual([expect.objectContaining({ id: "1", alert: "before-deadline" })]);
    expect(attestations.missing).toEqual(["Attestation de régularité fiscale"]);
    expect(linkCompanyDocs({ key: "cert-1", detail: "Certification ISO 27001 en cours de validité" }, docs, null, now)!.docs.map((x) => x.id)).toEqual(["2"]);
    expect(linkCompanyDocs({ key: "kbis", detail: "" }, docs, null, now)!.missing).toEqual(["Extrait Kbis"]);
    expect(linkCompanyDocs({ key: "ae", detail: "" }, docs, null, now)).toBeNull();
  });

  it("considère la pièce prête si tout est présent et valable à la date limite", () => {
    const doc = (alert: "expired" | "before-deadline" | "expiring" | null) => ({ id: "1", label: "Kbis", filename: "k.pdf", validUntil: null, alert });
    expect(isCoveredByProfile({ docs: [doc(null)], missing: [] })).toBe(true);
    expect(isCoveredByProfile({ docs: [doc("expiring")], missing: [] })).toBe(true);
    expect(isCoveredByProfile({ docs: [doc("before-deadline")], missing: [] })).toBe(false);
    expect(isCoveredByProfile({ docs: [doc("expired")], missing: [] })).toBe(false);
    expect(isCoveredByProfile({ docs: [doc(null)], missing: ["Attestation de régularité fiscale"] })).toBe(false);
    expect(isCoveredByProfile({ docs: [], missing: [] })).toBe(false);
    expect(isCoveredByProfile(null)).toBe(false);
  });
});
