import type { CompanyDocType } from "@prisma/client";
import { normalizeText } from "@/lib/utils";

/** Libellé et durée de validité usuelle (en mois après délivrance ; null = sans échéance). */
export const COMPANY_DOC_TYPES: Record<CompanyDocType, { label: string; validityMonths: number | null }> = {
  KBIS: { label: "Extrait Kbis", validityMonths: 3 },
  URSSAF: { label: "Attestation de vigilance URSSAF", validityMonths: 6 },
  FISCALE: { label: "Attestation de régularité fiscale", validityMonths: 12 },
  ASSURANCE_RC: { label: "Attestation d'assurance RC professionnelle", validityMonths: 12 },
  RIB: { label: "RIB", validityMonths: null },
  DC2: { label: "Déclaration du candidat (DC2) pré-remplie", validityMonths: null },
  BILANS: { label: "Bilans / chiffre d'affaires", validityMonths: 12 },
  REFERENCES: { label: "Attestations de références", validityMonths: null },
  CERTIFICATION: { label: "Certificat / qualification", validityMonths: null },
  POUVOIR: { label: "Pouvoir du signataire", validityMonths: null },
  AUTRE: { label: "Autre pièce", validityMonths: null },
};

/** Délai d'alerte avant expiration. */
export const EXPIRY_WARNING_DAYS = 30;
const DAY = 86_400_000;

/** Date de fin de validité : saisie explicite, sinon déduite de la date de délivrance. */
export function defaultValidUntil(type: CompanyDocType, issuedAt: Date | null): Date | null {
  const months = COMPANY_DOC_TYPES[type].validityMonths;
  if (!issuedAt || months === null) return null;
  const d = new Date(issuedAt);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export type Validity = "none" | "valid" | "expiring" | "expired";

export function validityOf(validUntil: Date | string | null, now = new Date()): Validity {
  if (!validUntil) return "none";
  const t = new Date(validUntil).getTime();
  if (t < now.getTime()) return "expired";
  if (t - now.getTime() <= EXPIRY_WARNING_DAYS * DAY) return "expiring";
  return "valid";
}

export type PieceDocAlert = "missing" | "expired" | "before-deadline" | "expiring" | null;

/**
 * Alerte d'une pièce du profil pour un dossier : expirée, ou qui ne sera plus
 * valable à la date limite de remise des offres.
 */
export function pieceDocAlert(validUntil: Date | string | null, deadline: Date | string | null, now = new Date()): PieceDocAlert {
  const v = validityOf(validUntil, now);
  if (v === "expired") return "expired";
  if (validUntil && deadline && new Date(validUntil).getTime() < new Date(deadline).getTime()) return "before-deadline";
  return v === "expiring" ? "expiring" : null;
}

/** Pièces du profil qui justifient chaque pièce usuelle du dossier de candidature. */
export function docTypesForPiece(key: string): CompanyDocType[] {
  if (key.startsWith("cert-")) return ["CERTIFICATION"];
  const map: Record<string, CompanyDocType[]> = {
    dc2: ["DC2"],
    kbis: ["KBIS"],
    attestations: ["URSSAF", "FISCALE"],
    assurance: ["ASSURANCE_RC"],
    capacites: ["BILANS"],
    references: ["REFERENCES"],
    pouvoir: ["POUVOIR"],
    rib: ["RIB"],
  };
  return map[key] ?? [];
}

export type LinkedDoc = { id: string; label: string; filename: string; validUntil: string | null; alert: PieceDocAlert };
export type PieceDocs = { docs: LinkedDoc[]; missing: string[] };

/**
 * Pièces du profil rattachées à une pièce du dossier, avec leur alerte au regard
 * de la date limite. null si la pièce ne relève pas du profil (AE, mémoire…).
 * Une certification n'est rattachée qu'à la pièce du profil de même intitulé.
 */
export function linkCompanyDocs(
  piece: { key: string; detail: string },
  docs: Array<{ id: string; type: CompanyDocType; label: string; filename: string; validUntil: Date | null }>,
  deadline: Date | null,
  now = new Date(),
): PieceDocs | null {
  const types = docTypesForPiece(piece.key);
  if (!types.length) return null;
  const wanted = normalizeText(piece.detail);
  const matches = (d: { type: CompanyDocType; label: string }) => {
    if (!types.includes(d.type)) return false;
    if (d.type !== "CERTIFICATION") return true;
    const l = normalizeText(d.label);
    return !!l && !!wanted && (wanted.includes(l) || l.includes(wanted));
  };
  const linked = docs.filter(matches);
  return {
    docs: linked.map((d) => ({ id: d.id, label: d.label, filename: d.filename, validUntil: d.validUntil?.toISOString() ?? null, alert: pieceDocAlert(d.validUntil, deadline, now) })),
    missing: types.filter((t) => !linked.some((d) => d.type === t)).map((t) => COMPANY_DOC_TYPES[t].label),
  };
}

/** Pièce couverte par le profil : toutes les pièces attendues présentes et valables à la date limite. */
export function isCoveredByProfile(profile: PieceDocs | null): boolean {
  return !!profile && profile.docs.length > 0 && profile.missing.length === 0
    && profile.docs.every((d) => d.alert !== "expired" && d.alert !== "before-deadline");
}
