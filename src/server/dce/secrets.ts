import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { env } from "../env";

/**
 * Chiffrement des identifiants de plateformes (AES-256-GCM). Clé : CREDENTIALS_KEY
 * si définie, sinon dérivée de SESSION_SECRET (HKDF). Changer la clé rend les mots
 * de passe enregistrés illisibles : il faut alors les ressaisir.
 * Format : v1.<iv>.<tag>.<chiffré> (base64url).
 */
function key(): Buffer {
  const { CREDENTIALS_KEY, SESSION_SECRET } = env();
  if (CREDENTIALS_KEY) return createHash("sha256").update(CREDENTIALS_KEY).digest();
  return Buffer.from(hkdfSync("sha256", SESSION_SECRET, "tenderpilot", "platform-credentials", 32));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv, c.getAuthTag(), enc].map((x) => (typeof x === "string" ? x : x.toString("base64url"))).join(".");
}

export function decryptSecret(token: string): string {
  const [v, iv, tag, enc] = token.split(".");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("Secret chiffré invalide");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
  } catch {
    throw new Error("Mot de passe de plateforme illisible (clé de chiffrement modifiée ?) : ressaisissez-le dans Paramètres");
  }
}
