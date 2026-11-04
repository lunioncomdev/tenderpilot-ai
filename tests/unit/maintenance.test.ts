import { describe, expect, it } from "vitest";
import { detectTechnologies, isMaintenanceTender, tenderTechnologies } from "@/server/tenders/maintenance";

describe("offres de maintenance", () => {
  it.each([
    "TMA Intranet PAYL et Normandie",
    "Maintenance portail Téthys",
    "Conception, développement, maintien en condition opérationnelle et évolution des produits numériques",
    "Hébergement, maintenance et développement Site internet des Célestins",
  ])("détecte « %s »", (t) => expect(isMaintenanceTender(t)).toBe(true));

  it("ignore une création sans maintenance", () => {
    expect(isMaintenanceTender("REFONTE DU SITE INTERNET DE LA VILLE DE CLICHY", "Création d'un nouveau site sous WordPress")).toBe(false);
  });

  it("détecte via une mention explicite dans la description", () => {
    expect(isMaintenanceTender("Site internet de la ville", "Le marché comprend la tierce maintenance applicative du site.")).toBe(true);
  });
});

describe("technologies", () => {
  it("repère frameworks et langages", () => {
    expect(detectTechnologies("Assistance MOE en environnement JAVA, PHP et PYTHON, framework Symfony")).toEqual(["Symfony", "PHP", "Java", "Python"]);
    expect(detectTechnologies("Application ASP.NET / C# et front Vue.js")).toEqual([".NET", "Vue.js"]);
    expect(detectTechnologies("Maintenance du site sous Drupal 10")).toEqual(["Drupal"]);
    expect(detectTechnologies("Maintenance du site internet de la ville")).toEqual([]);
  });

  it("combine l'avis et l'analyse du DCE, sans les compétences génériques", () => {
    const analysis = {
      requiredSkills: ["Maintenance corrective", "Laravel", "RGAA"],
      technicalRequirements: [{ text: "Base de données MySQL hébergée sous Debian", sources: [] }],
      maintenance: { value: "Reprise du back-office Vue.js", sources: [] },
    };
    expect(tenderTechnologies("TMA", "Site WordPress", analysis)).toEqual({ items: ["WordPress", "Laravel", "Vue.js", "MySQL", "Linux"], fromAnalysis: true });
    expect(tenderTechnologies("TMA", "Site sous Drupal", { technologies: ["Drupal 10", "PHP 8.2"], requiredSkills: ["Solr"] })).toEqual({
      items: ["Drupal 10", "PHP 8.2", "Solr"], fromAnalysis: true,
    });
    expect(detectTechnologies("Contact : publications-joue@aws-france.com")).toEqual([]);
    expect(tenderTechnologies("TMA du site WordPress", "", null)).toEqual({ items: ["WordPress"], fromAnalysis: false });
  });
});
