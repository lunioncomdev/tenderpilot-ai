/**
 * Moteur de chiffrage déterministe : prix unitaire = Σ (jours × TJM du profil),
 * ajusté d'un pourcentage global, sauf prix saisi directement. Aucun appel à l'IA.
 */

export type DailyRate = { profile: string; rate: number };
export type Days = Record<string, number>;

export type PriceableLine = {
  isHeading: boolean;
  quantity: number | null;
  manualPrice: number | null;
  days: Days;
};

export type LinePrice = {
  /** Prix unitaire HT retenu (null : ligne non chiffrée). */
  unitPrice: number | null;
  /** Montant HT = prix unitaire × quantité (null sans quantité, ex. BPU). */
  amount: number | null;
  source: "manual" | "computed" | "none";
  /** Profils saisis absents de la grille de TJM (jours ignorés). */
  unknownProfiles: string[];
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Grille de TJM du profil entreprise ({ "Chef de projet": 750 }), valeurs invalides écartées. */
export function parseRates(json: unknown): DailyRate[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) return [];
  return Object.entries(json as Record<string, unknown>)
    .map(([profile, rate]) => ({ profile: profile.trim(), rate: typeof rate === "number" ? rate : Number(rate) }))
    .filter((r) => r.profile && Number.isFinite(r.rate) && r.rate > 0);
}

/** Saisie texte « Profil : TJM », une ligne par profil. */
export function parseRatesText(text: string): { rates: Record<string, number>; errors: string[] } {
  const rates: Record<string, number> = {};
  const errors: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.+?)\s*[:=;]\s*(\d[\d\s  .,]*?)(?:\s*(?:€|eur(?:os?)?|ht|\/\s*j(?:our)?|par jour))*\s*$/i.exec(line);
    const rate = m ? Number(m[2].replace(/[\s  ]/g, "").replace(",", ".")) : NaN;
    if (!m || !Number.isFinite(rate) || rate <= 0) {
      errors.push(line);
      continue;
    }
    rates[m[1].trim().slice(0, 100)] = round2(rate);
  }
  return { rates, errors };
}

export function formatRatesText(json: unknown): string {
  return parseRates(json).map((r) => `${r.profile} : ${r.rate}`).join("\n");
}

/** Nombre décimal saisi en français (« 1,5 », « 1 200,50 ») ; null si vide ou invalide. */
export function parseDecimal(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[\s  €]/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function linePrice(line: PriceableLine, rates: DailyRate[], adjustmentPercent: number): LinePrice {
  const none: LinePrice = { unitPrice: null, amount: null, source: "none", unknownProfiles: [] };
  if (line.isHeading) return none;
  const byProfile = new Map(rates.map((r) => [r.profile, r.rate]));
  const unknownProfiles = Object.entries(line.days).filter(([p, d]) => d > 0 && !byProfile.has(p)).map(([p]) => p);
  let unitPrice: number | null = null;
  let source: LinePrice["source"] = "none";
  if (line.manualPrice !== null) {
    unitPrice = round2(line.manualPrice);
    source = "manual";
  } else {
    const base = Object.entries(line.days).reduce((sum, [p, d]) => sum + (byProfile.get(p) ?? 0) * (d > 0 ? d : 0), 0);
    if (base > 0) {
      unitPrice = round2(base * (1 + adjustmentPercent / 100));
      source = "computed";
    }
  }
  const amount = unitPrice !== null && line.quantity !== null ? round2(unitPrice * line.quantity) : null;
  return { unitPrice, amount, source, unknownProfiles };
}

export type PricingTotals = {
  lines: number;
  priced: number;
  /** Total HT des lignes avec quantité (DPGF / DQE). */
  totalHt: number;
  /** Jours par profil, pondérés par les quantités. */
  daysByProfile: Record<string, number>;
};

export function pricingTotals(lines: PriceableLine[], rates: DailyRate[], adjustmentPercent: number): PricingTotals {
  const out: PricingTotals = { lines: 0, priced: 0, totalHt: 0, daysByProfile: {} };
  for (const l of lines) {
    if (l.isHeading) continue;
    out.lines++;
    const p = linePrice(l, rates, adjustmentPercent);
    if (p.unitPrice !== null) out.priced++;
    if (p.amount !== null) out.totalHt = round2(out.totalHt + p.amount);
    if (p.source === "computed") {
      const q = l.quantity ?? 1;
      for (const [profile, d] of Object.entries(l.days)) if (d > 0) out.daysByProfile[profile] = round2((out.daysByProfile[profile] ?? 0) + d * q);
    }
  }
  return out;
}
