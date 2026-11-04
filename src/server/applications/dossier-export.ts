import JSZip from "jszip";
import type { CompanyDocType, PieceGroup, PieceStatus } from "@prisma/client";
import { formatDate } from "@/lib/utils";
import type { TenderAnalysisResult } from "../analysis/schema";
import { NotFoundError } from "../auth/rbac";
import { linkCompanyDocs, type PieceDocAlert } from "../company/documents";
import { prisma } from "../db";
import { storage } from "../documents/storage";
import { exportFilledTemplate, loadPricing } from "../pricing/pricing-service";
import { exportProposalDocx } from "../proposals/proposal-export";
import { countTodos, formContent, renderFormDocx, type FormContext, type FormKind } from "./forms-docx";
import { compareLotNumbers, lotLabel, visiblePieces } from "./lots";

// ── Plan du dossier (pur, testé unitairement) ──────────────────────────────

export type DossierPiece = {
  key: string;
  group: PieceGroup;
  label: string;
  detail: string;
  status: PieceStatus;
  /** Lot de la pièce (null : commune). */
  lotId: string | null;
  files: Array<{ filename: string; storageKey: string }>;
};

export type DossierCompanyDoc = { id: string; type: CompanyDocType; label: string; filename: string; storageKey: string; validUntil: Date | null };

export type DossierSource =
  | { kind: "storage"; storageKey: string }
  | { kind: "generated"; what: FormKind }
  | { kind: "memoire"; proposalId: string }
  | { kind: "pricing"; pricingId: string };

/** Bordereau de prix chiffré dans l'application. */
export type DossierPricing = { id: string; filename: string; lotId: string | null; priced: number; missing: number };

/** Lot retenu (ordre des dossiers « Lot_… » dans le ZIP). */
export type DossierLot = { id: string; number: string; title: string };

export type DossierEntry = { path: string; source: DossierSource };

export type DossierSummaryItem = {
  group: PieceGroup;
  /** Dossier du ZIP : « 01_Candidature », « 02_Offre » ou « 02_Offre/Lot_2_TMA ». */
  folder: string;
  lotId: string | null;
  number: string;
  label: string;
  status: PieceStatus;
  files: string[];
  issues: string[];
};

export type DossierPlan = { entries: DossierEntry[]; summary: DossierSummaryItem[] };

export const GROUP_FOLDER: Record<PieceGroup, string> = { CANDIDATURE: "01_Candidature", OFFRE: "02_Offre" };

const ALERT_ISSUE: Partial<Record<NonNullable<PieceDocAlert>, string>> = {
  expired: "expirée — non incluse",
  "before-deadline": "expire avant la date limite — non incluse",
};

/** Nom de fichier sûr pour les plateformes de dépôt : ASCII, sans espaces ni caractères spéciaux. */
export function safeName(s: string, max = 60): string {
  const out = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[œŒ]/g, "oe")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max)
    .replace(/_+$/g, "");
  return out || "piece";
}

function extOf(filename: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(filename);
  return m ? `.${m[1].toLowerCase()}` : "";
}

function baseOf(filename: string): string {
  return filename.replace(/\.[A-Za-z0-9]{1,8}$/, "");
}

/**
 * Compose le dossier à déposer, pièce par pièce, dans l'ordre de la liste :
 * 1. les fichiers joints à la pièce pour cette consultation ;
 * 2. à défaut, les pièces du profil encore valables à la date limite ;
 * 3. à défaut, un document généré (DC1, DC2, mémoire technique, bordereau chiffré).
 * Les pièces « Non requise » sont ignorées ; tout manque est signalé dans le sommaire.
 * Les pièces d'un lot vont dans « 02_Offre/Lot_<n>_<intitulé> ». Les pièces passées
 * sont celles à fournir (voir `visiblePieces`).
 */
