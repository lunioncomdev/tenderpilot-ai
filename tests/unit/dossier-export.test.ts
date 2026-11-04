import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { dossierSummaryText, planDossier, safeName, type DossierCompanyDoc, type DossierPiece } from "@/server/applications/dossier-export";
import { countTodos, dc1Content, dc2Content, renderFormDocx, TODO, type FormContext } from "@/server/applications/forms-docx";

const now = new Date("2026-11-04T10:00:00Z");
const deadline = new Date("2026-12-01T12:00:00Z");

const piece = (key: string, group: DossierPiece["group"], label: string, extra: Partial<DossierPiece> = {}): DossierPiece => ({
  key, group, label, detail: "", status: "DONE", files: [], ...extra,
});

const doc = (id: string, type: DossierCompanyDoc["type"], label: string, validUntil: string | null): DossierCompanyDoc => ({
  id, type, label, filename: `${id}.pdf`, storageKey: `org/o/company/${id}.pdf`, validUntil: validUntil ? new Date(validUntil) : null,
});

const company: FormContext["company"] = {
  legalName: "Agence Exemple", siret: "123 456 789 00012", legalForm: "SAS", nafCode: "62.01Z", vatNumber: "FR12123456789",
  address: "1 rue de la Paix", postalCode: "75002", city: "Paris", phone: "0140506070", email: "ao@example.fr",
  legalRepName: "Camille Martin", legalRepTitle: "Présidente", headcount: 12, annualRevenueEur: 1_200_000, certifications: ["ISO 27001"],
};
const ctx: FormContext = {
  buyer: "Ville de Lyon", consultationObject: "Refonte du portail", consultationReference: "2026-042",
  lots: [], company, references: [{ title: "Portail usagers", client: "Métropole X", year: 2025, amountEur: 180_000 }],
};

describe("noms de fichiers du dossier", () => {
  it("produit des noms ASCII sans espaces ni caractères spéciaux", () => {
    expect(safeName("Lettre de candidature (DC1) ou DUME")).toBe("Lettre_de_candidature_DC1_ou_DUME");
    expect(safeName("Attestation d'assurance « RC » — été")).toBe("Attestation_d_assurance_RC_ete");
    expect(safeName("***")).toBe("piece");
    expect(safeName("a".repeat(100)).length).toBe(60);
  });
});

