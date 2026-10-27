import { describe, expect, it } from "vitest";
import type { TenderAnalysisResult } from "@/server/analysis/schema";
import { computeScore, resolveWeights, scoreLevel, termMatches, type ScoringProfile, type ScoringTender } from "@/server/scoring/engine";

const now = new Date("2026-10-27T10:00:00Z");

const profile: ScoringProfile = {
  skills: ["Développement web", "Intelligence artificielle", "Maintenance applicative"],
  technologies: ["Laravel", "Next.js", "React", "PostgreSQL"],
  keywords: ["application métier", "chatbot", "API"],
  cpvCodes: ["72200000"],
  certifications: ["ISO 27001"],
  eligibleCountries: ["FR"],
  minBudgetEur: 30_000,
  maxBudgetEur: 800_000,
  annualRevenueEur: 1_200_000,
};

const tender: ScoringTender = {
  title: "Développement d'une application métier avec chatbot",
  description: "Refonte en Laravel et React, exposition d'une API",
  cpvCodes: ["72212000"],
  estimatedValue: 250_000,
  deadlineAt: new Date("2026-12-01T12:00:00Z"),
  buyerCountry: "FR",
  noticeState: "ACTIVE",
};

const emptyField = { value: null, sources: [] };
function analysis(over: Partial<TenderAnalysisResult> = {}): TenderAnalysisResult {
  return {
    summary: "",
    object: emptyField, buyer: emptyField, consultationReference: emptyField, budget: emptyField,
    budgetAmountEur: null, deadline: emptyField, deadlineIso: null, questionsDeadline: emptyField,
    contractDuration: emptyField, executionDelay: emptyField, lots: [], candidacyConditions: [],
    technicalRequirements: [], requiredSkills: ["Laravel", "React", "RGAA"], requiredCertifications: [],
    minAnnualRevenueEur: null, minReferences: null, deliverables: [], hostingSecurity: emptyField,
    gdpr: emptyField, accessibility: emptyField, ecoDesign: emptyField, maintenance: emptyField, sla: emptyField,
    awardCriteria: [], mandatoryDocuments: [], risks: [], siteVisitMandatory: false,
    consortiumAllowed: null, subcontractingAllowed: null, injectionAttemptsDetected: [],
    ...over,
  };
}

const refs = [
  { title: "Application métier de gestion", description: "Développement Laravel React avec chatbot", technologies: ["Laravel"], isPublic: true },
  { title: "Portail citoyen", description: "Application métier et API", technologies: ["Next.js"], isPublic: true },
];

describe("pondérations", () => {
  it("normalise à 100 et ignore les valeurs invalides", () => {
    const w = resolveWeights({ technical: 50, financial: -3, foo: 9 });
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100);
    expect(w.technical).toBeGreaterThan(w.capabilities);
  });

  it("niveaux de pertinence", () => {
    expect(scoreLevel(85)).toBe("PRIORITY");
    expect(scoreLevel(60)).toBe("INTERESTING");
    expect(scoreLevel(59)).toBe("TO_STUDY");
    expect(scoreLevel(39)).toBe("LOW");
  });
});

describe("correspondance de termes", () => {
  it("tolère accents, casse et inclusion de mots", () => {
    expect(termMatches("laravel", "Framework Laravel 11")).toBe(true);
    expect(termMatches("Intelligence Artificielle", "intelligence artificielle générative")).toBe(true);
    expect(termMatches("API", "rapide")).toBe(false);
  });
});

describe("score", () => {
  it("sans analyse : jamais GO, conditions du DCE à vérifier", () => {
    const s = computeScore({ tender, profile, analysis: null, references: refs, now });
    expect(s.recommendation).not.toBe("GO");
    expect(s.eliminatory.find((e) => e.key === "dce")?.status).toBe("UNKNOWN");
    expect(s.missingInfo.join(" ")).toContain("DCE non analysé");
    expect(s.total).toBeGreaterThan(0);
  });

  it("avec analyse favorable : GO et explication", () => {
    const s = computeScore({ tender, profile, analysis: analysis(), references: refs, now });
    expect(s.total).toBeGreaterThanOrEqual(60);
    expect(s.recommendation).toBe("GO");
    expect(s.breakdown).toHaveLength(6);
    expect(s.breakdown.reduce((a, b) => a + b.weight, 0)).toBeCloseTo(100, 0);
    expect(s.weaknesses.join(" ")).toContain("RGAA");
    expect(s.justification).toContain("Score");
  });

  it("un critère éliminatoire non satisfait force le NO-GO malgré un score élevé", () => {
    const s = computeScore({
      tender,
      profile,
      analysis: analysis({ requiredCertifications: [{ text: "Qualification SecNumCloud", sources: [] }] }),
      references: refs,
      now,
    });
    expect(s.eliminatory.find((e) => e.key === "certifications")?.status).toBe("FAIL");
    expect(s.recommendation).toBe("NO_GO");
    expect(s.justification).toContain("éliminatoire");
  });

  it("chiffre d'affaires insuffisant ou références insuffisantes ⇒ NO-GO", () => {
    expect(computeScore({ tender, profile, analysis: analysis({ minAnnualRevenueEur: 5_000_000 }), references: refs, now }).recommendation).toBe("NO_GO");
    expect(computeScore({ tender, profile, analysis: analysis({ minReferences: 3 }), references: refs, now }).recommendation).toBe("NO_GO");
  });

  it("CA non renseigné face à une exigence ⇒ à vérifier", () => {
    const s = computeScore({ tender, profile: { ...profile, annualRevenueEur: null }, analysis: analysis({ minAnnualRevenueEur: 100_000 }), references: refs, now });
    expect(s.eliminatory.find((e) => e.key === "revenue")?.status).toBe("UNKNOWN");
    expect(s.recommendation).toBe("TO_VERIFY");
  });

  it("date limite dépassée, avis annulé, hors zone ⇒ NO-GO", () => {
    expect(computeScore({ tender: { ...tender, deadlineAt: new Date("2026-10-01") }, profile, analysis: analysis(), references: refs, now }).recommendation).toBe("NO_GO");
    expect(computeScore({ tender: { ...tender, noticeState: "CANCELLED" }, profile, analysis: analysis(), references: refs, now }).recommendation).toBe("NO_GO");
    expect(computeScore({ tender: { ...tender, buyerCountry: "DE" }, profile, analysis: analysis(), references: refs, now }).recommendation).toBe("NO_GO");
  });

  it("les risques élevés pénalisent le critère contractuel", () => {
    const risky = computeScore({
      tender, profile, references: refs, now,
      analysis: analysis({ risks: [{ text: "Pénalités illimitées", severity: "high", sources: [] }, { text: "Propriété intellectuelle cédée", severity: "high", sources: [] }] }),
    });
    const c = risky.breakdown.find((b) => b.key === "contractual")!;
    expect(c.ratio).toBeCloseTo(0.3);
    expect(risky.risks[0]).toContain("élevé");
  });

  it("montant inconnu : note neutre + information manquante", () => {
    const s = computeScore({ tender: { ...tender, estimatedValue: null }, profile, analysis: analysis(), references: refs, now });
    expect(s.breakdown.find((b) => b.key === "financial")!.ratio).toBe(0.5);
    expect(s.missingInfo).toContain("Budget / montant estimé");
  });
});