export function planDossier(input: {
  pieces: DossierPiece[];
  companyDocs: DossierCompanyDoc[];
  deadline: Date | null;
  /** Mémoires techniques existants, par lot (lotId null : commun). */
  proposals: Array<{ id: string; lotId: string | null }>;
  pricings?: DossierPricing[];
  lots?: DossierLot[];
  now?: Date;
}): DossierPlan {
  const entries: DossierEntry[] = [];
  const summary: DossierSummaryItem[] = [];
  const counters = new Map<string, number>();
  const lots = input.lots ?? [];
  const lotIds = new Set(lots.map((l) => l.id));
  const folderOf = (p: DossierPiece) => {
    const lot = p.lotId ? lots.find((l) => l.id === p.lotId) : undefined;
    return lot ? `${GROUP_FOLDER.OFFRE}/${safeName(`Lot_${lot.number}${lot.title ? `_${lot.title}` : ""}`, 50)}` : GROUP_FOLDER[p.group];
  };
  const rank = (p: DossierPiece) => (p.group === "CANDIDATURE" ? -1 : p.lotId ? lots.findIndex((l) => l.id === p.lotId) : -0.5);
  const ordered = input.pieces.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p);
  const pricingsFor = (lotId: string | null) => {
    const all = (input.pricings ?? []).filter((p) => p.priced > 0);
    if (!lots.length) return { included: all, orphans: [] };
    const orphans = all.filter((p) => !p.lotId || !lotIds.has(p.lotId));
    // Un seul lot retenu : les bordereaux non rattachés lui reviennent.
    if (lots.length === 1) return { included: all, orphans: [] };
    return { included: all.filter((p) => p.lotId === lotId), orphans };
  };

  for (const piece of ordered) {
    if (piece.status === "NOT_APPLICABLE") continue;
    const folder = folderOf(piece);
    const n = (counters.get(folder) ?? 0) + 1;
    counters.set(folder, n);
    const number = String(n).padStart(2, "0");
    const stem = `${number}_${safeName(piece.label)}`;
    const issues: string[] = [];
    const sources: Array<{ name: string; ext: string; source: DossierSource }> = [];

    if (piece.files.length) {
      for (const f of piece.files) sources.push({ name: baseOf(f.filename), ext: extOf(f.filename), source: { kind: "storage", storageKey: f.storageKey } });
    } else {
      const linked = linkCompanyDocs(piece, input.companyDocs, input.deadline, input.now);
      if (linked) {
        for (const d of linked.docs) {
          const issue = d.alert ? ALERT_ISSUE[d.alert] : undefined;
          if (issue) {
            issues.push(`${d.label} : ${issue}`);
            continue;
          }
          const doc = input.companyDocs.find((c) => c.id === d.id)!;
          sources.push({ name: doc.label || baseOf(doc.filename), ext: extOf(doc.filename), source: { kind: "storage", storageKey: doc.storageKey } });
        }
      }
      const form: FormKind | null = piece.key === "dc1" ? "dc1" : piece.key === "dc2" && !sources.length ? "dc2" : null;
      if (form) {
        sources.push({ name: `${form.toUpperCase()}_pre-rempli`, ext: ".docx", source: { kind: "generated", what: form } });
        issues.push("généré pré-rempli : compléter, vérifier et signer");
      }
      if (linked && !form) {
        for (const m of linked.missing) issues.push(`absente du profil : ${m}`);
      }
      if (piece.key === "memoire") {
        const proposal = input.proposals.find((p) => p.lotId === piece.lotId);
        if (proposal) {
          sources.push({ name: "Memoire_technique", ext: ".docx", source: { kind: "memoire", proposalId: proposal.id } });
          issues.push("généré depuis l'application : vérifier la mise en page");
        } else {
          issues.push(piece.lotId ? "mémoire technique du lot non créé" : "mémoire technique non créé");
        }
      }
      if (piece.key === "prix") {
        const { included, orphans } = pricingsFor(piece.lotId);
        for (const pr of included) {
          sources.push({ name: `${baseOf(pr.filename)}_complete`, ext: ".xlsx", source: { kind: "pricing", pricingId: pr.id } });
          issues.push(pr.missing ? `${pr.filename} : ${pr.missing} ligne(s) non chiffrée(s)` : `${pr.filename} : rempli depuis le chiffrage, vérifier les totaux`);
        }
        for (const pr of orphans) issues.push(`${pr.filename} : bordereau non rattaché à un lot retenu — non inclus`);
      }
      if (!sources.length && !issues.length) issues.push("aucun fichier joint");
    }
    if (piece.status !== "DONE") issues.push(`statut « ${piece.status === "TODO" ? "À faire" : "En cours"} »`);

    const files: string[] = [];
    if (sources.length === 1) {
      files.push(`${folder}/${stem}${sources[0].ext}`);
    } else {
      const used = new Set<string>();
      for (const s of sources) {
        let name = safeName(s.name, 80);
        for (let k = 2; used.has(`${name}${s.ext}`); k++) name = `${safeName(s.name, 76)}_${k}`;
        used.add(`${name}${s.ext}`);
        files.push(`${folder}/${stem}/${name}${s.ext}`);
      }
    }
    sources.forEach((s, i) => entries.push({ path: files[i], source: s.source }));
    summary.push({ group: piece.group, folder, lotId: piece.lotId, number, label: piece.label, status: piece.status, files, issues });
  }
  return { entries, summary };
}

