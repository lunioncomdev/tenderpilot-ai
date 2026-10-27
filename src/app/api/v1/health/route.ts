import { NextResponse } from "next/server";
import { prisma } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "degraded", database: "unreachable" }, { status: 503 });
  }
}
