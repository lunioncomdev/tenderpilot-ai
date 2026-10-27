import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Europe/Paris" });
const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});

export const NOT_SPECIFIED = "Non précisé";

export function formatEur(value: number | string | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined || value === "") return NOT_SPECIFIED;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return NOT_SPECIFIED;
  if (currency && currency !== "EUR") {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  }
  return eur.format(n);
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return NOT_SPECIFIED;
  return dateFmt.format(new Date(d));
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return NOT_SPECIFIED;
  return dateTimeFmt.format(new Date(d));
}

export function daysUntil(d: Date | string | null | undefined, now = new Date()): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - now.getTime()) / 86_400_000);
}

/** Normalisation pour comparaisons : minuscules, sans accents ni ponctuation. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function splitList(input: string): string[] {
  return input
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
