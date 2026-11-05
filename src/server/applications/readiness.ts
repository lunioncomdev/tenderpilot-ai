import type { ComplianceStatus, SectionStatus, TenderStatus } from "@prisma/client";
import { formatDateTime } from "@/lib/utils";
import { isCoveredByProfile, linkCompanyDocs, type PieceDocs } from "../company/documents";
import { prisma } from "../db";
import { NotFoundError } from "../auth/rbac";
import { loadPricing } from "../pricing/pricing-service";
import { planDossier, type DossierCompanyDoc, type DossierLot, type DossierPiece, type DossierPricing } from "./dossier-export";
import { compareLotNumbers, visiblePieces } from "./lots";

/**
 * Contrôle « prêt à déposer » : tout ce qui empêcherait un dépôt complet et
 * recevable. Un point bloquant interdit le passage à « Prêt à déposer » ou
 * « Déposée » (sauf dérogation motivée d'un administrateur).
 */

export type CheckLevel = "ok" | "warning" | "blocker";
export type ReadinessCheck = { key: string; label: string; level: CheckLevel; summary: string; details: string[] };
export type Readiness = { ready: boolean; blockers: number; warnings: number; checks: ReadinessCheck[] };

/** Statuts protégés par le contrôle. */
export const GUARDED_STATUSES: TenderStatus[] = ["READY_TO_SUBMIT", "SUBMITTED"];

const DAY = 86_400_000;
/** Marqueurs laissés par la rédaction assistée, à lever avant le dépôt. */
const MARKER = /\[À COMPLÉTER[^\]]*\]|\[À VALIDER\]/g;

export function countMarkers(text: string): number {
  return text.match(MARKER)?.length ?? 0;
}

export type ReadinessInput = {
  now: Date;
  deadline: Date | null;
  lotsTotal: number;
  lots: DossierLot[];
  /** Pièces à fournir (déjà filtrées selon les lots retenus). */
  pieces: Array<DossierPiece & { profile: PieceDocs | null }>;
  companyDocs: DossierCompanyDoc[];
  proposals: Array<{
    id: string;
    lotId: string | null;
    sections: Array<{ title: string; status: SectionStatus; markers: number }>;
    compliance: Array<{ status: ComplianceStatus }>;
  }>;
  pricings: Array<DossierPricing & { lines: number }>;
};

