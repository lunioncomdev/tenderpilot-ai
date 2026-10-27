/** Codes CPV par défaut (services informatiques / développement logiciel). */
export const DEFAULT_CPV_CODES = [
  "72000000", // Services de technologies de l'information
  "72200000", // Programmation de logiciels et services de conseil
  "72210000", // Programmation de progiciels
  "72212000", // Programmation de logiciels d'application
  "72262000", // Développement de logiciels
  "72267000", // Maintenance et réparation de logiciels
  "72413000", // Conception de sites WWW
];

export const DEFAULT_KEYWORDS = [
  "développement application web",
  "développement logiciel",
  "application métier",
  "plateforme SaaS",
  "refonte applicative",
  "intelligence artificielle",
  "automatisation",
  "chatbot",
  "API",
  "maintenance applicative",
  "TMA",
  "portail web",
  "digitalisation",
  "transformation numérique",
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
