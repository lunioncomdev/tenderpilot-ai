/** Utilitaires de lecture des structures eForms converties en JSON (BOAMP) et des champs TED. */

type Json = unknown;

/** Toutes les valeurs associées à `key`, à n'importe quelle profondeur. */
export function findAll(obj: Json, key: string, out: Json[] = []): Json[] {
  if (Array.isArray(obj)) {
    for (const v of obj) findAll(v, key, out);
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, Json>)) {
      if (k === key) out.push(v);
      findAll(v, key, out);
    }
  }
  return out;
}

export function findFirst(obj: Json, key: string): Json | undefined {
  return findAll(obj, key)[0];
}

/** Texte d'un nœud eForms (`"x"` ou `{ "#text": "x" }`). */
export function text(v: Json): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object" && "#text" in (v as object)) return text((v as Record<string, Json>)["#text"]);
  return null;
}

export function attr(v: Json, name: string): string | null {
  if (Array.isArray(v)) return attr(v[0], name);
  if (v && typeof v === "object" && `@${name}` in (v as object)) {
    return String((v as Record<string, Json>)[`@${name}`]);
  }
  return null;
}

/**
 * Combine une date eForms (`2026-11-23+01:00`) et une heure optionnelle
 * (`16:00:00+01:00`). Sans heure, on retient 12:00 (estimation prudente).
 */
export function parseEformsDateTime(date: string | null, time?: string | null): Date | null {
  if (!date) return null;
  const m = /^(\d{4}-\d{2}-\d{2})(Z|[+-]\d{2}:\d{2})?$/.exec(date.trim());
  if (!m) {
    const d = new Date(date);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const day = m[1];
  const dateTz = m[2] ?? "+01:00";
  let clock = "12:00:00";
  let tz = dateTz;
  if (time) {
    const t = /^(\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:\d{2})?$/.exec(time.trim());
    if (t) {
      clock = t[1].length === 5 ? `${t[1]}:00` : t[1];
      tz = t[2] ?? dateTz;
    }
  }
  const d = new Date(`${day}T${clock}${tz === "Z" ? "Z" : tz}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function durationToMonths(value: number | null, unit: string | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  switch ((unit ?? "").toUpperCase()) {
    case "MONTH":
      return Math.round(value);
    case "YEAR":
      return Math.round(value * 12);
    case "DAY":
      return Math.max(1, Math.round(value / 30));
    case "WEEK":
      return Math.max(1, Math.round(value / 4.33));
    default:
      return null;
  }
}

export function toNumber(v: Json): number | null {
  const s = text(v);
  if (s === null) return null;
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Choisit la meilleure langue disponible d'un champ multilingue TED. */
export function pickLang(v: Json, prefs = ["fra", "eng"]): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.length ? pickLang(v[0], prefs) : null;
  if (typeof v === "object") {
    const rec = v as Record<string, Json>;
    for (const p of prefs) if (rec[p] !== undefined) return pickLang(rec[p], prefs);
    const first = Object.values(rec)[0];
    return first === undefined ? null : pickLang(first, prefs);
  }
  return null;
}

export function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/** `72200000` → `722*` (préfixe significatif), pour inclure les sous-codes CPV. */
export function cpvToPattern(code: string): string {
  const digits = code.replace(/\D/g, "").slice(0, 8);
  const trimmed = digits.replace(/0+$/, "");
  return `${trimmed.length >= 2 ? trimmed : digits.slice(0, 2)}*`;
}
