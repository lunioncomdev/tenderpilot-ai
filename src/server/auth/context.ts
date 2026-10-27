import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@prisma/client";
import { env } from "../env";
import { assertRole } from "./rbac";
import { SESSION_COOKIE, validateSessionToken, type AuthContext } from "./session";

/** Contexte de la requête courante (mémoïsé par rendu). */
export const getContext = cache(async (): Promise<AuthContext | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSessionToken(token);
});

/** Exige une session valide (redirige vers /login sinon) et éventuellement un rôle minimal. */
export async function requireContext(minRole: Role = "VIEWER"): Promise<AuthContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  assertRole(ctx.role, minRole);
  return ctx;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}
