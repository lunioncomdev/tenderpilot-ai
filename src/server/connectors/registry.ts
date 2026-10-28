import type { SourceKey } from "@prisma/client";
import { env } from "../env";
import { ApprochConnector } from "./approch";
import { BoampConnector } from "./boamp";
import { TedConnector } from "./ted";
import type { TenderConnector } from "./types";

export const SOURCE_META: Record<SourceKey, { label: string; description: string; url: string; licence: string }> = {
  BOAMP: {
    label: "BOAMP",
    description: "Bulletin officiel des annonces des marchés publics — France",
    url: "https://boamp-datadila.opendatasoft.com/explore/dataset/boamp/",
    licence: "Licence Ouverte / Etalab — API publique sans authentification",
  },
  TED: {
    label: "TED",
    description: "Tenders Electronic Daily — avis européens des acheteurs français",
    url: "https://docs.ted.europa.eu/api/latest/index.html",
    licence: "Réutilisation libre (décision 2011/833/UE) — API Search anonyme",
  },
  APPROCH: {
    label: "APProch",
    description: "Projets d'achats publics annoncés avant la consultation — France",
    url: "https://www.data.gouv.fr/datasets/projets-dachats-publics",
    licence: "Licence Ouverte / Etalab — API publique sans authentification",
  },
};

export function getConnector(key: SourceKey): TenderConnector {
  switch (key) {
    case "BOAMP":
      return new BoampConnector(env().BOAMP_BASE_URL);
    case "TED":
      return new TedConnector(env().TED_BASE_URL);
    case "APPROCH":
      return new ApprochConnector(env().APPROCH_BASE_URL);
  }
}

/** Sources synchronisées. TED est coupé : seuls les marchés français sont suivis. */
export const ALL_SOURCES: SourceKey[] = ["BOAMP", "APPROCH"];
