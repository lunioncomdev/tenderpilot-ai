import type { PieceGroup, PieceStatus, TenderStatus } from "@prisma/client";
import { normalizeText } from "@/lib/utils";
import type { TenderAnalysisResult, VerifiedSourceRef } from "../analysis/schema";

/** Statuts depuis lesquels on peut décider de candidater. */
export const PRE_APPLICATION_STATUSES: TenderStatus[] = ["DETECTED", "TO_ANALYZE", "QUALIFIED", "GO", "NO_GO"];
/** Statuts d'une candidature engagée (suivie dans « Mes candidatures »). */
export const APPLICATION_STATUSES: TenderStatus[] = ["IN_PREPARATION", "IN_VALIDATION", "READY_TO_SUBMIT", "SUBMITTED", "AWAITING_DECISION", "WON", "LOST"];

export type PlannedPiece = {
  key: string;
  group: PieceGroup;
  label: string;
  detail: string;
  source: string;
  fromDce: boolean;
};

type Standard = { key: string; group: PieceGroup; label: string; match: RegExp; when?: (ctx: Ctx) => boolean };
type Ctx = { analysis: TenderAnalysisResult | null };

/**
 * Pièces usuelles d'une réponse à un marché public français. Les pièces citées
 * par le DCE y sont rattachées par mots-clés (texte normalisé, sans accents) ;
 * celles qui ne correspondent à aucune pièce usuelle sont ajoutées telles quelles.
 */
export const STANDARD_PIECES: Standard[] = [
  { key: "dc1", group: "CANDIDATURE", label: "Lettre de candidature (DC1) ou DUME", match: /\bdc ?1\b|lettre de candidature|\bdume\b|document unique de marche/ },
  { key: "dc2", group: "CANDIDATURE", label: "Déclaration du candidat (DC2)", match: /\bdc ?2\b|declaration du candidat/ },
  { key: "kbis", group: "CANDIDATURE", label: "Extrait Kbis de moins de 3 mois", match: /kbis|registre du commerce|registre des metiers|extrait k\b/ },
  { key: "attestations", group: "CANDIDATURE", label: "Attestations de régularité fiscale et sociale (URSSAF)", match: /urssaf|regularite fiscale|attestation(s)? fiscale|obligations (fiscales|sociales)|attestation de vigilance/ },
  { key: "assurance", group: "CANDIDATURE", label: "Attestation d'assurance responsabilité civile professionnelle", match: /assurance|responsabilite civile/ },
  { key: "capacites", group: "CANDIDATURE", label: "Capacités financières : chiffre d'affaires des 3 derniers exercices", match: /chiffre d affaires|bilans?\b|capacites? (economiques? et )?financieres?/ },
  { key: "references", group: "CANDIDATURE", label: "Références similaires des 3 dernières années", match: /references?|attestations? de bonne execution|certificats? de capacite/ },
  { key: "moyens", group: "CANDIDATURE", label: "Moyens humains et techniques, CV des intervenants", match: /moyens humains|moyens techniques|effectifs?|\bcv\b|curriculum/ },
  { key: "pouvoir", group: "CANDIDATURE", label: "Pouvoir du signataire", match: /pouvoir|habilitation|delegation de signature/ },
  { key: "ae", group: "OFFRE", label: "Acte d'engagement complété et signé", match: /acte d engagement|\bae\b|attri ?1/ },
  { key: "prix", group: "OFFRE", label: "Offre financière (BPU / DPGF / DQE)", match: /\bbpu\b|bordereau|\bdpgf\b|decomposition (globale )?du prix|\bdqe\b|detail quantitatif|offre financiere|\bprix\b|devis/ },
  { key: "memoire", group: "OFFRE", label: "Mémoire technique", match: /memoire|note methodologique|cadre de reponse|offre technique/ },
  { key: "cahiers", group: "OFFRE", label: "CCAP et CCTP acceptés (signés si demandé)", match: /\bccap\b|\bcctp\b|cahiers? des clauses/ },
  { key: "rib", group: "OFFRE", label: "Relevé d'identité bancaire (RIB)", match: /\brib\b|releve d identite bancaire/ },
  { key: "visite", group: "OFFRE", label: "Attestation de visite", match: /visite/, when: (c) => c.analysis?.siteVisitMandatory === true },
];

const OFFER_HINT = /offre|acte d engagement|prix|\bbpu\b|\bdpgf\b|\bdqe\b|memoire|technique|planning|devis|annexe financiere/;

function cite(sources: VerifiedSourceRef[]): string {
  return sources
    .map((s) => (s.filename ? `${s.filename}${s.pageStart ? ` p.${s.pageStart}` : ""}` : s.chunkId))
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(" ; ");
}

/** Liste ordonnée des pièces du dossier : usuelles, enrichies et complétées par le DCE. */
export function planApplicationPieces(analysis: TenderAnalysisResult | null): PlannedPiece[] {
  const ctx: Ctx = { analysis };
  const standards = STANDARD_PIECES.filter((s) => !s.when || s.when(ctx));
  const planned = new Map<string, PlannedPiece>(
    standards.map((s) => [s.key, { key: s.key, group: s.group, label: s.label, detail: "", source: "", fromDce: false }]),
  );
  const extra: PlannedPiece[] = [];
  const append = (p: PlannedPiece, text: string, source: string) => {
    p.detail = p.detail ? `${p.detail} ; ${text}` : text;
    p.source = [p.source, source].filter(Boolean).join(" ; ");
    p.fromDce = true;
  };

  (analysis?.requiredCertifications ?? []).forEach((c, i) => {
    extra.push({ key: `cert-${i + 1}`, group: "CANDIDATURE", label: `Certification exigée : ${c.text}`.slice(0, 250), detail: c.text, source: cite(c.sources as VerifiedSourceRef[]), fromDce: true });
  });

  (analysis?.mandatoryDocuments ?? []).forEach((d, i) => {
    const text = d.text.trim();
    if (!text) return;
    const norm = normalizeText(text);
    const source = cite(d.sources as VerifiedSourceRef[]);
    const std = standards.find((s) => s.match.test(norm));
    if (std) return append(planned.get(std.key)!, text, source);
    extra.push({ key: `dce-${i + 1}`, group: OFFER_HINT.test(norm) ? "OFFRE" : "CANDIDATURE", label: text.slice(0, 250), detail: text, source, fromDce: true });
  });

  const all = [...planned.values(), ...extra];
  return [...all.filter((p) => p.group === "CANDIDATURE"), ...all.filter((p) => p.group === "OFFRE")];
}

/** Avancement : pièces prêtes sur pièces requises (les pièces « non requises » sont exclues). */
export function pieceProgress(pieces: Array<{ status: PieceStatus }>): { done: number; total: number } {
  const required = pieces.filter((p) => p.status !== "NOT_APPLICABLE");
  return { done: required.filter((p) => p.status === "DONE").length, total: required.length };
}
