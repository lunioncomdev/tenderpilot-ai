import type { ExtractedPage } from "./extract";

export type Chunk = {
  index: number;
  pageStart: number | null;
  pageEnd: number | null;
  heading: string | null;
  text: string;
  tokenEstimate: number;
};

/** Estimation grossière pour le français (~3,5 caractères par token). */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 3.5);
}

const HEADING_RE =
  /^(#{1,6} .+|(article|chapitre|section|partie|annexe)\s+[\divxlc]+.*|\d+(\.\d+){0,3}\.?\s+[A-ZÉÈÀÂÎÔÛÇ].{2,90}|[A-ZÉÈÀÂÎÔÛÇ0-9][A-ZÉÈÀÂÎÔÛÇ0-9 '’\-:,]{5,90})$/i;

export function isHeading(line: string): boolean {
  const l = line.trim();
  if (l.length < 4 || l.length > 110 || /[.;]$/.test(l)) return false;
  return HEADING_RE.test(l);
}

type Para = { text: string; page: number | null; heading: string | null };

/**
 * Découpe par paragraphes en conservant la page d'origine et le dernier titre
 * rencontré. Les blocs dépassant la taille cible sont découpés par phrases.
 */
export function chunkPages(pages: ExtractedPage[], targetTokens = 1200, overlapChars = 200): Chunk[] {
  const paras: Para[] = [];
  let heading: string | null = null;
  for (const p of pages) {
    for (const block of p.text.split(/\n{2,}/)) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      const firstLine = trimmed.split("\n")[0];
      if (isHeading(firstLine)) heading = firstLine.replace(/^#+\s*/, "").slice(0, 120);
      for (const piece of splitLong(trimmed, targetTokens)) paras.push({ text: piece, page: p.page, heading });
    }
  }

  const chunks: Chunk[] = [];
  let buf: Para[] = [];
  let bufTokens = 0;
  let fresh = 0; // paragraphes nouveaux (hors chevauchement) dans le tampon
  const flush = () => {
    if (!buf.length) return;
    const text = buf.map((b) => b.text).join("\n\n");
    const pagesIn = buf.map((b) => b.page).filter((x): x is number => x !== null);
    chunks.push({
      index: chunks.length,
      pageStart: pagesIn.length ? Math.min(...pagesIn) : null,
      pageEnd: pagesIn.length ? Math.max(...pagesIn) : null,
      heading: buf[buf.length - fresh].heading, // titre du premier paragraphe nouveau (pas du chevauchement)
      text,
      tokenEstimate: estimateTokens(text),
    });
    // Chevauchement : fin du dernier paragraphe reportée au chunk suivant.
    const last = buf[buf.length - 1];
    const tail = last.text.length > overlapChars ? last.text.slice(-overlapChars) : "";
    buf = tail ? [{ ...last, text: `…${tail.slice(tail.indexOf(" ") + 1)}` }] : [];
    bufTokens = buf.length ? estimateTokens(buf[0].text) : 0;
    fresh = 0;
  };

  for (const p of paras) {
    const t = estimateTokens(p.text);
    if (bufTokens + t > targetTokens && fresh > 0) flush();
    buf.push(p);
    bufTokens += t;
    fresh++;
  }
  if (fresh > 0) flush();
  return chunks;
}

function splitLong(text: string, targetTokens: number): string[] {
  if (estimateTokens(text) <= targetTokens) return [text];
  const maxChars = Math.floor(targetTokens * 3.5);
  const out: string[] = [];
  let cur = "";
  for (const sentence of text.split(/(?<=[.!?;:])\s+|\n/)) {
    if (cur && cur.length + sentence.length + 1 > maxChars) {
      out.push(cur);
      cur = "";
    }
    if (sentence.length > maxChars) {
      for (let i = 0; i < sentence.length; i += maxChars) out.push(sentence.slice(i, i + maxChars));
      continue;
    }
    cur = cur ? `${cur} ${sentence}` : sentence;
  }
  if (cur) out.push(cur);
  return out;
}
