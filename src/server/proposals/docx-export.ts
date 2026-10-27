import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";

export type ExportSection = { title: string; content: string; status: string };
export type ExportCompliance = { requirement: string; response: string; evidence: string; status: string; source: string };

const STATUS_LABEL: Record<string, string> = {
  COMPLIANT: "Conforme",
  PARTIAL: "Partiel",
  NON_COMPLIANT: "Non conforme",
  TO_VERIFY: "À vérifier",
};

const MARKER_RE = /(\[À VALIDER\]|\[À COMPLÉTER[^\]]*\])/;

/** Texte inline : **gras**, *italique*, marqueurs [À VALIDER] surlignés. */
export function inlineRuns(text: string): ParagraphChild[] {
  const runs: ParagraphChild[] = [];
  for (const part of text.split(MARKER_RE)) {
    if (!part) continue;
    if (MARKER_RE.test(part)) {
      runs.push(new TextRun({ text: part, bold: true, highlight: "yellow" }));
      continue;
    }
    for (const seg of part.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/)) {
      if (!seg) continue;
      if (seg.startsWith("**") && seg.endsWith("**")) runs.push(new TextRun({ text: seg.slice(2, -2), bold: true }));
      else if (seg.startsWith("*") && seg.endsWith("*") && seg.length > 2) runs.push(new TextRun({ text: seg.slice(1, -1), italics: true }));
      else runs.push(new TextRun(seg));
    }
  }
  return runs;
}

const border = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const borders = { top: border, bottom: border, left: border, right: border };
const CONTENT_WIDTH = 9026; // A4, marges de 2,54 cm

function table(rows: string[][], header = true): Table {
  const cols = Math.max(...rows.map((r) => r.length));
  const width = Math.floor(CONTENT_WIDTH / cols);
  return new Table({
    width: { size: width * cols, type: WidthType.DXA },
    columnWidths: Array(cols).fill(width),
    rows: rows.map(
      (r, i) =>
        new TableRow({
          tableHeader: header && i === 0,
          children: Array.from({ length: cols }, (_, c) =>
            new TableCell({
              borders,
              width: { size: width, type: WidthType.DXA },
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              shading: header && i === 0 ? { fill: "E8EEF7", type: ShadingType.CLEAR, color: "auto" } : undefined,
              children: [new Paragraph({ children: header && i === 0 ? [new TextRun({ text: r[c] ?? "", bold: true })] : inlineRuns(r[c] ?? "") })],
            }),
          ),
        }),
    ),
  });
}

/** Markdown simple → blocs Word. */
export function markdownToBlocks(md: string): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      i++;
      continue;
    }
    if (t.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      if (rows.length) out.push(table(rows));
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      const level = Math.min(h[1].length, 3);
      out.push(new Paragraph({ heading: level === 1 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, children: inlineRuns(h[2]) }));
      i++;
      continue;
    }
    const b = /^[-*•]\s+(.*)$/.exec(t);
    if (b) {
      out.push(new Paragraph({ numbering: { reference: "bullets", level: line.startsWith("  ") ? 1 : 0 }, children: inlineRuns(b[1]) }));
      i++;
      continue;
    }
    const n = /^\d+[.)]\s+(.*)$/.exec(t);
    if (n) {
      out.push(new Paragraph({ numbering: { reference: "numbers", level: 0 }, children: inlineRuns(n[1]) }));
      i++;
      continue;
    }
    // Paragraphe : lignes consécutives fusionnées
    const para: string[] = [t];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#|[-*•]\s|\d+[.)]\s|\|)/.test(lines[i].trim())) para.push(lines[i++].trim());
    out.push(new Paragraph({ spacing: { after: 120 }, children: inlineRuns(para.join(" ")) }));
  }
  return out;
}

export async function buildProposalDocx(input: {
  title: string;
  buyer: string;
  reference: string;
  companyName: string;
  sections: ExportSection[];
  compliance: ExportCompliance[];
  generatedAt: Date;
}): Promise<Buffer> {
  const draftWarning = input.sections.some((s) => s.status !== "VALIDATED");
  const children: Array<Paragraph | Table | TableOfContents> = [
    new Paragraph({ spacing: { before: 2400, after: 240 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "MÉMOIRE TECHNIQUE", bold: true, size: 40 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: input.title, size: 28 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Acheteur : ${input.buyer || "Non précisé"}` })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Référence : ${input.reference}` })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 480 }, children: [new TextRun({ text: `Candidat : ${input.companyName}`, bold: true })] }),
  ];
  if (draftWarning) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 480 },
        children: [new TextRun({ text: "DOCUMENT DE TRAVAIL — certaines sections ne sont pas encore validées", bold: true, color: "C00000" })],
      }),
    );
  }
  children.push(
    new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, children: [new TextRun("Sommaire")] }),
    new TableOfContents("Sommaire", { hyperlink: true, headingStyleRange: "1-2" }),
  );
  input.sections.forEach((s, idx) => {
    children.push(new Paragraph({ pageBreakBefore: idx === 0, heading: HeadingLevel.HEADING_1, children: [new TextRun(`${idx + 1}. ${s.title}`)] }));
    if (s.content.trim()) children.push(...markdownToBlocks(s.content));
    else children.push(new Paragraph({ children: inlineRuns("[À COMPLÉTER : section non rédigée]") }));
  });
  if (input.compliance.length) {
    children.push(new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, children: [new TextRun("Annexe — Matrice de conformité")] }));
    children.push(
      table([
        ["Exigence", "Réponse proposée", "Justificatif", "Statut", "Source"],
        ...input.compliance.map((c) => [c.requirement, c.response, c.evidence, STATUS_LABEL[c.status] ?? c.status, c.source]),
      ]),
    );
  }

  const doc = new Document({
    creator: input.companyName,
    title: input.title,
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 32, bold: true, color: "1F3864" }, paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 26, bold: true, color: "2F5496" }, paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 23, bold: true }, paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 } },
      ],
    },
    numbering: {
      config: [
        { reference: "bullets", levels: [0, 1].map((level) => ({ level, format: LevelFormat.BULLET, text: level ? "◦" : "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })) },
        { reference: "numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: `${input.companyName} — Mémoire technique — page `, size: 16 }), new TextRun({ children: [PageNumber.CURRENT], size: 16 })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
