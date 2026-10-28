/** Codes CPV par défaut (développement web et applicatif). */
export const DEFAULT_CPV_CODES = [
  "72212000", // Programmation de logiciels d'application
  "72230000", // Développement de logiciels personnalisés
  "72262000", // Développement de logiciels
  "72413000", // Conception de sites WWW
  "72420000", // Développement d'Internet
  "72421000", // Développement d'applications clients Internet ou intranet
  "72422000", // Développement d'applications serveur Internet ou intranet
];

export const DEFAULT_KEYWORDS = [
  "site internet",
  "site web",
  "application web",
  "application mobile",
  "plateforme web",
  "plateforme numérique",
  "portail",
  "intranet",
  "extranet",
  "développement web",
  "développement d'application",
  "refonte",
  "chatbot",
  "API",
];

/** Descripteurs BOAMP correspondant aux prestations informatiques logicielles. */
export const BOAMP_IT_DESCRIPTORS = [
  "Logiciel",
  "Informatique (prestations de services)",
  "Progiciel",
  "Informatique (assistance)",
];

export const COUNTRY_ISO3_TO_ISO2: Record<string, string> = {
  FRA: "FR", BEL: "BE", LUX: "LU", CHE: "CH", DEU: "DE", ESP: "ES", ITA: "IT", NLD: "NL",
  PRT: "PT", AUT: "AT", IRL: "IE", POL: "PL", SWE: "SE", DNK: "DK", FIN: "FI", CZE: "CZ",
  GRC: "GR", HUN: "HU", ROU: "RO", BGR: "BG", HRV: "HR", SVK: "SK", SVN: "SI", EST: "EE",
  LVA: "LV", LTU: "LT", CYP: "CY", MLT: "MT", NOR: "NO", ISL: "IS", LIE: "LI",
};

export const COUNTRY_ISO2_TO_ISO3: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_ISO3_TO_ISO2).map(([k, v]) => [v, k]),
);
