import { parseAtexoUrl, type AtexoRef } from "./atexo";

/** Plateformes acheteurs connues, par nom d'hôte. */
export const KNOWN_PLATFORMS: Array<{ host: string; name: string; engine: "atexo" | "account" }> = [
  { host: "www.marches-publics.gouv.fr", name: "PLACE (État)", engine: "atexo" },
  { host: "marches.maximilien.fr", name: "Maximilien (Île-de-France)", engine: "atexo" },
  { host: "webmarche.solaere.recia.fr", name: "Solaere (Centre-Val de Loire)", engine: "atexo" },
  { host: "marchespublics596280.fr", name: "Marchés publics Nord / Pas-de-Calais", engine: "atexo" },
  { host: "marches.megalis.bretagne.bzh", name: "Mégalis Bretagne", engine: "atexo" },
  { host: "marchespublics.auvergnerhonealpes.eu", name: "AURA (Auvergne-Rhône-Alpes)", engine: "atexo" },
  { host: "www.marches-publics.info", name: "AWS-Achat (marches-publics.info)", engine: "account" },
  { host: "www.achatpublic.com", name: "achatpublic.com", engine: "account" },
  { host: "www.klekoon.com", name: "Klekoon", engine: "account" },
  { host: "www.e-marchespublics.com", name: "e-marchespublics", engine: "account" },
  { host: "www.marches-securises.fr", name: "marches-securises.fr", engine: "account" },
];

export type DcePlatform =
  | { kind: "atexo"; host: string; name: string; ref: AtexoRef }
  | { kind: "account"; host: string; name: string }
  | { kind: "generic"; host: string; name: string }
  | { kind: "none" };

export function platformName(host: string): string {
  return KNOWN_PLATFORMS.find((p) => p.host === host)?.name ?? host;
}

/** Plateforme d'un lien DCE et possibilité de retrait automatique. */
export function detectPlatform(documentsUrl: string | null | undefined): DcePlatform {
  if (!documentsUrl) return { kind: "none" };
  let host: string;
  try {
    host = new URL(documentsUrl.replace(/&amp;/g, "&")).hostname.toLowerCase();
  } catch {
    return { kind: "none" };
  }
  const atexo = parseAtexoUrl(documentsUrl);
  if (atexo) return { kind: "atexo", host, name: platformName(host), ref: atexo };
  if (KNOWN_PLATFORMS.some((p) => p.host === host && p.engine === "account")) return { kind: "account", host, name: platformName(host) };
  return { kind: "generic", host, name: platformName(host) };
}
