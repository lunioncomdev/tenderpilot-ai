import { prisma } from "../db";
import { DEFAULT_CPV_CODES, DEFAULT_KEYWORDS } from "../connectors/defaults";
import { dummyPasswordHash, hashPassword, verifyPassword } from "./password";

/**
 * Crée une organisation, son propriétaire, un profil entreprise initial et la
 * configuration des sources (BOAMP et TED actives).
 */
export async function createOrganizationWithOwner(input: {
  orgName: string;
  email: string;
  name: string;
  password: string;
}) {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: input.orgName.trim() } });
    const user = await tx.user.create({ data: { email, name: input.name.trim(), passwordHash } });
    await tx.membership.create({ data: { userId: user.id, organizationId: org.id, role: "OWNER" } });
    await tx.companyProfile.create({
      data: {
        organizationId: org.id,
        legalName: input.orgName.trim(),
        cpvCodes: DEFAULT_CPV_CODES,
        keywords: DEFAULT_KEYWORDS,
      },
    });
    await tx.sourceConfig.createMany({
      data: [
        { organizationId: org.id, source: "BOAMP", enabled: true, settings: { daysBack: 14 } },
        { organizationId: org.id, source: "APPROCH", enabled: true, settings: {} },
      ],
    });
    return { org, user };
  });
}

/** Vérifie les identifiants ; temps de réponse homogène que l'utilisateur existe ou non. */
export async function authenticate(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyPasswordHash()));
  if (!user || !ok || !user.memberships[0]) return null;
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { user, orgId: user.memberships[0].organizationId };
}

export async function hasAnyUser(): Promise<boolean> {
  return (await prisma.user.count()) > 0;
}