/** Sommaire texte placé à la racine du ZIP. */
export function dossierSummaryText(input: {
  title: string;
  buyer: string;
  reference: string;
  deadline: Date | null;
  companyName: string;
  generatedAt: Date;
  summary: DossierSummaryItem[];
  lots?: DossierLot[];
}): string {
  const out: string[] = [
    "DOSSIER DE RÉPONSE",
    "==================",
    "",
    `Consultation : ${input.title}`,
    `Acheteur     : ${input.buyer || "non précisé"}`,
    `Référence    : ${input.reference}`,
    `Date limite  : ${input.deadline ? formatDate(input.deadline) : "non précisée"}`,
    `Candidat     : ${input.companyName}`,
    `Généré le    : ${formatDate(input.generatedAt)}`,
    ...(input.lots?.length ? [`Lots retenus : ${input.lots.map((l) => lotLabel(l)).join(" ; ")}`] : []),
    "",
  ];
  const toCheck = input.summary.filter((s) => s.issues.length).length;
  out.push(toCheck ? `⚠ ${toCheck} pièce(s) à vérifier avant le dépôt (voir ci-dessous).` : "Toutes les pièces sont prêtes.", "");
  const folders = [...new Set(input.summary.map((s) => s.folder))];
  for (const folder of folders) {
    const items = input.summary.filter((s) => s.folder === folder);
    const lot = items[0].lotId ? input.lots?.find((l) => l.id === items[0].lotId) : undefined;
    const title = items[0].group === "CANDIDATURE" ? "DOSSIER DE CANDIDATURE" : lot ? `OFFRE — ${lotLabel(lot).toUpperCase()}` : input.lots?.length ? "OFFRE — PIÈCES COMMUNES" : "OFFRE";
    out.push(`${title} (${folder})`, "");
    for (const s of items) {
      out.push(`${s.number}. ${s.label}`);
      for (const f of s.files) out.push(`    ✓ ${f}`);
      for (const i of s.issues) out.push(`    ⚠ ${i}`);
      if (!s.files.length) out.push("    ✗ aucun fichier dans le dossier");
    }
    out.push("");
  }
  out.push("Avant le dépôt : signez les pièces qui l'exigent (acte d'engagement, DC1…) et vérifiez les formats et tailles imposés par le règlement de la consultation.");
  return `﻿${out.join("\r\n")}\r\n`;
}

// ── Chargement et génération ─────────────────────────────────────────────────

async function latestAnalysis(orgId: string, tenderId: string): Promise<TenderAnalysisResult | null> {
  const row = await prisma.tenderAnalysis.findFirst({
    where: { tenderId, organizationId: orgId, status: "DONE" },
    orderBy: { createdAt: "desc" },
    select: { result: true },
  });
  return (row?.result as unknown as TenderAnalysisResult | undefined) ?? null;
}

/** Données des formulaires DC1 / DC2 : profil entreprise, avis et dernière analyse du DCE. */
export async function loadFormContext(orgId: string, tenderId: string, fallbackCompanyName: string): Promise<FormContext> {
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, organizationId: orgId } });
  if (!tender) throw new NotFoundError("Appel d'offres introuvable");
  const [analysis, profile, refs, lotRows] = await Promise.all([
    latestAnalysis(orgId, tenderId),
    prisma.companyProfile.findUnique({ where: { organizationId: orgId } }),
    prisma.companyReference.findMany({
      where: { organizationId: orgId, isPublic: true, OR: [{ year: null }, { year: { gte: new Date().getFullYear() - 3 } }] },
      orderBy: [{ year: "desc" }, { createdAt: "desc" }],
      take: 10,
    }),
    prisma.tenderLot.findMany({ where: { tenderId, organizationId: orgId }, select: { number: true, title: true, selected: true } }),
  ]);
  const lots = lotRows.length
    ? lotRows.sort((a, b) => compareLotNumbers(a.number, b.number))
    : (analysis?.lots ?? []).map((l) => ({ number: l.number, title: l.title, selected: false }));
  return {
    buyer: analysis?.buyer?.value || tender.buyerName,
    consultationObject: analysis?.object?.value || tender.title,
    consultationReference: analysis?.consultationReference?.value || tender.publicationRef || "",
    lots,
    company: {
      legalName: profile?.legalName || fallbackCompanyName,
      siret: profile?.siren ?? "",
      legalForm: profile?.legalForm ?? "",
      nafCode: profile?.nafCode ?? "",
      vatNumber: profile?.vatNumber ?? "",
      address: profile?.address ?? "",
      postalCode: profile?.postalCode ?? "",
      city: profile?.city ?? "",
      phone: profile?.phone ?? "",
      email: profile?.email ?? "",
      legalRepName: profile?.legalRepName ?? "",
      legalRepTitle: profile?.legalRepTitle ?? "",
      headcount: profile?.headcount ?? null,
      annualRevenueEur: profile?.annualRevenueEur ?? null,
      certifications: profile?.certifications ?? [],
    },
    references: refs.map((r) => ({ title: r.title, client: r.client, year: r.year, amountEur: r.amountEur })),
  };
}

