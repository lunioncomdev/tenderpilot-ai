import "server-only";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { hasRole } from "./auth/rbac";
import { SESSION_COOKIE, validateSessionToken, type AuthContext } from "./auth/session";

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/** Authentifie une requête d'API et vérifie le rôle ; protège les mutations contre le CSRF (contrôle d'origine). */
export async function apiAuth(req: NextRequest, minRole: Role = "VIEWER"): Promise<AuthContext | NextResponse> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!origin || !host || new URL(origin).host !== host) return jsonError(403, "Origine non autorisée");
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const ctx = token ? await validateSessionToken(token) : null;
  if (!ctx) return jsonError(401, "Non authentifié");
  if (!hasRole(ctx.role, minRole)) return jsonError(403, "Rôle insuffisant");
  return ctx;
}
