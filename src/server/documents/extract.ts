import ExcelJS from "exceljs";
import JSZip from "jszip";
import mammoth from "mammoth";
import type { AllowedType } from "./file-type";

export type ExtractedPage = { page: number | null; text: string };
export type ExtractionResult = { pages: ExtractedPage[]; pageCount: number | null; needsOcr: boolean };

/** Limites anti « zip bomb ». */
export const ZIP_LIMITS = { maxEntries: 200, maxTotalBytes: 300 * 1024 * 1024, maxEntryBytes: 80 * 1024 * 1024 };

export async function extractPdf(buf: Buffer): Promise<ExtractionResult> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = text.map((t, i) => ({ page: i + 1, text: cleanText(t) }));
  const chars = pages.reduce((a, p) => a + p.text.length, 0);
  // Moins de ~40 caractères par page en moyenne : PDF scanné sans couche texte.
  return { pages, pageCount: totalPages, needsOcr: totalPages > 0 && chars / totalPages < 40 };
}

export async function extractDocx(buf: Buffer): Promise<ExtractionResult> {
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });
  return { pages: [{ page: null, text: htmlToText(html) }], pageCount: null, needsOcr: false };
}

export async function extractXlsx(buf: Buffer): Promise<ExtractionResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const pages: ExtractedPage[] = [];
  wb.eachSheet((sheet, idx) => {
    const lines = [`## Feuille « ${sheet.name} »`];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(String(cell.text ?? "").replace(/\s+/g, " ").trim());
      });
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.some(Boolean)) lines.push(`L${rowNumber} | ${cells.join(" | ")}`);
    });
    pages.push({ page: idx, text: lines.join("\n") });
  });
  return { pages, pageCount: pages.length, needsOcr: false };
}

export function extractTxt(buf: Buffer): ExtractionResult {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder("latin1").decode(buf);
  }
  return { pages: [{ page: null, text: cleanText(text) }], pageCount: null, needsOcr: false };
}

export async function extract(buf: Buffer, type: AllowedType): Promise<ExtractionResult> {
  switch (type.ext) {
    case "pdf":
      return extractPdf(buf);
    case "docx":
      return extractDocx(buf);
    case "xlsx":
      return extractXlsx(buf);
    case "txt":
      return extractTxt(buf);
    case "zip":
      throw new Error("Un ZIP doit être décompressé avant extraction");
  }
}

/** Décompresse un ZIP en respectant les garde-fous (taille, nombre, chemins). */
export async function unzipSafely(buf: Buffer): Promise<Array<{ name: string; data: Buffer }>> {
  const zip = await JSZip.loadAsync(buf);
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length > ZIP_LIMITS.maxEntries) throw new Error(`Archive refusée : plus de ${ZIP_LIMITS.maxEntries} fichiers`);
  const out: Array<{ name: string; data: Buffer }> = [];
  let total = 0;
  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, "/");
    if (name.startsWith("/") || name.split("/").includes("..")) throw new Error(`Chemin interdit dans l'archive : ${name}`);
    const base = name.split("/").pop()!;
    if (!base || base.startsWith(".") || name.startsWith("__MACOSX/")) continue;
    const data = await entry.async("nodebuffer");
    if (data.length > ZIP_LIMITS.maxEntryBytes) throw new Error(`Fichier trop volumineux dans l'archive : ${base}`);
    total += data.length;
    if (total > ZIP_LIMITS.maxTotalBytes) throw new Error("Archive refusée : taille décompressée excessive");
    out.push({ name: base, data });
  }
  return out;
}

export function cleanText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " ", apos: "'" };

/** Conversion HTML (mammoth) → texte structuré : titres, listes, tableaux. */
export function htmlToText(html: string): string {
  const s = html
    .replace(/<h([1-6])[^>]*>/gi, (_m, l) => `\n\n${"#".repeat(Number(l))} `)
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|ul|ol|table)>/gi, "\n")
    .replace(/<tr[^>]*>/gi, "\n| ")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? (e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) : m));
  return cleanText(s);
}
