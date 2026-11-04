import { normalizeText } from "@/lib/utils";

/**
 * Pièces de l'offre à fournir pour chaque lot retenu : acte d'engagement,
 * offre financière, mémoire technique, cahiers des charges. Les autres pièces
 * (candidature, RIB, exigences propres au DCE) restent communes.
 */
export const LOT_SCOPED_KEYS = new Set(["ae", "prix", "memoire", "cahiers"]);

export type LotRef = { id: string; number: string; title: string };

/** Numéro de lot normalisé : « Lot n° 02 » → « 2 », « Lot A » → « A ». */
export function normalizeLotNumber(raw: string): string {
  const s = raw.trim().replace(/^lot\s*(n\s*[°o.]?\s*)?/i, "").trim();
  if (/^\d+$/.test(s)) return String(Number(s));
  const m = /^(\d+)\b/.exec(s);
  if (m) return String(Number(m[1]));
  return s.slice(0, 20) || raw.trim().slice(0, 20);
}

/** Lot déduit d'un nom de fichier (« DPGF_Lot2.xlsx », « BPU lot n°03 »). */
export function guessLotNumber(filename: string): string | null {
  const m = /(?:^|[^a-z])lot\s*(?:n\s*o?\s*)?0*(\d{1,3})(?!\d)/.exec(normalizeText(filename.replace(/°/g, " o ")));
  return m ? String(Number(m[1])) : null;
}

export function lotLabel(lot: { number: string; title: string }): string {
  return `Lot n° ${lot.number}${lot.title ? ` — ${lot.title}` : ""}`;
}

/** Ordre naturel des lots : numériques d'abord (1, 2, 10), puis alphabétiques. */
export function compareLotNumbers(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  if (Number.isFinite(na)) return -1;
  if (Number.isFinite(nb)) return 1;
  return a.localeCompare(b, "fr");
}

/**
 * Pièces du dossier effectivement à fournir. Sans lot retenu : les pièces
 * communes. Avec des lots retenus : les pièces de ces lots et les pièces communes,
 * hors pièces « par lot » restées communes. Les pièces des lots non retenus sont
 * conservées en base mais écartées.
 */
export function visiblePieces<P extends { key: string; lotId: string | null }>(pieces: P[], selectedLotIds: string[]): P[] {
  const selected = new Set(selectedLotIds);
  if (!selected.size) return pieces.filter((p) => p.lotId === null);
  return pieces.filter((p) => (p.lotId === null ? !LOT_SCOPED_KEYS.has(p.key) : selected.has(p.lotId)));
}

type PlannedLike = { key: string; group: "CANDIDATURE" | "OFFRE"; label: string; detail: string; source: string; fromDce: boolean };

export type PieceOps<P extends PlannedLike> = {
  updates: Array<{ id: string; data: Omit<P, "key"> & { order: number; lotId: string | null } }>;
  creates: Array<P & { order: number; lotId: string | null }>;
};

/**
 * Rapproche les pièces prévues (plan issu de l'analyse) des pièces existantes,
 * en tenant compte des lots retenus. Les pièces « par lot » sont déclinées pour
 * chaque lot retenu. Quand on passe d'une candidature sans lot à des lots (ou
 * l'inverse), la pièce déjà travaillée (statut, fichiers, note) est déplacée vers
 * le premier lot retenu (ou redevient commune) au lieu d'être recréée vide.
 */
export function reconcilePieces<P extends PlannedLike>(
  planned: P[],
  existing: Array<{ id: string; key: string; lotId: string | null }>,
  lots: Array<{ id: string; selected: boolean }>,
): PieceOps<P> {
  const selected = lots.filter((l) => l.selected).map((l) => l.id);
  const selectedSet = new Set(selected);
  const lotOrder = new Map(lots.map((l, i) => [l.id, i]));
  const claimed = new Set<string>();
  const ops: PieceOps<P> = { updates: [], creates: [] };
  const free = (pred: (e: (typeof existing)[number]) => boolean) =>
    existing.filter((e) => !claimed.has(e.id) && pred(e)).sort((a, b) => (lotOrder.get(a.lotId ?? "") ?? -1) - (lotOrder.get(b.lotId ?? "") ?? -1))[0];

  planned.forEach((p, order) => {
    const targets: Array<string | null> = LOT_SCOPED_KEYS.has(p.key) && selected.length ? selected : [null];
    for (const lotId of targets) {
      const same = free((e) => e.key === p.key && e.lotId === lotId);
      const moved = same
        ? undefined
        : lotId !== null
          ? lotId === selected[0] ? free((e) => e.key === p.key && e.lotId === null) : undefined
          : free((e) => e.key === p.key && e.lotId !== null && !selectedSet.has(e.lotId));
      const target = same ?? moved;
      if (target) {
        claimed.add(target.id);
        const { group, label, detail, source, fromDce } = p;
        ops.updates.push({ id: target.id, data: { ...({ group, label, detail, source, fromDce } as Omit<P, "key">), order, lotId } });
      } else {
        ops.creates.push({ ...p, order, lotId });
      }
    }
  });
  return ops;
}

/** Mémoire à rattacher (ou détacher) quand les lots retenus changent, sur le même principe. */
export function proposalMove(proposals: Array<{ id: string; lotId: string | null }>, lots: Array<{ id: string; selected: boolean }>): { id: string; lotId: string | null } | null {
  const selected = lots.filter((l) => l.selected).map((l) => l.id);
  if (selected.length) {
    if (proposals.some((p) => p.lotId === selected[0])) return null;
    const common = proposals.find((p) => p.lotId === null);
    return common ? { id: common.id, lotId: selected[0] } : null;
  }
  if (proposals.some((p) => p.lotId === null)) return null;
  const order = new Map(lots.map((l, i) => [l.id, i]));
  const orphan = [...proposals].sort((a, b) => (order.get(a.lotId!) ?? 0) - (order.get(b.lotId!) ?? 0))[0];
  return orphan ? { id: orphan.id, lotId: null } : null;
}
