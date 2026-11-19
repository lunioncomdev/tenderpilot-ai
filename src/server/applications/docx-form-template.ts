import JSZip from "jszip";
import { normalizeText } from "@/lib/utils";

/**
 * Remplissage d'un formulaire Word existant (modèle officiel DC1 / DC2 de la DAJ,
 * ou la version jointe au DCE par l'acheteur) sans en modifier la mise en page.
 *
 * Le document est manipulé au niveau du XML WordprocessingML : les valeurs sont
 * écrites dans la ligne vide qui suit chaque libellé, les cases à cocher (champs
 * de formulaire FORMCHECKBOX, contrôles de contenu, symboles Wingdings ou « ☐ »)
 * sont cochées, et un texte peut être remplacé dans le corps, les en-têtes et les
 * pieds de page. Chaque opération indique si elle a trouvé sa cible : un modèle
 * remanié par l'acheteur ne fait pas échouer la génération, les champs non
 * reportés sont simplement signalés.
 */

export type FormOp =
  /** Écrit `value` dans la première ligne vide sous le paragraphe contenant `label`. */
  | { op: "fillBelow"; field: string; label: string; value: string; occurrence?: number }
  /** Coche la case du paragraphe contenant `label` (recherché après `after` s'il est donné). */
  | { op: "check"; field: string; label: string; after?: string }
  /** Écrit `values` dans les cellules qui suivent celle contenant `label`, sur la même ligne de tableau. */
  | { op: "fillRow"; field: string; label: string; values: string[] }
  /** Remplace `from` par `to` partout (corps, en-têtes, pieds de page). */
  | { op: "replace"; field: string; from: string; to: string };

export type FillReport = {
  /** Champs écrits ou cochés. */
  placed: string[];
  /** Rubriques déjà renseignées dans le modèle (acheteur pré-rempli par exemple) : laissées telles quelles. */
  kept: string[];
  /** Rubriques introuvables dans le modèle. */
  unplaced: string[];
};

type Para = { start: number; end: number; xml: string; text: string; empty: boolean };

const PARA_TAG = /<w:p(?=[\s>/])(?:\s[^>]*)?\/>|<w:p(?=[\s>/])(?:\s[^>]*)?>|<\/w:p>/g;
const NON_TEXT_CONTENT = /<w:fldChar|<w:sym\b|<w:drawing|<w:pict|<w:sdt\b|<w:instrText|<w:object/;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

/** Texte d'un fragment XML (contenu des <w:t>, tabulations en espaces). */
export function textOf(xml: string): string {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map((m) => (m[1] === undefined ? " " : unesc(m[1]))).join("");
}

