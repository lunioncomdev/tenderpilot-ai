import { normalizeText } from "@/lib/utils";
import type { TenderAnalysisResult } from "../analysis/schema";

/**
 * Moteur de scoring déterministe. L'IA fournit des faits (analyse du DCE) ;
 * les notes, les critères éliminatoires et la recommandation sont calculés ici.
 */

export type CriterionKey = "technical" | "capabilities" | "financial" | "schedule" | "administrative" | "contractual";

export const CRITERIA: Array<{ key: CriterionKey; label: string; defaultWeight: number }> = [
  { key: "technical", label: "Adéquation technique", defaultWeight: 25 },
  { key: "capabilities", label: "Capacités et références", defaultWeight: 20 },
  { key: "financial", label: "Potentiel financier", defaultWeight: 20 },
  { key: "schedule", label: "Faisabilité du calendrier", defaultWeight: 15 },
  { key: "administrative", label: "Complexité administrative", defaultWeight: 10 },
  { key: "contractual", label: "Risques contractuels", defaultWeight: 10 },
];

export type Weights = Record<CriterionKey, number>;

export type ScoringProfile = {
  skills: string[];
  technologies: string[];
  keywords: string[];
  cpvCodes: string[];
  certifications: string[];
  eligibleCountries: string[];
  minBudgetEur: number | null;
  maxBudgetEur: number | null;
  annualRevenueEur: number | null;
  scoringWeights?: unknown;
};

export type ScoringTender = {
  title: string;
  description: string;
  cpvCodes: string[];
  estimatedValue: number | null;
  deadlineAt: Date | null;
  buyerCountry: string | null;
  noticeState: "ACTIVE" | "MODIFIED" | "CANCELLED" | "AWARDED";
};

export type ScoringReference = { title: string; description: string; technologies: string[]; isPublic: boolean };

export type EliminatoryStatus = "PASS" | "FAIL" | "UNKNOWN" | "WARN";
export type EliminatoryCheck = { key: string; label: string; status: EliminatoryStatus; detail: string };
export type CriterionResult = { key: CriterionKey; label: string; weight: number; points: number; ratio: number; rationale: string };
export type RecommendationT = "GO" | "NO_GO" | "TO_VERIFY";

export type ScoreResult = {
  total: number;
  level: "PRIORITY" | "INTERESTING" | "TO_STUDY" | "LOW";
  breakdown: CriterionResult[];
  eliminatory: EliminatoryCheck[];
  recommendation: RecommendationT;
  strengths: string[];
  weaknesses: string[];
  missingInfo: string[];
  risks: string[];
  justification: string;
  weights: Weights;
};

export function resolveWeights(overrides: unknown): Weights {
  const w = Object.fromEntries(CRITERIA.map((c) => [c.key, c.defaultWeight])) as Weights;
  if (overrides && typeof overrides === "object") {
    for (const c of CRITERIA) {
      const v = (overrides as Record<string, unknown>)[c.key];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) w[c.key] = v;
    }
  }
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  if (sum <= 0) return resolveWeights(null);
  for (const c of CRITERIA) w[c.key] = (w[c.key] * 100) / sum;
  return w;
}

export function scoreLevel(total: number): ScoreResult["level"] {
  if (total >= 80) return "PRIORITY";
  if (total >= 60) return "INTERESTING";
  if (total >= 40) return "TO_STUDY";
  return "LOW";
}

export const LEVEL_LABELS: Record<ScoreResult["level"], string> = {
  PRIORITY: "Opportunité prioritaire",
  INTERESTING: "Opportunité intéressante",
  TO_STUDY: "À étudier",
  LOW: "Faible pertinence",
};

/** Correspondance souple : « laravel » ↔ « Framework Laravel 11 ». */
export function termMatches(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const short = na.length <= nb.length ? na : nb;
  const long = na.length <= nb.length ? nb : na;
  if (short.length < 3) return long.split(" ").includes(short);
  return ` ${long} `.includes(` ${short} `) || (short.length >= 5 && long.includes(short));
}

function significantWords(s: string): Set<string> {
  return new Set(
    normalizeText(s)
      .split(" ")
      .filter((w) => w.length >= 4),
  );
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));

type Ctx = {
  tender: ScoringTender;
  profile: ScoringProfile | null;
  analysis: TenderAnalysisResult | null;
  references: ScoringReference[];
  now: Date;
  missing: string[];
  strengths: string[];
  weaknesses: string[];
};