const scope = (lots: DossierLot[], lotId: string | null) => {
  const lot = lotId ? lots.find((l) => l.id === lotId) : undefined;
  return lot ? ` (lot ${lot.number})` : "";
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

export function evaluateReadiness(input: ReadinessInput): Readiness {
  const checks: ReadinessCheck[] = [];
  const required = input.pieces.filter((p) => p.status !== "NOT_APPLICABLE");

  // 1. Date limite
  {
    const details: string[] = [];
    let level: CheckLevel = "ok";
    let summary: string;
    if (!input.deadline) {
      level = "warning";
      summary = "Date limite de remise inconnue : vérifiez-la dans le règlement de la consultation.";
    } else {
      const left = input.deadline.getTime() - input.now.getTime();
      if (left <= 0) {
        level = "blocker";
        summary = `Date limite dépassée (${formatDateTime(input.deadline)}).`;
      } else if (left < 2 * DAY) {
        level = "warning";
        summary = `Moins de 48 h avant la date limite (${formatDateTime(input.deadline)}) : prévoyez le temps de téléversement et de signature.`;
      } else {
        summary = `Date limite : ${formatDateTime(input.deadline)}.`;
      }
    }
    checks.push({ key: "deadline", label: "Date limite", level, summary, details });
  }

  // 2. Lots
  if (input.lotsTotal > 0) {
    checks.push(
      input.lots.length
        ? { key: "lots", label: "Lots", level: "ok", summary: `${plural(input.lots.length, "lot retenu")} : ${input.lots.map((l) => l.number).join(", ")}.`, details: [] }
        : { key: "lots", label: "Lots", level: "blocker", summary: "Consultation allotie : aucun lot retenu.", details: [] },
    );
  }

  // 3. Pièces du dossier
  {
    const pending = required.filter((p) => p.status !== "DONE");
    checks.push({
      key: "pieces",
      label: "Pièces du dossier",
      level: pending.length ? "blocker" : "ok",
      summary: pending.length ? `${plural(pending.length, "pièce")} non prête(s) sur ${required.length}.` : `${plural(required.length, "pièce")} prête(s).`,
      details: pending.map((p) => `${p.label}${scope(input.lots, p.lotId)} — ${p.status === "TODO" ? "à faire" : "en cours"}`),
    });
  }

  // 4. Validité des pièces administratives (hors pièces avec un fichier propre à la consultation)
  {
    const details: string[] = [];
    for (const p of required) {
      if (p.files.length || !p.profile) continue;
      for (const d of p.profile.docs) {
        if (d.alert === "expired") details.push(`${d.label} : expirée`);
        else if (d.alert === "before-deadline") details.push(`${d.label} : expire avant la date limite`);
      }
      if (p.key !== "dc2" && !isCoveredByProfile(p.profile)) for (const m of p.profile.missing) details.push(`${m} : absente du profil (pièce « ${p.label} »)`);
    }
    const unique = [...new Set(details)];
    checks.push({
      key: "validity",
      label: "Validité des pièces administratives",
      level: unique.length ? "blocker" : "ok",
      summary: unique.length ? `${plural(unique.length, "pièce administrative")} à mettre à jour dans le profil entreprise.` : "Pièces du profil présentes et valables à la date limite.",
      details: unique,
    });
  }

  // 5. Mémoire technique
  {
    const memoires = required.filter((p) => p.key === "memoire");
    const blockers: string[] = [];
    let sections = 0;
    let validated = 0;
    let uploaded = 0;
    for (const m of memoires) {
      // Mémoire rédigé hors de l'application et joint en fichier : il remplace le mémoire généré.
      if (m.files.length) {
        uploaded++;
        continue;
      }
      const proposal = input.proposals.find((x) => x.lotId === m.lotId);
      const where = scope(input.lots, m.lotId);
      if (!proposal) {
        blockers.push(`Mémoire technique${where} non créé`);
        continue;
      }
      sections += proposal.sections.length;
      for (const s of proposal.sections) {
        if (s.status === "VALIDATED") validated++;
        else blockers.push(`« ${s.title} »${where} : section non validée`);
        if (s.markers) blockers.push(`« ${s.title} »${where} : ${plural(s.markers, "marqueur")} [À COMPLÉTER] / [À VALIDER] restant(s)`);
      }
    }
    if (memoires.length) {
      checks.push({
        key: "memoire",
        label: "Mémoire technique",
        level: blockers.length ? "blocker" : "ok",
        summary: blockers.length
          ? `${validated} / ${sections} section(s) validée(s), ${plural(blockers.length, "point")} à traiter.`
          : uploaded === memoires.length
            ? "Mémoire technique fourni sous forme de fichier."
            : `${plural(sections, "section")} validée(s), sans marqueur restant${uploaded ? ` ; ${plural(uploaded, "mémoire")} fourni(s) en fichier` : ""}.`,
        details: blockers,
      });
    }
  }

  // 6. Matrice de conformité (avertissement : à arbitrer par l'équipe)
  {
    const items = input.proposals
      .filter((p) => (input.lots.length ? p.lotId !== null && input.lots.some((l) => l.id === p.lotId) : p.lotId === null))
      .flatMap((p) => p.compliance.map((c) => ({ ...c, lotId: p.lotId })));
    if (items.length) {
      const count = (s: ComplianceStatus) => items.filter((i) => i.status === s).length;
      const details = [
        count("NON_COMPLIANT") && `${plural(count("NON_COMPLIANT"), "exigence")} non conforme(s) : risque d'offre irrégulière`,
        count("PARTIAL") && `${plural(count("PARTIAL"), "exigence")} partiellement couverte(s)`,
        count("TO_VERIFY") && `${plural(count("TO_VERIFY"), "exigence")} à vérifier`,
      ].filter((d): d is string => !!d);
      checks.push({
        key: "compliance",
        label: "Matrice de conformité",
        level: details.length ? "warning" : "ok",
        summary: details.length ? `${count("COMPLIANT")} / ${items.length} exigence(s) conforme(s).` : `${plural(items.length, "exigence")} conforme(s).`,
        details,
      });
    }
  }

  // 7. Chiffrage
  {
    const prix = required.filter((p) => p.key === "prix");
    const details: string[] = [];
    const warn: string[] = [];
    const lotIds = new Set(input.lots.map((l) => l.id));
    for (const p of prix) {
      if (p.files.length) continue; // offre financière fournie sous forme de fichier
      const relevant = input.pricings.filter((pr) => !input.lots.length || input.lots.length === 1 || pr.lotId === p.lotId);
      for (const pr of relevant) {
        if (pr.priced < pr.lines) details.push(`${pr.filename}${scope(input.lots, p.lotId)} : ${plural(pr.lines - pr.priced, "ligne")} non chiffrée(s)`);
      }
    }
    if (input.lots.length > 1) {
      for (const pr of input.pricings) if (!pr.lotId || !lotIds.has(pr.lotId)) warn.push(`${pr.filename} : bordereau rattaché à aucun lot retenu`);
    }
    if (input.pricings.length || prix.length) {
      checks.push({
        key: "pricing",
        label: "Chiffrage",
        level: details.length ? "blocker" : warn.length ? "warning" : "ok",
        summary: details.length ? "Bordereau(x) incomplet(s)." : warn.length ? "Bordereau(x) à rattacher à un lot." : input.pricings.length ? "Bordereaux entièrement chiffrés." : "Offre financière fournie hors chiffrage.",
        details: [...details, ...warn],
      });
    }
  }

  // 8. Contenu du dossier ZIP : pièces « prêtes » sans aucun fichier exporté
  {
    const plan = planDossier({ pieces: required, companyDocs: input.companyDocs, deadline: input.deadline, proposals: input.proposals, pricings: input.pricings, lots: input.lots, now: input.now });
    const empty = plan.summary.filter((s) => s.status === "DONE" && !s.files.length);
    checks.push({
      key: "files",
      label: "Fichiers du dossier",
      level: empty.length ? "warning" : "ok",
      summary: empty.length
        ? `${plural(empty.length, "pièce")} marquée(s) prête(s) sans fichier dans l'application : à joindre, ou à déposer séparément.`
        : `${plural(plan.entries.length, "fichier")} dans le dossier ZIP.`,
      details: empty.map((s) => `${s.label}${scope(input.lots, s.lotId)}`),
    });
  }

  const blockers = checks.filter((c) => c.level === "blocker").length;
  const warnings = checks.filter((c) => c.level === "warning").length;
  return { ready: blockers === 0, blockers, warnings, checks };
}

/** Données du contrôle pour une consultation. */
export async function loadReadiness(orgId: string, tenderId: string, now = new Date()): Promise<Readiness> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, organizationId: orgId },
    include: {
      lots: { select: { id: true, number: true, title: true, selected: true } },
      pieces: { orderBy: [{ order: "asc" }, { createdAt: "asc" }], include: { files: { select: { filename: true, storageKey: true } } } },
      proposals: {
        select: {
          id: true, lotId: true,
          sections: { orderBy: { order: "asc" }, select: { title: true, status: true, content: true } },
          compliance: { select: { status: true } },
        },
      },
    },
  });
  if (!tender) throw new NotFoundError("Appel d'offres introuvable");
  const [companyDocs, pricingRows] = await Promise.all([
    prisma.companyDocument.findMany({ where: { organizationId: orgId }, select: { id: true, type: true, label: true, filename: true, storageKey: true, validUntil: true } }),
    prisma.pricing.findMany({ where: { tenderId, organizationId: orgId }, select: { id: true, lotId: true, document: { select: { filename: true } } } }),
  ]);
  const pricings = await Promise.all(
    pricingRows.map(async (p) => {
      const { totals } = await loadPricing(orgId, p.id);
      return { id: p.id, filename: p.document.filename, lotId: p.lotId, lines: totals.lines, priced: totals.priced, missing: totals.lines - totals.priced };
    }),
  );
  const lots = tender.lots.filter((l) => l.selected).sort((a, b) => compareLotNumbers(a.number, b.number));
  const pieces = visiblePieces(tender.pieces, lots.map((l) => l.id)).map((p) => ({ ...p, profile: linkCompanyDocs(p, companyDocs, tender.deadlineAt, now) }));
  return evaluateReadiness({
    now,
    deadline: tender.deadlineAt,
    lotsTotal: tender.lots.length,
    lots,
    pieces,
    companyDocs,
    proposals: tender.proposals.map((p) => ({
      id: p.id,
      lotId: p.lotId,
      sections: p.sections.map((s) => ({ title: s.title, status: s.status, markers: countMarkers(s.content) })),
      compliance: p.compliance,
    })),
    pricings,
  });
}

