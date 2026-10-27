import type { DocumentChunk, DocumentKind, TenderDocument } from "@prisma/client";

export type DocWithChunks = TenderDocument & { chunks: DocumentChunk[] };

export type ChunkRef = {
  label: string; // ex. D2-C14
  chunkId: string;
  documentId: string;
  filename: string;
  pageStart: number | null;
  pageEnd: number | null;
  text: string;
};

export type DceContext = { text: string; refs: Map<string, ChunkRef>; tokens: number; excluded: string[] };

const KIND_PRIORITY: DocumentKind[] = ["RC", "CCTP", "CCAP", "AE", "QR", "DPGF", "BPU", "AVIS", "ANNEXE", "AUTRE"];

function escapeAttr(s: string) {
  return s.replace(/[<>"&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "&": "&amp;" })[c]!);
}

/** Neutralise d'éventuelles balises de fermeture forgées dans le contenu. */
function escapeContent(s: string) {
  return s.replace(/<\/?(dce|document|chunk)\b/gi, (m) => m.replace("<", "‹"));
}

/**
 * Construit le contexte DCE transmis au modèle, document par document dans
 * l'ordre de priorité. Si le budget de tokens est dépassé, les documents les
 * moins prioritaires sont exclus et listés (jamais de troncature silencieuse).
 */
export function buildDceContext(docs: DocWithChunks[], maxTokens: number): DceContext {
  const sorted = [...docs]
    .filter((d) => d.chunks.length > 0)
    .sort((a, b) => KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind) || a.createdAt.getTime() - b.createdAt.getTime());
  const refs = new Map<string, ChunkRef>();
  const parts: string[] = ["<dce>"];
  const excluded: string[] = [];
  let tokens = 0;
  sorted.forEach((doc, di) => {
    const docTokens = doc.chunks.reduce((a, c) => a + c.tokenEstimate, 0);
    if (tokens + docTokens > maxTokens) {
      excluded.push(doc.filename);
      return;
    }
    tokens += docTokens;
    const dLabel = `D${di + 1}`;
    parts.push(`<document id="${dLabel}" filename="${escapeAttr(doc.filename)}" type="${doc.kind}">`);
    for (const c of [...doc.chunks].sort((a, b) => a.index - b.index)) {
      const label = `${dLabel}-C${c.index + 1}`;
      refs.set(label, {
        label,
        chunkId: c.id,
        documentId: doc.id,
        filename: doc.filename,
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
        text: c.text,
      });
      const pages = c.pageStart ? ` pages="${c.pageStart}${c.pageEnd && c.pageEnd !== c.pageStart ? `-${c.pageEnd}` : ""}"` : "";
      parts.push(`<chunk id="${label}"${pages}>\n${escapeContent(c.text)}\n</chunk>`);
    }
    parts.push("</document>");
  });
  parts.push("</dce>");
  return { text: parts.join("\n"), refs, tokens, excluded };
}
