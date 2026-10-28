import { Prisma, type TenderStatus } from "@prisma/client";
import { z } from "zod/v4";
import { prisma } from "../db";

const optNum = z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : Number(v)), z.number().nonnegative().optional());
const optDate = z.preprocess((v) => (v ? new Date(String(v)) : undefined), z.date().optional());
const optStr = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().max(200).optional());
const optBool = z.preprocess((v) => v === true || v === "1" || v === "true" || v === "on", z.boolean());

export const SearchFiltersSchema = z.object({
  q: optStr,
  country: optStr,
  region: optStr,
  cpv: optStr,
  origin: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["BOAMP", "TED", "APPROCH", "MANUAL"]).optional()),
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum([
    "DETECTED", "TO_ANALYZE", "QUALIFIED", "GO", "NO_GO", "IN_PREPARATION", "IN_VALIDATION",
    "READY_TO_SUBMIT", "SUBMITTED", "AWAITING_DECISION", "WON", "LOST",
  ]).optional()),
  contractType: optStr,
  procedureType: optStr,
  minBudget: optNum,
  maxBudget: optNum,
  minScore: optNum,
  publishedFrom: optDate,
  deadlineFrom: optDate,
  deadlineTo: optDate,
  maxDurationMonths: optNum,
  includeExpired: optBool.default(false),
  includeDuplicates: optBool.default(false),
  includeClosed: optBool.default(false),
  sort: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["relevance", "deadline", "published", "score", "value", "title", "status"]).optional()),
  /** Sens du tri ; par défaut, celui de la colonne (montant et score décroissants, échéance croissante…). */
  dir: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["asc", "desc"]).optional()),
  page: z.preprocess((v) => (v ? Number(v) : 1), z.number().int().min(1).max(500)).default(1),
});

export type SearchFilters = Partial<z.input<typeof SearchFiltersSchema>>;
export type TenderSort = NonNullable<z.infer<typeof SearchFiltersSchema>["sort"]>;

export const DEFAULT_DIR: Record<TenderSort, "asc" | "desc"> = {
  relevance: "desc", published: "desc", score: "desc", value: "desc", deadline: "asc", title: "asc", status: "asc",
};
const PAGE_SIZE = 25;

export function parseSearchParams(sp: Record<string, string | string[] | undefined>) {
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const r = SearchFiltersSchema.safeParse(flat);
  return r.success ? r.data : SearchFiltersSchema.parse({});
}

/** Identifiants correspondant à la requête plein texte, triés par pertinence. */
async function fullTextIds(orgId: string, q: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM "Tender"
    WHERE "organizationId" = ${orgId}
      AND search_vector @@ websearch_to_tsquery('french', tp_immutable_unaccent(${q}))
    ORDER BY ts_rank(search_vector, websearch_to_tsquery('french', tp_immutable_unaccent(${q}))) DESC
    LIMIT 2000`);
  return rows.map((r) => r.id);
}

export async function searchTenders(orgId: string, input: SearchFilters, now = new Date()) {
  const f = SearchFiltersSchema.parse(input);
  const where: Prisma.TenderWhereInput = { organizationId: orgId };
  const and: Prisma.TenderWhereInput[] = [];
  let rankedIds: string[] | null = null;

  if (f.q) {
    rankedIds = await fullTextIds(orgId, f.q);
    and.push({ id: { in: rankedIds } });
  }
  if (!f.includeDuplicates) and.push({ duplicateOfId: null });
  if (!f.includeExpired) and.push({ OR: [{ deadlineAt: null }, { deadlineAt: { gte: now } }] });
  if (!f.includeClosed) and.push({ noticeState: { in: ["ACTIVE", "MODIFIED"] } });
  if (f.country) and.push({ buyerCountry: f.country.toUpperCase() });
  if (f.region) and.push({ region: { startsWith: f.region } });
  if (f.cpv) and.push({ cpvCodes: { hasSome: [f.cpv] } });
  if (f.origin) and.push({ origin: f.origin });
  if (f.status) and.push({ status: f.status as TenderStatus });
  if (f.contractType) and.push({ contractType: { equals: f.contractType, mode: "insensitive" } });
  if (f.procedureType) and.push({ procedureType: { contains: f.procedureType, mode: "insensitive" } });
  if (f.minBudget !== undefined) and.push({ estimatedValue: { gte: f.minBudget } });
  if (f.maxBudget !== undefined) and.push({ estimatedValue: { lte: f.maxBudget } });
  if (f.minScore !== undefined) and.push({ preScore: { gte: f.minScore } });
  if (f.publishedFrom) and.push({ publishedAt: { gte: f.publishedFrom } });
  if (f.deadlineFrom) and.push({ deadlineAt: { gte: f.deadlineFrom } });
  if (f.deadlineTo) and.push({ deadlineAt: { lte: f.deadlineTo } });
  if (f.maxDurationMonths !== undefined) and.push({ durationMonths: { lte: f.maxDurationMonths } });
  where.AND = and;

  const sort = f.sort ?? (f.q ? "relevance" : "published");
  const dir = f.dir ?? DEFAULT_DIR[sort];
  const orderBy: Prisma.TenderOrderByWithRelationInput[] = [
    sort === "deadline"
      ? { deadlineAt: { sort: dir, nulls: "last" } }
      : sort === "score"
        ? { preScore: { sort: dir, nulls: "last" } }
        : sort === "value"
          ? { estimatedValue: { sort: dir, nulls: "last" } }
          : sort === "title"
            ? { title: dir }
            : sort === "status"
              ? { status: dir }
              : { publishedAt: { sort: dir, nulls: "last" } },
    { id: "asc" }, // ordre stable d'une page à l'autre
  ];

  const select = {
    id: true, externalId: true, publicationRef: true, origin: true, title: true, buyerName: true, buyerCountry: true,
    region: true, estimatedValue: true, currency: true, publishedAt: true, deadlineAt: true, status: true,
    noticeState: true, preScore: true, procedureType: true, cpvCodes: true,
    scores: { orderBy: { createdAt: "desc" as const }, take: 1, select: { total: true, recommendation: true } },
  } satisfies Prisma.TenderSelect;

  if (sort === "relevance" && rankedIds) {
    const all = await prisma.tender.findMany({ where, select: { id: true } });
    const allowed = new Set(all.map((t) => t.id));
    const ordered = rankedIds.filter((id) => allowed.has(id));
    const pageIds = ordered.slice((f.page - 1) * PAGE_SIZE, f.page * PAGE_SIZE);
    const rows = await prisma.tender.findMany({ where: { id: { in: pageIds } }, select });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return { items: pageIds.map((id) => byId.get(id)!).filter(Boolean), total: ordered.length, page: f.page, pageSize: PAGE_SIZE, filters: f };
  }

  const [items, total] = await Promise.all([
    prisma.tender.findMany({ where, orderBy, skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE, select }),
    prisma.tender.count({ where }),
  ]);
  return { items, total, page: f.page, pageSize: PAGE_SIZE, filters: f };
}
