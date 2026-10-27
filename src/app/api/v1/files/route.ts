import { NextResponse, type NextRequest } from "next/server";
import { jsonError } from "@/server/api";
import { storage, verifyLocalToken } from "@/server/documents/storage";

export const runtime = "nodejs";

/** Téléchargement via lien signé (driver de stockage local uniquement). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const key = sp.get("key") ?? "";
  const name = sp.get("name") ?? "document";
  const exp = Number(sp.get("exp"));
  const sig = sp.get("sig") ?? "";
  if (!verifyLocalToken(key, name, exp, sig)) return jsonError(403, "Lien expiré ou invalide");
  try {
    const data = await storage().get(key);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return jsonError(404, "Fichier introuvable");
  }
}
