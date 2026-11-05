import { describe, expect, it } from "vitest";
import { stripSourceMarkers } from "@/server/ai/prompts/generate-section";

describe("stripSourceMarkers", () => {
  it("retire les identifiants de source en fin de paragraphe", () => {
    const md = "Nous accompagnons des collectivités. [PROFIL.description] [REF-1] [REF-2]\n\nDeuxième paragraphe [REF-3].";
    expect(stripSourceMarkers(md)).toBe("Nous accompagnons des collectivités.\n\nDeuxième paragraphe.");
  });

  it("retire les marqueurs groupés et les passages du DCE", () => {
    expect(stripSourceMarkers("Texte [REF-1, REF-2 ; PROFIL.methodology] fin (D2-C14).")).toBe("Texte fin.");
  });

  it("conserve les marqueurs à compléter / à valider et la ponctuation française", () => {
    const md = "Délai : 4 h [À VALIDER] ; contact : [À COMPLÉTER : nom] ! Voir REF interne ?";
    expect(stripSourceMarkers(md)).toBe(md);
  });
});
