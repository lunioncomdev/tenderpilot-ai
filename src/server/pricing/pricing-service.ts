import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { audit } from "../audit";
import { NotFoundError } from "../auth/rbac";
import { prisma } from "../db";
import { storage } from "../documents/storage";
import { linePrice, parseRates, pricingTotals, type Days } from "./compute";
import { analyzeTemplate, fillTemplate } from "./template";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PRICE_KINDS = ["BPU", "DPGF"] as const;

export class PricingTemplateError extends Error {}

/** Classeurs XLSX du DCE utilisables comme bordereau de prix (BPU / DPGF d'abord). */
export async function priceTemplates(orgId: string, tenderId: string) {
  const docs = await prisma.tenderDocument.findMany({
    where: { organizationId: orgId, tenderId, mimeType: XLSX_MIME },
    select: { id: true, filename: true, kind: true },
    orderBy: { createdAt: "asc" },
  });
  return docs.sort((a, b) => Number(PRICE_KINDS.includes(b.kind as never)) - Number(PRICE_KINDS.includes(a.kind as never)));
}

async function loadWorkbook(storageKey: string) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load((await storage().get(storageKey)) as unknown as ArrayBuffer);
  } catch {
    throw new PricingTemplateError("Classeur illisible : seuls les fichiers .xlsx sont pris en charge (enregistrez un .xls au format .xlsx).");
  }
  return wb;
}

export function toDays(json: unknown): Days {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const out: Days = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

/**
 * Analyse le bordereau et (re)crée les lignes à chiffrer. Relancée sur le même
 * document, elle conserve les saisies (prix, jours, notes) des lignes inchangées.
 */
export async function preparePricing(orgId: string, tenderId: string, documentId: string, userId: string) {
  const doc = await prisma.tenderDocument.findFirst({ where: { id: documentId, tenderId, organizationId: orgId } });
  if (!doc) throw new NotFoundError("Document introuvable");
  if (doc.mimeType !== XLSX_MIME) throw new PricingTemplateError("Le bordereau doit être un classeur Excel (.xlsx).");
  const { lines, warnings } = analyzeTemplate(await loadWorkbook(doc.storageKey));
  if (!lines.some((l) => !l.isHeading)) {
    throw new PricingTemplateError(warnings[0] ?? "Aucune ligne de prix à remplir n'a été trouvée dans ce classeur.");
  }

  const pricing = await prisma.pricing.upsert({
    where: { tenderId_documentId: { tenderId, documentId } },
    create: { organizationId: orgId, tenderId, documentId, warnings, createdById: userId },
    update: { warnings },
    include: { lines: { select: { id: true, sheet: true, row: true, designation: true } } },
  });
  const known = new Map(pricing.lines.map((l) => [`${l.sheet}\n${l.row}`, l]));
  const seen = new Set<string>();
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  lines.forEach((l, order) => {
    const key = `${l.sheet}\n${l.row}`;
    seen.add(key);
    const meta = { order, isHeading: l.isHeading, reference: l.reference, designation: l.designation, unit: l.unit, quantity: l.quantity, priceCell: l.priceCell, amountCell: l.amountCell };
    const prev = known.get(key);
    if (prev && prev.designation === l.designation) ops.push(prisma.pricingLine.update({ where: { id: prev.id }, data: meta }));
    else if (prev) ops.push(prisma.pricingLine.update({ where: { id: prev.id }, data: { ...meta, manualPrice: l.existingPrice, days: {}, note: "" } }));
    else ops.push(prisma.pricingLine.create({ data: { pricingId: pricing.id, sheet: l.sheet, row: l.row, ...meta, manualPrice: l.existingPrice } }));
  });
  const stale = pricing.lines.filter((l) => !seen.has(`${l.sheet}\n${l.row}`)).map((l) => l.id);
  if (stale.length) ops.push(prisma.pricingLine.deleteMany({ where: { id: { in: stale } } }));
  await prisma.$transaction(ops);
  await audit({ orgId, userId, action: "pricing.prepared", entityType: "Tender", entityId: tenderId, metadata: { pricingId: pricing.id, documentId, lines: lines.length } });
  return { pricing, lines: lines.length, warnings };
}

async function ownPricing(orgId: string, pricingId: string) {
  const p = await prisma.pricing.findFirst({ where: { id: pricingId, organizationId: orgId }, include: { document: true, tender: true } });
  if (!p) throw new NotFoundError("Chiffrage introuvable");
  return p;
}

export async function savePricingEntries(
  orgId: string,
  pricingId: string,
  userId: string,
  input: {
    adjustmentPercent: number;
    /** Profils de la grille affichée : les jours des autres profils sont conservés. */
    profiles: string[];
    lines: Array<{ id: string; manualPrice: number | null; days: Days; note: string }>;
  },
) {
  const p = await ownPricing(orgId, pricingId);
  const existing = new Map((await prisma.pricingLine.findMany({ where: { pricingId: p.id }, select: { id: true, days: true } })).map((l) => [l.id, toDays(l.days)]));
  const shown = new Set(input.profiles);
  const merge = (id: string, days: Days): Days => {
    const kept = Object.fromEntries(Object.entries(existing.get(id) ?? {}).filter(([k]) => !shown.has(k)));
    return { ...kept, ...toDays(Object.fromEntries(Object.entries(days).filter(([k]) => shown.has(k)))) };
  };
  await prisma.$transaction([
    prisma.pricing.update({ where: { id: p.id }, data: { adjustmentPercent: input.adjustmentPercent } }),
    ...input.lines
      .filter((l) => existing.has(l.id))
      .map((l) => prisma.pricingLine.update({ where: { id: l.id }, data: { manualPrice: l.manualPrice, days: merge(l.id, l.days), note: l.note } })),
  ]);
  await audit({ orgId, userId, action: "pricing.saved", entityType: "Tender", entityId: p.tenderId, metadata: { pricingId: p.id } });
  return p;
}

/** Chiffrage complet : lignes, prix calculés et totaux, avec la grille de TJM actuelle du profil. */
export async function loadPricing(orgId: string, pricingId: string) {
  const p = await ownPricing(orgId, pricingId);
  const [lines, profile] = await Promise.all([
    prisma.pricingLine.findMany({ where: { pricingId: p.id }, orderBy: { order: "asc" } }),
    prisma.companyProfile.findUnique({ where: { organizationId: orgId }, select: { dailyRates: true } }),
  ]);
  const rates = parseRates(profile?.dailyRates);
  const priced = lines.map((l) => {
    const days = toDays(l.days);
    return { ...l, days, price: linePrice({ ...l, days }, rates, p.adjustmentPercent) };
  });
  const totals = pricingTotals(priced, rates, p.adjustmentPercent);
  return { pricing: p, lines: priced, rates, totals };
}

/** Bordereau d'origine rempli avec les prix retenus. */
export async function exportFilledTemplate(orgId: string, pricingId: string) {
  const { pricing, lines } = await loadPricing(orgId, pricingId);
  const wb = await loadWorkbook(pricing.document.storageKey);
  const fills = lines
    .filter((l) => l.priceCell && l.price.unitPrice !== null)
    .map((l) => ({ sheet: l.sheet, priceCell: l.priceCell!, amountCell: l.amountCell, unitPrice: l.price.unitPrice!, amount: l.price.amount }));
  const { written, skipped } = fillTemplate(wb, fills);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const base = pricing.document.filename.replace(/\.xlsx$/i, "");
  return { buf, filename: `${base}_complete.xlsx`, written, skipped, missing: lines.filter((l) => !l.isHeading && l.price.unitPrice === null).length };
}
