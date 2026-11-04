import type ExcelJS from "exceljs";
import { normalizeText } from "@/lib/utils";

/**
 * Lecture et remplissage d'un bordereau de prix officiel (BPU / DPGF / DQE) au
 * format XLSX. Le modèle est conservé tel quel : seules les cellules de prix
 * vides (sans formule) sont écrites ; les formules de l'acheteur recalculent
 * les montants à l'ouverture du fichier.
 */

export type TemplateLine = {
  sheet: string;
  row: number;
  isHeading: boolean;
  reference: string;
  designation: string;
  unit: string;
  quantity: number | null;
  priceCell: string | null;
  amountCell: string | null;
  /** Prix déjà présent dans le modèle (repris comme prix saisi). */
  existingPrice: number | null;
};

export type TemplateAnalysis = { lines: TemplateLine[]; warnings: string[] };

export const MAX_TEMPLATE_LINES = 2000;
const HEADER_SCAN_ROWS = 40;

type Col = "designation" | "reference" | "unit" | "quantity" | "unitPrice" | "amount";

type CellRead = { text: string; num: number | null; formula: boolean; empty: boolean; address: string };

function master(cell: ExcelJS.Cell): ExcelJS.Cell {
  return cell.isMerged && cell.master ? cell.master : cell;
}

function read(cell: ExcelJS.Cell): CellRead {
  const c = master(cell);
  const v = c.value as unknown;
  const out: CellRead = { text: "", num: null, formula: false, empty: v === null || v === undefined || v === "", address: c.address };
  if (out.empty) return out;
  if (typeof v === "number") return { ...out, text: String(v), num: v };
  if (typeof v === "string") {
    const n = /^\s*-?[\d\s  ]+([.,]\d+)?\s*(€)?\s*$/.test(v) ? Number(v.replace(/[\s  €]/g, "").replace(",", ".")) : NaN;
    return { ...out, text: v.trim(), num: Number.isFinite(n) ? n : null };
  }
  if (v instanceof Date) return { ...out, text: v.toISOString().slice(0, 10) };
  if (typeof v === "object" && v) {
    const o = v as Record<string, unknown>;
    if ("formula" in o || "sharedFormula" in o) {
      const r = o.result;
      return { ...out, formula: true, text: r === undefined || r === null ? "" : String(r), num: typeof r === "number" ? r : null };
    }
    if ("richText" in o) return { ...out, text: (o.richText as Array<{ text: string }>).map((t) => t.text).join("").trim() };
    if ("text" in o) return { ...out, text: String(o.text ?? "").trim() };
  }
  return out;
}

/** Rôle d'une colonne d'après le texte de son en-tête (normalisé). */
export function classifyHeader(raw: string): Col | null {
  const h = normalizeText(raw);
  if (!h) return null;
  if (/\b(prix|tarif|cout)s? unitaires?\b|^p ?u\b|\bp u\b|\bpu\b/.test(h)) return "unitPrice";
  if (/\bmontants?\b|\btotal\b|prix global|prix forfaitaire|\bforfait\b/.test(h)) return "amount";
  if (/^prix\b|^tarif\b/.test(h)) return "unitPrice";
  if (/quantite|\bqte\b|^qt\b|^q$|^nombre\b|^volume\b|^estimation\b/.test(h)) return "quantity";
  if (/^unites?\b|^u$/.test(h)) return "unit";
  if (/designation|libelle|intitule|prestation|description|nature|^objet\b|^detail\b/.test(h)) return "designation";
  if (/^(n|no|num|numero|ref|reference|code|poste|article|item|repere)\b/.test(h)) return "reference";
  return null;
}

/** Préférence HT : parmi plusieurs colonnes de même rôle, on écarte TTC / TVA. */
function preferHt(cols: Array<{ col: number; text: string }>): number | undefined {
  const n = cols.map((c) => ({ ...c, h: normalizeText(c.text) }));
  return (n.find((c) => /\bht\b/.test(c.h)) ?? n.find((c) => !/\bttc\b|\btva\b/.test(c.h)) ?? n[0])?.col;
}

type Header = { row: number; lastHeaderRow: number; cols: Partial<Record<Col, number>> };

function detectHeader(ws: ExcelJS.Worksheet): Header | null {
  const maxCol = Math.min(ws.columnCount || 0, 60);
  const last = Math.min(ws.rowCount || 0, HEADER_SCAN_ROWS);
  const texts = (r: number) => Array.from({ length: maxCol }, (_, i) => read(ws.getRow(r).getCell(i + 1)).text);

  const build = (row: number, lastHeaderRow: number, cells: string[]): Header | null => {
    const found: Partial<Record<Col, Array<{ col: number; text: string }>>> = {};
    cells.forEach((t, i) => {
      const role = classifyHeader(t);
      if (role) (found[role] ??= []).push({ col: i + 1, text: t });
    });
    if (!found.designation || (!found.unitPrice && !found.amount)) return null;
    const cols: Partial<Record<Col, number>> = {
      designation: found.designation[0].col,
      reference: found.reference?.[0].col,
      unit: found.unit?.[0].col,
      quantity: found.quantity?.[0].col,
      unitPrice: found.unitPrice ? preferHt(found.unitPrice) : undefined,
      amount: found.amount ? preferHt(found.amount) : undefined,
    };
    return { row, lastHeaderRow, cols };
  };

  for (let r = 1; r <= last; r++) {
    const a = texts(r);
    const single = build(r, r, a);
    // En-tête sur deux lignes (« Prix » / « unitaire HT ») : la ligne suivante
    // complète l'en-tête si elle ne porte ni désignation ni valeur numérique.
    let merged: Header | null = null;
    if (r < last) {
      const b = texts(r + 1);
      merged = build(r, r + 1, a.map((t, i) => (t === b[i] ? t : `${t} ${b[i]}`.trim())));
      if (merged && single) {
        const row = ws.getRow(r + 1);
        const continuesHeader = !b[single.cols.designation! - 1]
          && b.some(Boolean)
          && b.every((t, i) => !t || read(row.getCell(i + 1)).num === null);
        if (!continuesHeader) merged = null;
      }
    }
    if (merged) return merged;
    if (single) return single;
  }
  return null;
}

