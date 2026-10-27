import type { SourceKey } from "@prisma/client";
import { env } from "../env";
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
    description: "Tenders Electronic Daily — Union européenne",
    url: "https://docs.ted.europa.eu/api/latest/index.html",
    licence: "Réutilisation libre (décision 2011/833/UE) — API Search anonyme",
  },
};

export function getConnector(key: SourceKey): TenderConnector {
  switch (key) {
    case "BOAMP":
      return new BoampConnector(env().BOAMP_BASE_URL);
    case "TED":
      return new TedConnector(env().TED_BASE_URL);
  }
}

export const ALL_SOURCES: SourceKey[] = ["BOAMP", "TED"];
