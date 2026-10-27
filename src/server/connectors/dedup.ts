import { createHash } from "node:crypto";
import { normalizeText } from "@/lib/utils";

const STOP_WORDS = new Set([
  "de", "des", "du", "la", "le", "les", "l", "d", "et", "a", "au", "aux", "en", "pour", "un", "une",
  "sur", "par", "dans", "avec", "marche", "accord", "cadre", "prestations", "prestation", "services",
]);

function signature(s: string, maxWords: number): string {
  return normalizeText(s)
    .split(" ")
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .slice(0, maxWords)
    .sort()
    .join(" ");
}

/**
 * Empreinte « faible » d'un avis : acheteur + mots significatifs de l'objet + jour
 * de la date limite. Deux publications du même marché sur deux sources produisent
 * la même empreinte dans la grande majorité des cas.
 */
export function computeDedupKey(input: { buyerName: string; title: string; deadlineAt: Date | null }): string {
  const day = input.deadlineAt ? input.deadlineAt.toISOString().slice(0, 10) : "nodeadline";
  const base = `${signature(input.buyerName, 6)}|${signature(input.title, 10)}|${day}`;
  return createHash("sha1").update(base).digest("hex").slice(0, 20);
}