const TOTAL_ROW = /^(sous total|total|montant total|total general|montant tva|tva|t v a|ttc|net a payer|recapitulatif|montant global)\b/;

export function analyzeTemplate(wb: ExcelJS.Workbook): TemplateAnalysis {
  const lines: TemplateLine[] = [];
  const warnings: string[] = [];
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== "visible") return;
    const header = detectHeader(ws);
    if (!header) {
      if ((ws.actualRowCount ?? 0) > 0) warnings.push(`Feuille « ${ws.name} » : colonnes « désignation » et « prix » non reconnues — ignorée.`);
      return;
    }
    const c = header.cols;
    const lump = c.unitPrice === undefined; // DPGF au forfait : seul le montant de la ligne est demandé
    const priceCol = (c.unitPrice ?? c.amount)!;
    const hasUnitOrQty = c.unit !== undefined || c.quantity !== undefined;
    let formulas = 0;
    let texts = 0;

    for (let r = header.lastHeaderRow + 1; r <= ws.rowCount; r++) {
      if (lines.length >= MAX_TEMPLATE_LINES) {
        warnings.push(`Plus de ${MAX_TEMPLATE_LINES} lignes : la suite du bordereau n'est pas reprise.`);
        return false;
      }
      const row = ws.getRow(r);
      const get = (col: number | undefined) => (col === undefined ? null : read(row.getCell(col)));
      const designation = get(c.designation)!.text.replace(/\s+/g, " ");
      const reference = (get(c.reference)?.text ?? "").replace(/\s+/g, " ");
      if (!designation && !reference) continue;
      if (TOTAL_ROW.test(normalizeText(designation)) || TOTAL_ROW.test(normalizeText(reference))) continue;

      const price = get(priceCol)!;
      const unit = get(c.unit)?.text ?? "";
      const qty = get(c.quantity);
      const quantity = lump ? 1 : (qty?.num ?? null);
      const base = { sheet: ws.name, row: r, reference: reference.slice(0, 50), designation: (designation || reference).slice(0, 500), unit: unit.slice(0, 30) };

      if (price.formula) {
        formulas++;
        continue;
      }
      if (!price.empty && price.num === null) {
        texts++; // « Inclus », « Sans objet »… : laissé tel quel
        continue;
      }
      if (hasUnitOrQty && !lump && !unit && (qty?.empty ?? true) && price.empty) {
        lines.push({ ...base, isHeading: true, quantity: null, priceCell: null, amountCell: null, existingPrice: null });
        continue;
      }
      const amount = !lump && c.amount !== undefined ? get(c.amount)! : null;
      lines.push({
        ...base,
        isHeading: false,
        quantity,
        priceCell: price.address,
        amountCell: amount && amount.empty && quantity !== null ? amount.address : null,
        existingPrice: price.num,
      });
    }
    if (formulas) warnings.push(`Feuille « ${ws.name} » : ${formulas} ligne(s) calculée(s) par formule, non modifiées.`);
    if (texts) warnings.push(`Feuille « ${ws.name} » : ${texts} ligne(s) avec un texte en guise de prix (« inclus »…), non modifiées.`);
    return true;
  });
  // Titres de section en fin de feuille sans ligne chiffrée : inutiles.
  while (lines.length && lines[lines.length - 1].isHeading) lines.pop();
  return { lines, warnings };
}

export type TemplateFill = { sheet: string; priceCell: string; amountCell: string | null; unitPrice: number; amount: number | null };

/**
 * Écrit les prix dans le classeur d'origine. Une cellule devenue formule ou
 * texte depuis l'analyse n'est jamais écrasée. Excel recalcule à l'ouverture.
 */
export function fillTemplate(wb: ExcelJS.Workbook, fills: TemplateFill[]): { written: number; skipped: number } {
  let written = 0;
  let skipped = 0;
  for (const f of fills) {
    const ws = wb.getWorksheet(f.sheet);
    if (!ws) {
      skipped++;
      continue;
    }
    const cell = master(ws.getCell(f.priceCell));
    const cur = read(cell);
    if (cur.formula || (!cur.empty && cur.num === null)) {
      skipped++;
      continue;
    }
    cell.value = f.unitPrice;
    written++;
    if (f.amountCell && f.amount !== null) {
      const a = master(ws.getCell(f.amountCell));
      if (read(a).empty) a.value = f.amount;
    }
  }
  wb.calcProperties = { ...(wb.calcProperties ?? {}), fullCalcOnLoad: true };
  return { written, skipped };
}
