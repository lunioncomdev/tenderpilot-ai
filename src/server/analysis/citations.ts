import { normalizeText } from "@/lib/utils";
import type { ChunkRef } from "./context";
import type { SourceRefT, VerifiedSourceRef } from "./schema";

/**
 * Une citation est vérifiée si le passage existe et si le texte cité y figure
 * (après normalisation). Les citations elliptiques (« … ») sont vérifiées par
 * segments.
 */
export function verifySource(src: SourceRefT, refs: Map<string, ChunkRef>): VerifiedSourceRef {
  const ref = refs.get(src.chunkId.trim());
  if (!ref) return { ...src, verified: false };
  const hay = normalizeText(ref.text);
  const segments = src.quote
    .split(/\.\.\.|…/)
    .map((s) => normalizeText(s))
    .filter((s) => s.length >= 8);
  const verified = segments.length > 0 && segments.every((s) => hay.includes(s));
  return {
    ...src,
    verified,
    documentId: ref.documentId,
    filename: ref.filename,
    pageStart: ref.pageStart,
    pageEnd: ref.pageEnd,
  };
}

/** Parcourt récursivement le résultat et remplace chaque `sources` par sa version vérifiée. */
export function verifyAllSources<T>(value: T, refs: Map<string, ChunkRef>, stats = { total: 0, verified: 0 }): { value: T; stats: { total: number; verified: number } } {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === "sources" && Array.isArray(val)) {
          out[k] = (val as SourceRefT[]).map((s) => {
            const r = verifySource(s, refs);
            stats.total++;
            if (r.verified) stats.verified++;
            return r;
          });
        } else {
          out[k] = walk(val);
        }
      }
      return out;
    }
    return v;
  };
  return { value: walk(value) as T, stats };
}
