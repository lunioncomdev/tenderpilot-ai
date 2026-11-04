import { describe, expect, it, vi } from "vitest";
import { extractPdf } from "@/server/documents/extract";
import { OcrUnavailableError } from "@/server/documents/ocr";

/** PDF minimal : une page par entrée, texte (ou rien = page « scannée »). */
function pdf(pages: Array<string | null>): Buffer {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((t, i) => {
    const stream = t ? `BT /F1 12 Tf 72 720 Td (${t}) Tj ET` : "";
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, "latin1");
}

const LONG = "Reglement de la consultation : maintenance applicative du portail, date limite le 26 novembre.";

describe("extraction PDF avec OCR", () => {
  it("n'appelle pas l'OCR quand le texte est présent", async () => {
    const ocr = vi.fn();
    const r = await extractPdf(pdf([LONG]), ocr);
    expect(ocr).not.toHaveBeenCalled();
    expect(r.needsOcr).toBe(false);
    expect(r.pages[0].text).toContain("maintenance applicative");
  });

  it("reconnaît les pages scannées et seulement elles", async () => {
    const ocr = vi.fn(async (_b: Buffer, pages: number[]) => new Map(pages.map((p) => [p, `Texte reconnu page ${p} : acte d'engagement signé par le pouvoir adjudicateur.`])));
    const r = await extractPdf(pdf([LONG, null]), ocr);
    expect(ocr).toHaveBeenCalledWith(expect.any(Buffer), [2]);
    expect(r.ocrPages).toBe(1);
    expect(r.needsOcr).toBe(false);
    expect(r.pages[1].text).toContain("acte d'engagement");
  });

  it("signale l'OCR absent sans échouer", async () => {
    const r = await extractPdf(pdf([null]), async () => { throw new OcrUnavailableError(); });
    expect(r.needsOcr).toBe(true);
    expect(r.ocrError).toMatch(/OCR indisponible/);
  });

  it("reste « OCR requis » si l'OCR ne lit rien", async () => {
    const r = await extractPdf(pdf([null]), async () => new Map([[1, "  "]]));
    expect(r.needsOcr).toBe(true);
    expect(r.ocrPages).toBe(0);
  });
});

describe("extraction XLSX", () => {
  it("lit les cellules fusionnées (y compris vides) sans répéter leur texte", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { extractXlsx } = await import("@/server/documents/extract");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("BPU");
    ws.getCell("A1").value = "Référence du marché";
    ws.mergeCells("A1:C1");
    ws.mergeCells("A2:C2"); // fusion vide
    ws.getCell("A3").value = "Prix unitaire";
    ws.getCell("B3").value = 450;
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await extractXlsx(buf);
    expect(r.pages[0].text).toBe("## Feuille « BPU »\nL1 | Référence du marché\nL3 | Prix unitaire | 450");
  });
});
