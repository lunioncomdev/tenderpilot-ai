import { NextResponse, type NextRequest } from "next/server";
import { apiAuth } from "@/server/api";
import { parseSearchParams, searchTenders } from "@/server/tenders/search";

export const runtime = "nodejs";

/**
 * GET /api/v1/tenders — liste paginée et filtrée (mêmes paramètres que l'écran
 * « Explorer » : q, country, region, origin, status, minBudget, maxBudget,
 * publishedFrom, deadlineFrom, deadlineTo, minScore, cpv, sort, page…).
 */
export async function GET(req: NextRequest) {
  const ctx = await apiAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const filters = parseSearchParams(Object.fromEntries(req.nextUrl.searchParams));
  const res = await searchTenders(ctx.orgId, filters);
  return NextResponse.json({
    total: res.total,
    page: res.page,
    pageSize: res.pageSize,
    items: res.items.map((t) => ({ ...t, estimatedValue: t.estimatedValue?.toString() ?? null })),
  });
}