/** Résumé court des points bloquants (message d'erreur, journal d'audit). */
export function blockerSummary(r: Readiness): string {
  return r.checks.filter((c) => c.level === "blocker").map((c) => `${c.label} : ${c.summary}`).join(" · ");
}

export type StatusGuard = { allowed: true; overridden: Readiness | null } | { allowed: false; error: string };

/**
 * Règle du workflow : « Prête à déposer » et « Déposée » exigent un dossier sans
 * point bloquant, sauf dérogation motivée d'un administrateur.
 */
export async function guardStatusChange(
  orgId: string,
  tenderId: string,
  change: { from: TenderStatus; to: TenderStatus },
  opts: { override: boolean; reason: string; isAdmin: boolean },
): Promise<StatusGuard> {
  if (change.from === change.to || !GUARDED_STATUSES.includes(change.to)) return { allowed: true, overridden: null };
  const readiness = await loadReadiness(orgId, tenderId);
  if (readiness.ready) return { allowed: true, overridden: null };
  if (!opts.override) return { allowed: false, error: `Dépôt bloqué — ${readiness.blockers} point(s) à traiter : ${blockerSummary(readiness)}` };
  if (!opts.isAdmin) return { allowed: false, error: "Seul un administrateur peut passer outre le contrôle avant dépôt." };
  if (opts.reason.trim().length < 10) return { allowed: false, error: "Motivez la dérogation (10 caractères au moins)." };
  return { allowed: true, overridden: readiness };
}