function technical(c: Ctx): [number, string] {
  const p = c.profile;
  if (!p) {
    c.missing.push("Profil entreprise non renseigné");
    return [0.5, "Profil entreprise absent : note neutre."];
  }
  const capabilities = [...p.skills, ...p.technologies, ...p.keywords];
  const cpvHit = c.tender.cpvCodes.some((code) =>
    p.cpvCodes.some((pc) => code.startsWith(pc.replace(/0+$/, "") || pc)),
  );
  if (c.analysis && c.analysis.requiredSkills.length) {
    const req = c.analysis.requiredSkills;
    const matched = req.filter((r) => capabilities.some((cap) => termMatches(r, cap)));
    const unmatched = req.filter((r) => !matched.includes(r));
    const ratio = clamp(matched.length / req.length + (cpvHit ? 0.1 : 0));
    if (matched.length) c.strengths.push(`Compétences couvertes : ${matched.slice(0, 6).join(", ")}`);
    if (unmatched.length) c.weaknesses.push(`Compétences non couvertes : ${unmatched.slice(0, 6).join(", ")}`);
    return [ratio, `${matched.length}/${req.length} compétences exigées couvertes${cpvHit ? ", CPV cible" : ""}.`];
  }
  const text = `${c.tender.title} ${c.tender.description}`;
  const hits = [...new Set(capabilities.filter((cap) => termMatches(cap, text)).map((h) => h.toLowerCase()))];
  const base = hits.length >= 3 ? 1 : hits.length === 2 ? 0.75 : hits.length === 1 ? 0.5 : 0.15;
  if (!c.analysis) c.missing.push("Exigences techniques détaillées (DCE non analysé)");
  return [
    clamp(base + (cpvHit ? 0.2 : 0)),
    `${hits.length} terme(s) du profil dans l'avis${hits.length ? ` (${hits.slice(0, 5).join(", ")})` : ""}${cpvHit ? ", CPV cible" : ""}.`,
  ];
}

function capabilities(c: Ctx): [number, string] {
  const tenderWords = significantWords(`${c.tender.title} ${c.tender.description}`);
  const reqSkills = c.analysis?.requiredSkills ?? [];
  if (!c.references.length) c.missing.push("Aucune référence projet saisie dans le profil");
  const similar = c.references.filter((r) => {
    const overlap = [...significantWords(`${r.title} ${r.description}`)].filter((w) => tenderWords.has(w)).length;
    const techOverlap = r.technologies.some((t) => reqSkills.some((s) => termMatches(s, t)));
    return overlap >= 2 || techOverlap;
  });
  let ratio = similar.length >= 3 ? 1 : similar.length === 2 ? 0.8 : similar.length === 1 ? 0.55 : 0.2;
  let detail = `${similar.length} référence(s) similaire(s).`;
  if (similar.length) c.strengths.push(`Références similaires : ${similar.slice(0, 3).map((r) => r.title).join(" ; ")}`);
  const certs = c.analysis?.requiredCertifications ?? [];
  if (certs.length && c.profile) {
    const held = certs.filter((rc) => c.profile!.certifications.some((pc) => termMatches(rc.text, pc)));
    ratio *= held.length / certs.length;
    detail += ` Certifications exigées détenues : ${held.length}/${certs.length}.`;
  }
  return [clamp(ratio), detail];
}

function financial(c: Ctx): [number, string] {
  const value = c.analysis?.budgetAmountEur ?? c.tender.estimatedValue;
  if (value === null || value === undefined) {
    c.missing.push("Budget / montant estimé");
    return [0.5, "Montant non communiqué : note neutre."];
  }
  const min = c.profile?.minBudgetEur ?? null;
  const max = c.profile?.maxBudgetEur ?? null;
  const fmt = `${Math.round(value).toLocaleString("fr-FR")} €`;
  if (min !== null || max !== null) {
    if (min !== null && value < min) return [clamp((value / min) * 0.8), `${fmt}, sous le seuil cible (${min.toLocaleString("fr-FR")} €).`];
    if (max !== null && value > max) {
      c.weaknesses.push(`Montant (${fmt}) au-delà de la capacité cible`);
      return [value > 3 * max ? 0.3 : 0.6, `${fmt}, au-delà du plafond cible (${max.toLocaleString("fr-FR")} €).`];
    }
    c.strengths.push(`Montant dans la cible (${fmt})`);
    return [1, `${fmt}, dans la fourchette cible.`];
  }
  const r = value < 20_000 ? 0.3 : value < 50_000 ? 0.6 : value <= 1_000_000 ? 1 : 0.7;
  return [r, `${fmt} (aucune fourchette cible définie).`];
}

