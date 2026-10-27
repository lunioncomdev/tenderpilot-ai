import type { Role } from "@prisma/client";

const RANK: Record<Role, number> = { VIEWER: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

export function hasRole(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required];
}

export class ForbiddenError extends Error {
  constructor(message = "Action non autorisée pour votre rôle") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Ressource introuvable") {
    super(message);
    this.name = "NotFoundError";
  }
}

export function assertRole(actual: Role, required: Role): void {
  if (!hasRole(actual, required)) throw new ForbiddenError();
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Propriétaire",
  ADMIN: "Administrateur",
  MEMBER: "Membre",
  VIEWER: "Lecteur",
};
