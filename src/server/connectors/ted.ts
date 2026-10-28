import { COUNTRY_ISO2_TO_ISO3, COUNTRY_ISO3_TO_ISO2 } from "./defaults";
import { ThrottledHttp } from "./http";
import { cpvToPattern, durationToMonths, parseEformsDateTime, pickLang, uniq } from "./parse";
import type { ConnectorQuery, NormalizedNotice, NoticeKind, TenderConnector } from "./types";

/**
 * Connecteur TED — API Search v3 (accès anonyme, données réutilisables).
 * https://docs.ted.europa.eu/api/latest/search.html
 */

export { cpvToPattern };

export const TED_FIELDS = [
  "publication-number",
  "notice-identifier",
  "procedure-identifier",
  "notice-version",
  "notice-title",
  "title-proc",
  "description-proc",
  "buyer-name",
  "buyer-country",
  "organisation-city-buyer",
  "deadline-receipt-tender-date-lot",
  "deadline-receipt-request-date-lot",
  "publication-date",
  "classification-cpv",
  "estimated-value-proc",
  "estimated-value-cur-proc",
  "estimated-value-lot",
  "notice-type",
  "procedure-type",
  "contract-nature",
  "place-of-performance-subdiv-lot",
  "document-url-lot",
  "duration-period-value-lot",
  "duration-period-unit-lot",
];

export type TedNotice = Record<string, unknown>;
type TedResponse = { notices: TedNotice[]; totalNoticeCount: number; iterationNextToken?: string | null };

const PAGE_SIZE = 100;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export function buildTedQuery(q: ConnectorQuery): string {
  const cpv = uniq(q.cpvCodes.map(cpvToPattern));
  const parts = [`classification-cpv IN (${cpv.join(" ")})`];
  const countries = q.countries.map((c) => COUNTRY_ISO2_TO_ISO3[c]).filter(Boolean);
  if (countries.length) parts.push(`buyer-country IN (${countries.join(" ")})`);
  parts.push(`publication-date>=${ymd(q.since)}`);
  if (q.until) parts.push(`publication-date<=${ymd(q.until)}`);
  return `${parts.join(" AND ")} SORT BY publication-date`; // ordre croissant par défaut ; « ASC » est refusé par l'API
}

function first(v: unknown): string | null {
  if (Array.isArray(v)) return v.length ? first(v[0]) : null;
  if (v === null || v === undefined) return null;
  return String(v);
}

function kindOf(noticeType: string | null): NoticeKind {
  if (!noticeType) return "TENDER";
  if (noticeType.startsWith("can") || noticeType.startsWith("veat")) return "AWARD";
  if (noticeType.startsWith("pin") && !noticeType.includes("cfc")) return "PRIOR_INFO";
  if (noticeType.startsWith("corr")) return "CORRECTION";
  return "TENDER";
}

/** Titre de procédure, sinon titre de l'avis sans le préfixe « Pays – CPV – ». */
function titleOf(n: TedNotice): string {
  const proc = pickLang(n["title-proc"]);
  if (proc) return proc;
  const nt = pickLang(n["notice-title"]) ?? "";
  const parts = nt.split(" – ");
  return parts.length >= 3 ? parts.slice(2).join(" – ") : nt;
}

export function normalizeTedNotice(n: TedNotice): NormalizedNotice {
  const publicationNumber = String(n["publication-number"]);
  const noticeType = first(n["notice-type"]);
  const deadlineRaw = first(n["deadline-receipt-tender-date-lot"]) ?? first(n["deadline-receipt-request-date-lot"]);
  const valueRaw = first(n["estimated-value-proc"]) ?? first(n["estimated-value-lot"]);
  const value = valueRaw !== null ? Number(valueRaw) : null;
  const country3 = first(n["buyer-country"]);
  const durationValue = first(n["duration-period-value-lot"]);
  const lang = "fr";
  const docUrl = first(n["document-url-lot"]);

  return {
    source: "TED",
    externalId: String(n["notice-identifier"] ?? publicationNumber),
    publicationRef: publicationNumber,
    procedureId: first(n["procedure-identifier"]),
    kind: kindOf(noticeType),
    relatedExternalIds: [],
    title: titleOf(n).trim() || `Avis TED ${publicationNumber}`,
    description: (pickLang(n["description-proc"]) ?? "").trim(),
    buyerName: (pickLang(n["buyer-name"]) ?? "").trim(),
    buyerCountry: country3 ? (COUNTRY_ISO3_TO_ISO2[country3] ?? country3) : null,
    region: first(n["place-of-performance-subdiv-lot"]),
    cpvCodes: uniq(((n["classification-cpv"] as string[] | undefined) ?? []).map(String)),
    estimatedValue: value !== null && Number.isFinite(value) ? value : null,
    currency: value !== null ? (first(n["estimated-value-cur-proc"]) ?? "EUR") : null,
    publishedAt: parseEformsDateTime(first(n["publication-date"]), "00:00:00"),
    deadlineAt: parseEformsDateTime(deadlineRaw),
    procedureType: first(n["procedure-type"]),
    noticeType,
    contractType: first(n["contract-nature"])?.toUpperCase() ?? null,
    durationMonths: durationToMonths(durationValue !== null ? Number(durationValue) : null, first(n["duration-period-unit-lot"])),
    noticeUrl: `https://ted.europa.eu/${lang}/notice/-/detail/${publicationNumber}`,
    documentsUrl: docUrl ? docUrl.replace(/&amp;/g, "&") : null,
    version: n["notice-version"] !== undefined ? Number(n["notice-version"]) : null,
    raw: { ...n, links: undefined },
  };
}

export class TedConnector implements TenderConnector {
  readonly key = "TED" as const;
  readonly label = "TED";
  readonly description = "Tenders Electronic Daily — Journal officiel de l'UE (API Search v3)";

  constructor(
    private readonly baseUrl: string,
    private readonly http = new ThrottledHttp({ minIntervalMs: 1000 }),
  ) {}

  async *fetchNotices(q: ConnectorQuery): AsyncGenerator<NormalizedNotice> {
    const query = buildTedQuery(q);
    let token: string | null | undefined = undefined;
    let emitted = 0;
    for (;;) {
      const body: Record<string, unknown> = {
        query,
        fields: TED_FIELDS,
        limit: PAGE_SIZE,
        paginationMode: "ITERATION",
        scope: "ALL",
        checkQuerySyntax: false,
      };
      if (token) body.iterationNextToken = token;
      const res: TedResponse = await this.http.json<TedResponse>(`${this.baseUrl}/notices/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      for (const n of res.notices ?? []) {
        yield normalizeTedNotice(n);
        if (q.maxNotices && ++emitted >= q.maxNotices) return;
      }
      token = res.iterationNextToken;
      if (!token || !res.notices?.length) return;
    }
  }
}
