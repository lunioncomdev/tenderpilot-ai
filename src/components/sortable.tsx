import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Th } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/**
 * Tri des tableaux par l'URL (`sort` / `dir`, préfixés quand une page porte
 * plusieurs tableaux) : rendu serveur, compatible avec la pagination, et le
 * lien partagé conserve l'ordre choisi.
 */

export type SortDir = "asc" | "desc";
export type SortState<K extends string = string> = { key: K; dir: SortDir };
type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Tri demandé dans l'URL, ou `fallback` si la colonne n'est pas triable. */
export function parseSort<K extends string>(sp: SearchParams, keys: readonly K[], fallback: SortState<K>, prefix = ""): SortState<K> {
  const key = first(sp[`${prefix}sort`]);
  const dir = first(sp[`${prefix}dir`]);
  if (!key || !(keys as readonly string[]).includes(key)) return fallback;
  return { key: key as K, dir: dir === "asc" || dir === "desc" ? dir : "asc" };
}

type Sortable = string | number | Date | boolean | null | undefined;

/** Tri en mémoire, valeurs absentes toujours en fin de liste. */
export function sortRows<T, K extends string>(rows: T[], sort: SortState<K>, accessors: Record<K, (row: T) => Sortable>): T[] {
  const get = accessors[sort.key];
  const sign = sort.dir === "asc" ? 1 : -1;
  const norm = (v: Sortable) => (v instanceof Date ? v.getTime() : typeof v === "boolean" ? Number(v) : v);
  return [...rows].sort((a, b) => {
    const x = norm(get(a));
    const y = norm(get(b));
    if (x === null || x === undefined || x === "") return y === null || y === undefined || y === "" ? 0 : 1;
    if (y === null || y === undefined || y === "") return -1;
    if (typeof x === "string" && typeof y === "string") return sign * x.localeCompare(y, "fr", { sensitivity: "base", numeric: true });
    return sign * (x < y ? -1 : x > y ? 1 : 0);
  });
}

/**
 * En-tête cliquable. Premier clic : `firstDir` (décroissant pour les montants,
 * scores et dates récentes) ; clic suivant : sens inverse. Les autres paramètres
 * de l'URL sont conservés, sauf la page, remise à 1.
 */
export function SortTh<K extends string>({
  label,
  column,
  sort,
  params,
  prefix = "",
  firstDir = "asc",
  className,
}: {
  label: string;
  column: K;
  sort: SortState<K>;
  params: SearchParams;
  prefix?: string;
  firstDir?: SortDir;
  className?: string;
}) {
  const active = sort.key === column;
  const next: SortDir = active ? (sort.dir === "asc" ? "desc" : "asc") : firstDir;
  const qs = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) => {
      const s = first(v);
      return s && k !== `${prefix}sort` && k !== `${prefix}dir` && k !== "page" ? [[k, s]] : [];
    }),
  );
  qs.set(`${prefix}sort`, column);
  qs.set(`${prefix}dir`, next);
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <Th className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link
        href={`?${qs}`}
        scroll={false}
        className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}
        title={`Trier par ${label.toLowerCase()}`}
      >
        {label}
        <Icon className={cn("size-3", !active && "opacity-40")} aria-hidden />
      </Link>
    </Th>
  );
}
