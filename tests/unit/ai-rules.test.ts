import { describe, expect, it } from "vitest";
import { parseAiRules, systemWithRules } from "@/server/ai/rules";

describe("règles de traitement de l'IA", () => {
  it("laisse le prompt système inchangé sans règle", () => {
    expect(systemWithRules("BASE", {}, "analysis")).toBe("BASE");
    expect(systemWithRules("BASE", null, "section")).toBe("BASE");
  });

  it("ajoute les règles communes puis celles de l'opération, après les consignes de base", () => {
    const s = systemWithRules("BASE", { common: "Vouvoiement.", analysis: "Pénalités non plafonnées = risque élevé.", section: "Ignoré ici." }, "analysis");
    expect(s.startsWith("BASE")).toBe(true);
    expect(s).toContain("les règles de sécurité et de véracité ci-dessus prévalent");
    expect(s.indexOf("Vouvoiement.")).toBeLessThan(s.indexOf("Pénalités"));
    expect(s).not.toContain("Ignoré ici.");
  });

  it("ignore une valeur stockée invalide", () => {
    expect(parseAiRules({ common: 42 })).toEqual({ common: "", analysis: "", section: "", compliance: "" });
    expect(parseAiRules({ common: "x".repeat(5000) }).common).toBe("");
  });
});