describe("plan du dossier", () => {
  it("range les pièces par groupe, numérote et ignore les pièces non requises", () => {
    const plan = planDossier({
      pieces: [
        piece("ae", "OFFRE", "Acte d'engagement", { files: [{ filename: "AE signé.pdf", storageKey: "k/ae.pdf" }] }),
        piece("kbis", "CANDIDATURE", "Extrait Kbis"),
        piece("visite", "OFFRE", "Attestation de visite", { status: "NOT_APPLICABLE" }),
        piece("dc1", "CANDIDATURE", "Lettre de candidature (DC1)"),
      ],
      companyDocs: [doc("kbis1", "KBIS", "Extrait Kbis", "2026-12-20")],
      deadline, hasProposal: false, now,
    });
    expect(plan.entries.map((e) => e.path)).toEqual([
      "01_Candidature/01_Extrait_Kbis.pdf",
      "01_Candidature/02_Lettre_de_candidature_DC1.docx",
      "02_Offre/01_Acte_d_engagement.pdf",
    ]);
    expect(plan.entries[0].source).toEqual({ kind: "storage", storageKey: "org/o/company/kbis1.pdf" });
    expect(plan.entries[1].source).toEqual({ kind: "generated", what: "dc1" });
    expect(plan.summary.find((s) => s.label.startsWith("Lettre"))?.issues[0]).toMatch(/compléter, vérifier et signer/);
    expect(plan.summary.some((s) => s.label === "Attestation de visite")).toBe(false);
  });

  it("privilégie les fichiers joints à la consultation sur les pièces du profil", () => {
    const plan = planDossier({
      pieces: [piece("kbis", "CANDIDATURE", "Extrait Kbis", { files: [{ filename: "kbis-oct.pdf", storageKey: "k/kbis.pdf" }] })],
      companyDocs: [doc("kbis1", "KBIS", "Extrait Kbis", "2026-12-20")],
      deadline, hasProposal: false, now,
    });
    expect(plan.entries).toEqual([{ path: "01_Candidature/01_Extrait_Kbis.pdf", source: { kind: "storage", storageKey: "k/kbis.pdf" } }]);
  });

  it("n'inclut pas une attestation qui expire avant la date limite et le signale", () => {
    const plan = planDossier({
      pieces: [piece("attestations", "CANDIDATURE", "Attestations fiscale et sociale")],
      companyDocs: [doc("u", "URSSAF", "Attestation URSSAF", "2026-11-20"), doc("f", "FISCALE", "Attestation fiscale", "2027-05-01")],
      deadline, hasProposal: false, now,
    });
    expect(plan.entries.map((e) => e.path)).toEqual(["01_Candidature/01_Attestations_fiscale_et_sociale.pdf"]);
    expect(plan.summary[0].issues).toEqual(["Attestation URSSAF : expire avant la date limite — non incluse"]);
  });

  it("place plusieurs fichiers dans un sous-dossier, sans collision de noms", () => {
    const plan = planDossier({
      pieces: [piece("moyens", "CANDIDATURE", "CV des intervenants", { files: [{ filename: "CV.pdf", storageKey: "a" }, { filename: "CV.pdf", storageKey: "b" }] })],
      companyDocs: [], deadline, hasProposal: false, now,
    });
    expect(plan.entries.map((e) => e.path)).toEqual(["01_Candidature/01_CV_des_intervenants/CV.pdf", "01_Candidature/01_CV_des_intervenants/CV_2.pdf"]);
  });

  it("génère le DC2 à défaut de DC2 dans le profil, et le mémoire s'il existe", () => {
    const plan = planDossier({
      pieces: [piece("dc2", "CANDIDATURE", "DC2"), piece("memoire", "OFFRE", "Mémoire technique", { status: "IN_PROGRESS" })],
      companyDocs: [], deadline, hasProposal: true, now,
    });
    expect(plan.entries.map((e) => e.source)).toEqual([{ kind: "generated", what: "dc2" }, { kind: "generated", what: "memoire" }]);
    expect(plan.summary[0].issues.some((i) => i.includes("absente du profil"))).toBe(false);
    expect(plan.summary[1].issues).toContain("statut « En cours »");
  });

  it("signale les pièces sans fichier et le mémoire non créé", () => {
    const plan = planDossier({
      pieces: [piece("prix", "OFFRE", "BPU", { status: "TODO" }), piece("memoire", "OFFRE", "Mémoire technique", { status: "TODO" })],
      companyDocs: [], deadline, hasProposal: false, now,
    });
    expect(plan.entries).toEqual([]);
    expect(plan.summary[0].issues).toEqual(["aucun fichier joint", "statut « À faire »"]);
    expect(plan.summary[1].issues).toContain("mémoire technique non créé");
    const text = dossierSummaryText({ title: "T", buyer: "B", reference: "R", deadline, companyName: "C", generatedAt: now, summary: plan.summary });
    expect(text).toContain("⚠ 2 pièce(s) à vérifier");
    expect(text).toContain("✗ aucun fichier dans le dossier");
  });
});

describe("formulaires DC1 / DC2", () => {
  it("remplit l'identification depuis le profil et l'analyse", () => {
    const text = dc1Content(ctx).blocks.flatMap((b) => b.lines.map((l) => l.text)).join("\n");
    expect(text).toContain("Ville de Lyon");
    expect(text).toContain("Référence de la consultation : 2026-042");
    expect(text).toContain("Numéro SIRET : 12345678900012");
    expect(text).toContain("Adresse de l'établissement : 1 rue de la Paix, 75002 Paris");
    expect(text).toContain("Camille Martin, Présidente");
    expect(text).toContain("☒ Le marché public");
  });

  it("propose les lots à cocher quand le DCE est alloti", () => {
    const text = dc1Content({ ...ctx, lots: [{ number: "1", title: "Développement" }, { number: "2", title: "TMA" }] }).blocks.flatMap((b) => b.lines.map((l) => l.text));
    expect(text).toContain("☐ Lot n° 2 — TMA");
  });

  it("signale les données manquantes au lieu d'en inventer", () => {
    const empty = { ...company, siret: "", legalForm: "", address: "", legalRepName: "", annualRevenueEur: null, headcount: null };
    const content = dc2Content({ ...ctx, company: empty, references: [] });
    const text = content.blocks.flatMap((b) => b.lines.map((l) => l.text)).join("\n");
    expect(text).toContain(`Forme juridique : ${TODO}`);
    expect(text).toContain(`Dernier exercice : ${TODO}`);
    expect(countTodos(content)).toBeGreaterThan(countTodos(dc2Content(ctx)));
  });

  it("rend un DOCX valide contenant les données", async () => {
    const buf = await renderFormDocx(dc2Content(ctx), company.legalName);
    const xml = await (await JSZip.loadAsync(buf)).file("word/document.xml")!.async("string");
    expect(xml).toContain("Agence Exemple");
    expect(xml).toMatch(/1\s200\s000 € HT/u);
  });
});