function schedule(c: Ctx): [number, string] {
  const iso = c.analysis?.deadlineIso ? new Date(c.analysis.deadlineIso) : null;
  const deadline = iso && !Number.isNaN(iso.getTime()) ? iso : c.tender.deadlineAt;
  if (!deadline) {
    c.missing.push("Date limite de remise des offres");
    return [0.5, "Date limite inconnue : note neutre."];
  }
  const days = Math.floor((deadline.getTime() - c.now.getTime()) / 86_400_000);
  if (days < 0) return [0, "Date limite dépassée."];
  const r = days < 7 ? 0.15 : days < 14 ? 0.5 : days < 21 ? 0.8 : 1;
  if (days < 10) c.weaknesses.push(`Délai de réponse court (${days} j)`);
  return [r, `${days} jour(s) avant la date limite.`];
}

function administrative(c: Ctx): [number, string] {
  if (!c.analysis) {
    c.missing.push("Pièces administratives exigées (DCE non analysé)");
    return [0.6, "DCE non analysé : note par défaut."];
  }
  const n = c.analysis.mandatoryDocuments.length;
  let r = n <= 5 ? 1 : n <= 10 ? 0.75 : n <= 15 ? 0.5 : 0.3;
  if (c.analysis.siteVisitMandatory) r -= 0.2;
  return [clamp(r), `${n} pièce(s) obligatoire(s)${c.analysis.siteVisitMandatory ? ", visite obligatoire" : ""}.`];
}

function contractual(c: Ctx): [number, string] {
  if (!c.analysis) {
    c.missing.push("Clauses contractuelles (CCAP non analysé)");
    return [0.6, "CCAP non analysé : note par défaut."];
  }
  const penalty = { high: 0.35, medium: 0.15, low: 0.05 } as const;
  const sum = c.analysis.risks.reduce((acc, r) => acc + penalty[r.severity], 0);
  const high = c.analysis.risks.filter((r) => r.severity === "high").length;
  return [clamp(1 - sum), `${c.analysis.risks.length} risque(s) identifié(s), dont ${high} élevé(s).`];
}

export function eliminatoryChecks(c: Omit<Ctx, "missing" | "strengths" | "weaknesses">): EliminatoryCheck[] {
  const { tender, profile, analysis, references, now } = c;
  const checks: EliminatoryCheck[] = [];
  const iso = analysis?.deadlineIso ? new Date(analysis.deadlineIso) : null;
  const deadline = iso && !Number.isNaN(iso.getTime()) ? iso : tender.deadlineAt;

  checks.push(
    !deadline
      ? { key: "deadline", label: "Date limite", status: "UNKNOWN", detail: "Date limite non précisée." }
      : deadline < now
        ? { key: "deadline", label: "Date limite", status: "FAIL", detail: "La date limite est dépassée." }
        : { key: "deadline", label: "Date limite", status: "PASS", detail: "Date limite non échue." },
  );

  checks.push(
    tender.noticeState === "CANCELLED"
      ? { key: "notice", label: "Statut de l'avis", status: "FAIL", detail: "Avis annulé par l'acheteur." }
      : tender.noticeState === "AWARDED"
        ? { key: "notice", label: "Statut de l'avis", status: "FAIL", detail: "Marché déjà attribué." }
        : { key: "notice", label: "Statut de l'avis", status: "PASS", detail: tender.noticeState === "MODIFIED" ? "Avis rectifié : vérifier les modifications." : "Avis actif." },
  );

  if (!profile) {
    checks.push({ key: "profile", label: "Profil entreprise", status: "UNKNOWN", detail: "Profil entreprise non renseigné." });
  } else {
    if (!tender.buyerCountry) {
      checks.push({ key: "country", label: "Zone d'éligibilité", status: "UNKNOWN", detail: "Pays de l'acheteur non précisé." });
    } else {
      const ok = profile.eligibleCountries.includes(tender.buyerCountry);
      checks.push({
        key: "country",
        label: "Zone d'éligibilité",
        status: ok ? "PASS" : "FAIL",
        detail: ok ? `Pays ${tender.buyerCountry} dans vos zones.` : `Pays ${tender.buyerCountry} hors de vos zones de candidature.`,
      });
    }
  }

  if (!analysis) {
    checks.push({
      key: "dce",
      label: "Conditions du DCE",
      status: "UNKNOWN",
      detail: "Conditions de participation non vérifiées : importer et analyser le DCE.",
    });
    return checks;
  }

  const certs = analysis.requiredCertifications;
  if (certs.length) {
    const missing = certs.filter((rc) => !(profile?.certifications ?? []).some((pc) => termMatches(rc.text, pc)));
    checks.push({
      key: "certifications",
      label: "Certifications obligatoires",
      status: missing.length ? "FAIL" : "PASS",
      detail: missing.length ? `Non détenues : ${missing.map((m) => m.text).join(" ; ")}` : "Toutes détenues.",
    });
  } else {
    checks.push({ key: "certifications", label: "Certifications obligatoires", status: "PASS", detail: "Aucune certification exigée identifiée." });
  }

  if (analysis.minAnnualRevenueEur !== null) {
    const rev = profile?.annualRevenueEur ?? null;
    checks.push({
      key: "revenue",
      label: "Chiffre d'affaires minimal",
      status: rev === null ? "UNKNOWN" : rev >= analysis.minAnnualRevenueEur ? "PASS" : "FAIL",
      detail:
        rev === null
          ? `Exigé : ${analysis.minAnnualRevenueEur.toLocaleString("fr-FR")} € ; CA de l'entreprise non renseigné.`
          : `Exigé : ${analysis.minAnnualRevenueEur.toLocaleString("fr-FR")} € ; déclaré : ${rev.toLocaleString("fr-FR")} €.`,
    });
  }

  if (analysis.minReferences !== null) {
    const count = references.filter((r) => r.isPublic).length;
    checks.push({
      key: "references",
      label: "Références minimales",
      status: count >= analysis.minReferences ? "PASS" : "FAIL",
      detail: `Exigé : ${analysis.minReferences} ; références citables : ${count}.`,
    });
  }

  if (analysis.siteVisitMandatory) {
    checks.push({ key: "visit", label: "Visite obligatoire", status: "WARN", detail: "Visite obligatoire à planifier avant la remise." });
  }

  if (analysis.injectionAttemptsDetected.length) {
    checks.push({
      key: "injection",
      label: "Contenu suspect dans le DCE",
      status: "WARN",
      detail: "Des passages tentent d'influencer l'IA : relecture humaine recommandée.",
    });
  }
  return checks;
}

