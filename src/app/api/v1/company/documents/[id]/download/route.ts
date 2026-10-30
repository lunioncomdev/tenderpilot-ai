import { NextResponse, type NextRequest } from "next/server";
import { apiAuth, jsonError } from "@/server/api";
import { prisma } from "@/server/db";
import { storage } from "@/server/documents/storage";

export const runtime = "nodejs";

/** Contrôle d'accès puis redirection vers une URL signée valable 5 minutes. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await apiAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const doc = await prisma.companyDocument.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!doc) return jsonError(404, "Pièce introuvable");
  const url = await storage().signedDownloadUrl(doc.storageKey, doc.filename, 300);
  return NextResponse.redirect(new URL(url, req.url), 302);
}
