import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import ExcelJS from "exceljs";
import JSZip from "jszip";

/**
 * Générateurs de documents de test. Les contenus sont FICTIFS et réservés aux tests.
 */

export async function makeDocx(paragraphs: Array<{ heading?: string; text?: string }>): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: paragraphs.map((p) =>
          p.heading ? new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(p.heading)] }) : new Paragraph(p.text ?? ""),
        ),
      },
    ],
  });
  return Packer.toBuffer(doc);
}

export async function makeXlsx(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("DPGF");
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function makeZip(files: Record<string, Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return zip.generateAsync({ type: "nodebuffer" });
}

/** PDF minimal valide (une page par texte), police standard Helvetica, texte ASCII. */
export function makePdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const add = (s: string) => objects.push(s) && objects.length;
  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  add("PAGES_PLACEHOLDER");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  for (const text of pages) {
    const lines = text.split("\n").map((l, i) => `BT /F1 11 Tf 50 ${780 - i * 16} Td (${l.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
    const content = add(`<< /Length ${lines.length} >>\nstream\n${lines}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