export function computeScore(input: {
  tender: ScoringTender;
  profile: ScoringProfile | null;
  analysis: TenderAnalysisResult | null;
  references: ScoringReference[];
  now?: Date;
}): ScoreResult {
  const ctx: Ctx = {
    tender: input.tender,
    profile: input.profile,
    analysis: input.analysis,
    references: input.references,
    now: input.now ?? new Date(),
    missing: [],
    strengths: [],
    weaknesses: [],
  };
  const weights = resolveWeights(input.profile?.scoringWeights);
  const fns: Record<CriterionKey, (c: Ctx) => [number, string]> = {
    technical,
    capabilities,
    financial,
    schedule,
    administrative,
    contractual,
  };

  const breakdown = CRITERIA.map(({ key, label }) => {
    const [ratio, rationale] = fns[key](ctx);
    return { key, label, weight: Math.round(weights[key] * 10) / 10, ratio, points: Math.round(ratio * weights[key] * 10) / 10, rationale };
  });
  const total = Math.round(breakdown.reduce((a, b) => a + b.ratio * weights[b.key], 0));
  const eliminatory = eliminatoryChecks(ctx);

  const failed = eliminatory.filter((e) => e.status === "FAIL");
  const unknown = eliminatory.filter((e) => e.status === "UNKNOWN");
  let recommendation: RecommendationT;
  if (failed.length) recommendation = "NO_GO";
  else if (total < 40) recommendation = "NO_GO";
  else if (unknown.length || total < 60) recommendation = "TO_VERIFY";
  else recommendation = "GO";

  const level = scoreLevel(total);
  const parts = [`Score ${total}/100 (${LEVEL_LABELS[level]}).`];
  if (failed.length) parts.push(`Critère(s) éliminatoire(s) non satisfait(s) : ${failed.map((f) => f.label).join(", ")} — NO-GO quel que soit le score.`);
  else if (unknown.length) parts.push(`À vérifier avant décision : ${unknown.map((u) => u.label).join(", ")}.`);
  const best = [...breakdown].sort((a, b) => b.ratio - a.ratio)[0];
  const worst = [...breakdown].sort((a, b) => a.ratio - b.ratio)[0];
  parts.push(`Point le plus favorable : ${best.label.toLowerCase()} ; point le plus faible : ${worst.label.toLowerCase()}.`);

  return {
    total,
    level,
    breakdown,
    eliminatory,
    recommendation,
    strengths: ctx.strengths,
    weaknesses: ctx.weaknesses,
    missingInfo: [...new Set(ctx.missing)],
    risks: (input.analysis?.risks ?? []).map((r) => `[${r.severity === "high" ? "élevé" : r.severity === "medium" ? "moyen" : "faible"}] ${r.text}`),
    justification: parts.join(" "),
    weights,
  };
}
