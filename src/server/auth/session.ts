import { createHash, randomBytes } from "node:crypto";
import type { Role } from "@prisma/client";
import { prisma } from "../db";

export const SESSION_COOKIE = "tp_session";
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const RENEW_THRESHOLD_MS = 24 * 3600 * 1000;

export type AuthContext = {
  userId: string;
  orgId: string;
  role: Role;
  email: string;
  name: string;
  orgName: string;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  orgId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      organizationId: orgId,
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    },
  });
  return { token, expiresAt };
}

/** Valide un jeton ; renouvelle l'expiration glissante si nécessaire. */
export async function validateSessionToken(token: string): Promise<AuthContext | null> {
  if (!token || token.length > 100) return null;
  const id = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { id },
    include: { user: true, organization: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id } }).catch(() => undefined);
    return null;
  }
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: session.userId, organizationId: session.organizationId } },
  });
  if (!membership) return null;
  if (session.expiresAt.getTime() - Date.now() < SESSION_TTL_MS - RENEW_THRESHOLD_MS) {
    await prisma.session.update({ where: { id }, data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) } });
  }
  return {
    userId: session.userId,
    orgId: session.organizationId,
    role: membership.role,
    email: session.user.email,
    name: session.user.name,
    orgName: session.organization.name,
  };
}

export async function invalidateSession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: hashToken(token) } });
}
