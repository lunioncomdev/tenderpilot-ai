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
  const file = await prisma.applicationPieceFile.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!file) return jsonError(404, "Fichier introuvable");
  const url = await storage().signedDownloadUrl(file.storageKey, file.filename, 300);
  return NextResponse.redirect(new URL(url, req.url), 302);
}
