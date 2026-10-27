export type NoticeKind = "TENDER" | "CORRECTION" | "CANCELLATION" | "AWARD" | "PRIOR_INFO";

/** Avis normalisé, indépendant de la source. */
export type NormalizedNotice = {
  source: "BOAMP" | "TED";
  externalId: string;
  publicationRef: string;
  procedureId: string | null;
  kind: NoticeKind;
  /** Identifiants officiels d'avis antérieurs visés (rectificatif, annulation). */
  relatedExternalIds: string[];
  title: string;
  description: string;
  buyerName: string;
  buyerCountry: string | null;
  region: string | null;
  cpvCodes: string[];
  estimatedValue: number | null;
  currency: string | null;
  publishedAt: Date | null;
  deadlineAt: Date | null;
  procedureType: string | null;
  noticeType: string | null;
  contractType: string | null;
  durationMonths: number | null;
  noticeUrl: string | null;
  documentsUrl: string | null;
  version: number | null;
  raw: unknown;
};

export type ConnectorQuery = {
  since: Date;
  until?: Date;
  cpvCodes: string[];
  keywords: string[];
  /** Pays acheteur ISO alpha-2 (vide = tous). */
  countries: string[];
  maxNotices?: number;
};

export interface TenderConnector {
  readonly key: "BOAMP" | "TED";
  readonly label: string;
  readonly description: string;
  /** Récupère les avis (pagination gérée par le connecteur). */
  fetchNotices(query: ConnectorQuery): AsyncGenerator<NormalizedNotice>;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
