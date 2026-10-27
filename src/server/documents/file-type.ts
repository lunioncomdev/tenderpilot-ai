import { fileTypeFromBuffer } from "file-type";
import type { DocumentKind } from "@prisma/client";
import { normalizeText } from "@/lib/utils";

export type AllowedType = { ext: "pdf" | "docx" | "xlsx" | "txt" | "zip"; mime: string };

const MIME: Record<AllowedType["ext"], string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  zip: "application/zip",
};

function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8192);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    // Latin-1 : on accepte si peu de caractères de contrôle
    let ctrl = 0;
    for (const b of sample) if (b < 9 || (b > 13 && b < 32)) ctrl++;
    return ctrl / Math.max(1, sample.length) < 0.01;
  }
}

/**
 * Détermine le type réel du fichier à partir de son contenu (magic bytes), pas de
 * son extension. Retourne null si le type n'est pas dans la liste blanche.
 */
export async function detectAllowedType(buf: Buffer, filename: string): Promise<AllowedType | null> {
  const ft = await fileTypeFromBuffer(buf);
  if (ft) {
    if (ft.ext === "pdf") return { ext: "pdf", mime: MIME.pdf };
    if (ft.ext === "docx") return { ext: "docx", mime: MIME.docx };
    if (ft.ext === "xlsx") return { ext: "xlsx", mime: MIME.xlsx };
    if (ft.ext === "zip") {
      // Les DOCX/XLSX mal détectés apparaissent comme ZIP : l'extension départage.
      const ext = filename.toLowerCase().split(".").pop();
      if (ext === "docx") return { ext: "docx", mime: MIME.docx };
      if (ext === "xlsx") return { ext: "xlsx", mime: MIME.xlsx };
      return { ext: "zip", mime: MIME.zip };
    }
    return null;
  }
  const ext = filename.toLowerCase().split(".").pop();
  if ((ext === "txt" || ext === "csv" || ext === "md") && looksLikeText(buf)) return { ext: "txt", mime: MIME.txt };
  return null;
}

/** Devine la nature de la pièce du DCE d'après son nom (modifiable ensuite). */
export function guessDocumentKind(filename: string): DocumentKind {
  const n = ` ${normalizeText(filename)} `;
  const has = (...words: string[]) => words.some((w) => n.includes(` ${w} `) || n.includes(` ${w}`));
  if (has("rc", "reglement de consultation", "reglement consultation")) return "RC";
  if (has("cctp", "cahier des clauses techniques")) return "CCTP";
  if (has("ccap", "cahier des clauses administratives")) return "CCAP";
  if (has("dpgf", "decomposition du prix global")) return "DPGF";
  if (has("bpu", "bordereau")) return "BPU";
  if (has("ae", "acte d engagement", "attri1")) return "AE";
  if (has("questions", "reponses", "q r")) return "QR";
  if (has("annexe", "annex")) return "ANNEXE";
  if (has("avis", "aapc")) return "AVIS";
  return "AUTRE";
}