function refSlug(tender: { publicationRef: string | null; externalId: string }) {
  return safeName(tender.publicationRef ?? tender.externalId, 40);
}

export async function buildFormDocx(orgId: string, tenderId: string, kind: FormKind, fallbackCompanyName: string) {
  const ctx = await loadFormContext(orgId, tenderId, fallbackCompanyName);
  const tender = await prisma.tender.findFirstOrThrow({ where: { id: tenderId, organizationId: orgId }, select: { publicationRef: true, externalId: true } });
  const content = formContent(kind, ctx);
  const buf = await renderFormDocx(content, ctx.company.legalName);
  return { buf, filename: `${kind.toUpperCase()}_${refSlug(tender)}.docx`, todos: countTodos(content) };
}

/** Dossier complet (ZIP) prêt à vérifier puis déposer sur la plateforme de l'acheteur. */
export async function buildDossierZip(orgId: string, tenderId: string, fallbackCompanyName: string) {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, organizationId: orgId },
    include: {
      pieces: { orderBy: [{ order: "asc" }, { createdAt: "asc" }], include: { files: { orderBy: { createdAt: "asc" } } } },
      proposals: { select: { id: true, lotId: true }, orderBy: { createdAt: "asc" } },
      lots: { where: { selected: true }, select: { id: true, number: true, title: true } },
    },
  });
  if (!tender) throw new NotFoundError("Appel d'offres introuvable");
  if (!tender.pieces.length) throw new NotFoundError("Générez d'abord la liste des pièces du dossier");
  const companyDocs = await prisma.companyDocument.findMany({
    where: { organizationId: orgId },
    select: { id: true, type: true, label: true, filename: true, storageKey: true, validUntil: true },
    orderBy: { createdAt: "asc" },
  });
  const pricingRows = await prisma.pricing.findMany({
    where: { tenderId, organizationId: orgId },
    select: { id: true, lotId: true, document: { select: { filename: true } } },
    orderBy: { createdAt: "asc" },
  });
  const pricings: DossierPricing[] = await Promise.all(
    pricingRows.map(async (p) => {
      const { totals } = await loadPricing(orgId, p.id);
      return { id: p.id, filename: p.document.filename, lotId: p.lotId, priced: totals.priced, missing: totals.lines - totals.priced };
    }),
  );
  const lots = tender.lots.sort((a, b) => compareLotNumbers(a.number, b.number));
  const pieces = visiblePieces(tender.pieces, lots.map((l) => l.id));
  const plan = planDossier({ pieces, companyDocs, deadline: tender.deadlineAt, proposals: tender.proposals, pricings, lots });

  const ctx = await loadFormContext(orgId, tenderId, fallbackCompanyName);
  const zip = new JSZip();
  for (const e of plan.entries) {
    let data: Buffer;
    if (e.source.kind === "storage") data = await storage().get(e.source.storageKey);
    else if (e.source.kind === "pricing") data = (await exportFilledTemplate(orgId, e.source.pricingId)).buf;
    else if (e.source.kind === "memoire") data = (await exportProposalDocx(orgId, e.source.proposalId, fallbackCompanyName))!.buf;
    else data = await renderFormDocx(formContent(e.source.what, ctx), ctx.company.legalName);
    zip.file(e.path, data);
  }
  zip.file(
    "00_Sommaire.txt",
    dossierSummaryText({
      title: tender.title,
      buyer: ctx.buyer,
      reference: ctx.consultationReference || tender.externalId,
      deadline: tender.deadlineAt,
      companyName: ctx.company.legalName,
      generatedAt: new Date(),
      summary: plan.summary,
      lots,
    }),
  );
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { buf, filename: `Dossier_${refSlug(tender)}.zip`, plan };
}
