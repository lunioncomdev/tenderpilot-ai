import bcrypt from "bcryptjs";
import { z } from "zod/v4";

const COST = 12;

export const PasswordSchema = z
  .string()
  .min(12, "12 caractères minimum")
  .max(128)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), {
    message: "Doit contenir une minuscule, une majuscule et un chiffre",
  });

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

let dummyHash: Promise<string> | undefined;

/** Hash factice pour garder un temps de réponse constant quand l'utilisateur n'existe pas. */
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= bcrypt.hash("timing-equalizer", COST);
  return dummyHash;
}