/** Paragraphes de premier niveau d'un fragment XML (les paragraphes imbriqués dans une zone de texte sont inclus dans leur parent). */
export function scanParagraphs(xml: string): Para[] {
  const out: Para[] = [];
  let depth = 0;
  let start = -1;
  for (const m of xml.matchAll(PARA_TAG)) {
    const tag = m[0];
    if (tag.endsWith("/>")) {
      if (depth === 0) out.push({ start: m.index, end: m.index + tag.length, xml: tag, text: "", empty: true });
    } else if (tag.startsWith("</")) {
      depth--;
      if (depth === 0 && start >= 0) {
        const end = m.index + tag.length;
        const p = xml.slice(start, end);
        const text = textOf(p);
        out.push({ start, end, xml: p, text, empty: !text.trim() && !NON_TEXT_CONTENT.test(p) });
      }
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return out;
}

function has(text: string, label: string): boolean {
  const t = normalizeText(text);
  const l = normalizeText(label);
  if (!l) return false;
  // Libellé court d'un seul mot (« Oui », « Non ») : mot entier uniquement.
  return l.length <= 4 && !l.includes(" ") ? ` ${t} `.includes(` ${l} `) : t.includes(l);
}

/**
 * Paragraphes contenant le libellé, du plus probable au moins probable : ceux qui
 * commencent par le libellé et s'y réduisent (un intitulé suivi de « : »), puis
 * ceux qui commencent par lui, puis ceux qui le citent ; les consignes entre
 * parenthèses ou crochets en dernier. À score égal, l'ordre du document.
 */
function matchingParagraphs(paras: Para[], label: string, from = 0): number[] {
  const l = normalizeText(label);
  const scored: Array<{ i: number; score: number }> = [];
  for (let i = from; i < paras.length; i++) {
    if (!has(paras[i].text, label)) continue;
    const t = normalizeText(paras[i].text);
    const score = (t.startsWith(l) ? 0 : 2) + (t.length <= l.length + 60 ? 0 : 1) + (isInstruction(paras[i].text) ? 10 : 0);
    scored.push({ i, score });
  }
  return scored.sort((x, y) => x.score - y.score || x.i - y.i).map((x) => x.i);
}

function findParagraph(paras: Para[], label: string, occurrence = 1, from = 0): number {
  return matchingParagraphs(paras, label, from)[occurrence - 1] ?? -1;
}

/** Propriétés de caractères du paragraphe (marque de paragraphe), sans gras. */
function runPropsOf(paraXml: string): string {
  const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(paraXml)?.[0] ?? "";
  const rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(pPr)?.[0] ?? /<w:r>(?:<w:rPr>[\s\S]*?<\/w:rPr>)/.exec(paraXml)?.[0].replace(/^<w:r>/, "") ?? "";
  return rPr.replace(/<w:b(?:Cs)?(?:\s[^>]*)?\/>/g, "").replace(/<w:rStyle[^>]*\/>/g, "");
}

function runsFor(value: string, rPr: string): string {
  return value
    .split("\n")
    .map((line) => `<w:r>${rPr}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`)
    .join(`<w:r>${rPr}<w:br/></w:r>`);
}

/** Insère des runs à la fin d'un paragraphe (ouvre un paragraphe auto-fermé). */
function appendRuns(paraXml: string, runs: string): string {
  if (paraXml.endsWith("/>")) return `${paraXml.slice(0, -2)}>${runs}</w:p>`;
  return paraXml.replace(/<\/w:p>$/, `${runs}</w:p>`);
}

function splice(xml: string, p: Para, replacement: string): string {
  return xml.slice(0, p.start) + replacement + xml.slice(p.end);
}

const isInstruction = (text: string) => /^\s*[([]/.test(text);
const WINGDINGS_EMPTY = /(<w:sym\b[^>]*w:font="Wingdings(?: 2)?"[^>]*w:char=")(?:F06F|F0A8|F071|F0A6|F0A3|F06E)("[^>]*\/>)/i;
const hasBox = (xml: string) => /<w:checkBox>|<w14:checkbox>|☐/.test(xml) || WINGDINGS_EMPTY.test(xml);

/**
 * Paragraphe de structure du formulaire (intitulé de rubrique, libellé suivi de
 * « : », ligne à cocher) par opposition à un contenu saisi par l'acheteur.
 */
function isStructural(p: Para): boolean {
  const t = p.text.trim();
  if (/:$/.test(t) || hasBox(p.xml)) return true;
  if (/^[A-Z]{1,2}\d{0,2}\s?[-–.]\s/.test(t)) return true;
  if (/<w:pStyle w:val="[^"]*(Titre|Heading|Rubrique|Sous)[^"]*"/i.test(p.xml)) return true;
  // Intitulé court en gras (« Présentation du candidat »).
  return t.length < 60 && /<w:r>(?:<w:rPr>(?:(?!<\/w:rPr>).)*<w:b(?:\s[^>]*)?\/>)/s.test(p.xml);
}

type FillResult = { xml: string; status: "placed" | "kept" } | null;

function fillBelow(xml: string, label: string, value: string, occurrence = 1): FillResult {
  const paras = scanParagraphs(xml);
  const i = findParagraph(paras, label, occurrence);
  if (i < 0) return null;
  const anchor = paras[i];
  for (let j = i + 1; j < Math.min(paras.length, i + 9); j++) {
    const p = paras[j];
    if (p.empty) return { xml: splice(xml, p, appendRuns(p.xml, runsFor(value, runPropsOf(p.xml) || runPropsOf(anchor.xml)))), status: "placed" };
    if (isInstruction(p.text)) continue;
    // Un texte libre sous le libellé : la rubrique a déjà été renseignée dans le modèle (acheteur pré-rempli).
    if (!isStructural(p)) return { xml, status: "kept" };
    break;
  }
  // Pas de ligne vide sous le libellé : valeur ajoutée à la suite, sur le même paragraphe.
  return { xml: splice(xml, anchor, appendRuns(anchor.xml, runsFor(` ${value.replace(/\n/g, " ; ")}`, runPropsOf(anchor.xml)))), status: "placed" };
}

/** Coche la première case d'un fragment XML ; null si aucune case. */
export function checkBox(xml: string): string | null {
  // 1. Champ de formulaire hérité (FORMCHECKBOX)
  const ff = /<w:checkBox>[\s\S]*?<\/w:checkBox>/.exec(xml);
  if (ff) {
    let box = ff[0];
    if (/<w:checked\b/.test(box)) box = box.replace(/<w:checked(?:\s[^>]*)?\/>/, '<w:checked w:val="1"/>');
    else if (/<w:default\b/.test(box)) box = box.replace(/<w:default(?:\s[^>]*)?\/>/, '<w:default w:val="1"/>');
    else box = box.replace(/<\/w:checkBox>/, '<w:default w:val="1"/></w:checkBox>');
    return xml.slice(0, ff.index) + box + xml.slice(ff.index + ff[0].length);
  }
  // 2. Contrôle de contenu « case à cocher » (Word 2010+)
  const sdt = /<w14:checkbox>[\s\S]*?<\/w14:checkbox>/.exec(xml);
  if (sdt) {
    const glyph = /<w14:checkedState[^>]*w14:val="([0-9A-Fa-f]{4})"/.exec(sdt[0])?.[1] ?? "2612";
    const ctrl = sdt[0].replace(/<w14:checked [^>]*\/>/, '<w14:checked w14:val="1"/>');
    let out = xml.slice(0, sdt.index) + ctrl + xml.slice(sdt.index + sdt[0].length);
    const content = /<w:sdtContent>[\s\S]*?<\/w:sdtContent>/.exec(out.slice(sdt.index));
    if (content) {
      const replaced = content[0].replace(/(<w:t(?:\s[^>]*)?>)[☐☑☒]?(<\/w:t>)/, `$1${String.fromCodePoint(parseInt(glyph, 16))}$2`);
      out = out.slice(0, sdt.index + content.index) + replaced + out.slice(sdt.index + content.index + content[0].length);
    }
    return out;
  }
  // 3. Symbole Wingdings
  if (WINGDINGS_EMPTY.test(xml)) return xml.replace(WINGDINGS_EMPTY, "$1F0FE$2");
  // 4. Caractère Unicode
  if (/☐/.test(xml)) return xml.replace("☐", "☒");
  return null;
}


function check(xml: string, label: string, after?: string): string | null {
  const paras = scanParagraphs(xml);
  const from = after ? findParagraph(paras, after) : 0;
  if (from < 0) return null;
  for (const i of matchingParagraphs(paras, label, from)) {
    const candidates = [i];
    // Case placée dans un paragraphe voisin ne contenant qu'elle (ou rien d'autre de lisible).
    for (const j of [i + 1, i + 2, i - 1]) if (j >= 0 && j < paras.length && !paras[j].text.trim()) candidates.push(j);
    for (const j of candidates) {
      const p = paras[j];
      if (!hasBox(p.xml)) continue;
      const checked = checkBox(p.xml);
      if (checked) return splice(xml, p, checked);
    }
  }
  return null;
}

type Cell = { start: number; end: number; xml: string };

function scanCells(rowXml: string): Cell[] {
  const out: Cell[] = [];
  let depth = 0;
  let start = -1;
  for (const m of rowXml.matchAll(/<w:tc(?=[\s>])(?:\s[^>]*)?>|<\/w:tc>/g)) {
    if (m[0].startsWith("</")) {
      depth--;
      if (depth === 0) out.push({ start, end: m.index + m[0].length, xml: rowXml.slice(start, m.index + m[0].length) });
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return out;
}

function fillRow(xml: string, label: string, values: string[]): string | null {
  let depth = 0;
  let start = -1;
  for (const m of xml.matchAll(/<w:tr(?=[\s>])(?:\s[^>]*)?>|<\/w:tr>/g)) {
    if (m[0].startsWith("</")) {
      depth--;
      if (depth !== 0) continue;
      const end = m.index + m[0].length;
      const row = xml.slice(start, end);
      const cells = scanCells(row);
      const li = cells.findIndex((c) => has(textOf(c.xml), label));
      if (li < 0) continue;
      let out = row;
      let written = 0;
      // Cellules remplies de la dernière à la première pour conserver les positions.
      for (let k = Math.min(values.length, cells.length - li - 1) - 1; k >= 0; k--) {
        const value = values[k];
        if (!value) continue;
        const cell = cells[li + 1 + k];
        const paras = scanParagraphs(cell.xml);
        const target = paras.find((p) => p.empty) ?? paras[paras.length - 1];
        if (!target) continue;
        const filled = cell.xml.slice(0, target.start) + appendRuns(target.xml, runsFor(value, runPropsOf(target.xml))) + cell.xml.slice(target.end);
        out = out.slice(0, cell.start) + filled + out.slice(cell.end);
        written++;
      }
      return written ? xml.slice(0, start) + out + xml.slice(end) : null;
    }
    if (depth === 0) start = m.index;
    depth++;
  }
  return null;
}

/** Remplace la première occurrence d'un texte dans un paragraphe, même répartie sur plusieurs runs. */
function replaceOnce(paraXml: string, target: string, replacement: string): string | null {
  const segs = [...paraXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => ({ start: m.index + m[0].length - m[1].length - "</w:t>".length, raw: m[1] }));
  const joined = segs.map((s) => s.raw).join("");
  const at = joined.indexOf(target);
  if (at < 0) return null;
  let offset = 0;
  const edits: Array<{ start: number; raw: string; next: string }> = [];
  for (const s of segs) {
    const sStart = offset;
    const sEnd = offset + s.raw.length;
    offset = sEnd;
    const a = Math.max(at, sStart);
    const b = Math.min(at + target.length, sEnd);
    if (a >= b) continue;
    edits.push({ start: s.start, raw: s.raw, next: s.raw.slice(0, a - sStart) + (a === at ? replacement : "") + s.raw.slice(b - sStart) });
  }
  let out = paraXml;
  for (const e of edits.reverse()) out = out.slice(0, e.start) + e.next + out.slice(e.start + e.raw.length);
  return out;
}

/** Remplace toutes les occurrences d'un texte dans un fragment XML. */
function replaceText(xml: string, from: string, to: string): { xml: string; count: number } {
  const target = esc(from);
  const replacement = esc(to);
  if (!target || replacement.includes(target)) return { xml, count: 0 };
  let count = 0;
  const paras = scanParagraphs(xml);
  for (let i = paras.length - 1; i >= 0; i--) {
    let out = paras[i].xml;
    let next = replaceOnce(out, target, replacement);
    while (next !== null) {
      out = next;
      count++;
      next = replaceOnce(out, target, replacement);
    }
    if (out !== paras[i].xml) xml = xml.slice(0, paras[i].start) + out + xml.slice(paras[i].end);
  }
  return { xml, count };
}

/** Applique les opérations au document et retourne le DOCX modifié avec le bilan des champs reportés. */
export async function fillDocxForm(template: Buffer, ops: FormOp[]): Promise<{ buf: Buffer; report: FillReport }> {
  const zip = await JSZip.loadAsync(template);
  const main = zip.file("word/document.xml");
  if (!main) throw new Error("Modèle DOCX invalide (word/document.xml absent)");
  let doc = await main.async("string");
  const parts = Object.keys(zip.files).filter((f) => /^word\/(header|footer)\d*\.xml$/.test(f));
  const partXml = new Map<string, string>();
  for (const f of parts) partXml.set(f, await zip.file(f)!.async("string"));

  const report: FillReport = { placed: [], kept: [], unplaced: [] };
  const done = (field: string, ok: boolean) => (ok ? report.placed : report.unplaced).push(field);

  for (const op of ops) {
    if (op.op === "fillBelow") {
      const out = op.value.trim() ? fillBelow(doc, op.label, op.value.trim(), op.occurrence) : null;
      if (out) doc = out.xml;
      if (out?.status === "kept") report.kept.push(op.field);
      else done(op.field, out !== null);
    } else if (op.op === "check") {
      const out = check(doc, op.label, op.after);
      if (out) doc = out;
      done(op.field, out !== null);
    } else if (op.op === "fillRow") {
      const out = op.values.some((v) => v) ? fillRow(doc, op.label, op.values) : null;
      if (out) doc = out;
      done(op.field, out !== null);
    } else {
      let count = 0;
      const r = replaceText(doc, op.from, op.to);
      doc = r.xml;
      count += r.count;
      for (const [f, x] of partXml) {
        const rr = replaceText(x, op.from, op.to);
        partXml.set(f, rr.xml);
        count += rr.count;
      }
      done(op.field, count > 0);
    }
  }

  zip.file("word/document.xml", doc);
  for (const [f, x] of partXml) zip.file(f, x);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { buf, report };
}
