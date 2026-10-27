import { BOAMP_IT_DESCRIPTORS } from "./defaults";
import { ThrottledHttp } from "./http";
import {
  attr,
  durationToMonths,
  findAll,
  findFirst,
  parseEformsDateTime,
  text,
  toNumber,
  uniq,
} from "./parse";
import type { ConnectorQuery, NormalizedNotice, NoticeKind, TenderConnector } from "./types";

/**
 * Connecteur BOAMP — API Explore v2.1 (Opendatasoft) publiée par la DILA.
 * Données sous Licence Ouverte Etalab, sans authentification.
 * https://boamp-datadila.opendatasoft.com/explore/dataset/boamp/api/
 */

export type BoampRecord = {
  idweb: string;
  objet: string | null;
  nature: string | null;
  nature_libelle?: string | null;
  etat: string | null;
  dateparution: string | null;
  datelimitereponse: string | null;
  nomacheteur: string | null;
  code_departement?: string[] | null;
  type_marche?: string[] | null;
  procedure_libelle?: string | null;
  annonce_lie?: string[] | null;
  annonces_anterieures?: string[] | string | null;
  contractfolderid?: string | null;
  descripteur_libelle?: string[] | null;
  url_avis?: string | null;
  donnees?: string | null;
};

type BoampPage = { total_count: number; results: BoampRecord[] };

const PAGE_SIZE = 100;
const MAX_OFFSET = 9_900; // limite offset+limit de l'API (10 000)
const NATURES = ["APPEL_OFFRE", "RECTIFICATIF", "ANNULATION", "ATTRIBUTION"];

function odsString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Construit la clause ODSQL. Les valeurs sont échappées (pas d'injection ODSQL). */
export function buildBoampWhere(from: Date, to: Date, keywords: string[]): string {
  const filters = [
    ...BOAMP_IT_DESCRIPTORS.map((d) => `descripteur_libelle = ${odsString(d)}`),
    ...keywords.slice(0, 30).map((k) => `search(objet, ${odsString(k)})`),
  ];
  return [
    `dateparution >= date'${isoDay(from)}'`,
    `dateparution <= date'${isoDay(to)}'`,
    `nature IN (${NATURES.map(odsString).join(", ")})`,
    `(${filters.join(" OR ")})`,
  ].join(" AND ");
}

function kindOf(r: BoampRecord): NoticeKind {
  switch (r.nature) {
    case "ANNULATION":
      return "CANCELLATION";
    case "ATTRIBUTION":
      return "AWARD";
    case "RECTIFICATIF":
      return "CORRECTION";
    case "PRE-INFORMATION":
      return "PRIOR_INFO";
    default:
      return r.etat === "RECTIFICATIF" || r.etat === "MODIFICATION" ? "CORRECTION" : "TENDER";
  }
}

function asArray(v: string[] | string | null | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export function normalizeBoampRecord(r: BoampRecord): NormalizedNotice {
  let donnees: unknown = null;
  if (r.donnees) {
    try {
      donnees = JSON.parse(r.donnees);
    } catch {
      donnees = null;
    }
  }

  const project = findFirst(donnees, "cac:ProcurementProject");
  const description = text(findFirst(project, "cbc:Description")) ?? "";

  const amountNode = findFirst(donnees, "cbc:EstimatedOverallContractAmount");
  const estimatedValue = toNumber(amountNode);
  const currency = estimatedValue !== null ? (attr(amountNode, "currencyID") ?? "EUR") : null;

  const cpvCodes = uniq(
    findAll(donnees, "cbc:ItemClassificationCode")
      .filter((n) => (attr(n, "listName") ?? "cpv").toLowerCase() === "cpv")
      .map((n) => text(n))
      .filter((s): s is string => !!s),
  );

  let deadlineAt: Date | null = r.datelimitereponse ? new Date(r.datelimitereponse) : null;
  if (!deadlineAt) {
    const period =
      findFirst(donnees, "cac:TenderSubmissionDeadlinePeriod") ??
      findFirst(donnees, "cac:ParticipationRequestReceptionPeriod");
    if (period && typeof period === "object") {
      const p = period as Record<string, unknown>;
      deadlineAt = parseEformsDateTime(text(p["cbc:EndDate"]), text(p["cbc:EndTime"]));
    }
  }

  const durationNode = findFirst(findFirst(donnees, "cac:PlannedPeriod"), "cbc:DurationMeasure");
  const durationMonths = durationToMonths(toNumber(durationNode), attr(durationNode, "unitCode"));

  const docRef = findFirst(donnees, "cac:CallForTendersDocumentReference");
  const documentsUrl = text(findFirst(docRef, "cbc:URI"));

  return {
    source: "BOAMP",
    externalId: r.idweb,
    publicationRef: r.idweb,
    procedureId: r.contractfolderid ?? null,
    kind: kindOf(r),
    relatedExternalIds: uniq([...asArray(r.annonce_lie), ...asArray(r.annonces_anterieures)]),
    title: (r.objet ?? "").trim() || `Avis BOAMP ${r.idweb}`,
    description: description.trim(),
    buyerName: (r.nomacheteur ?? "").trim(),
    buyerCountry: "FR",
    region: r.code_departement?.[0] ?? null,
    cpvCodes,
    estimatedValue,
    currency,
    publishedAt: r.dateparution ? new Date(`${r.dateparution}T00:00:00Z`) : null,
    deadlineAt: deadlineAt && !Number.isNaN(deadlineAt.getTime()) ? deadlineAt : null,
    procedureType: r.procedure_libelle ?? null,
    noticeType: r.nature_libelle ?? r.nature ?? null,
    contractType: r.type_marche?.[0] ?? null,
    durationMonths,
    noticeUrl: r.url_avis ?? `https://www.boamp.fr/pages/avis/?q=idweb:${r.idweb}`,
    documentsUrl,
    version: null,
    raw: { ...r, donnees: undefined },
  };
}

export class BoampConnector implements TenderConnector {
  readonly key = "BOAMP" as const;
  readonly label = "BOAMP";
  readonly description = "Bulletin officiel des annonces des marchés publics (France) — API ouverte de la DILA";

  constructor(
    private readonly baseUrl: string,
    private readonly http = new ThrottledHttp({ minIntervalMs: 1000 }),
  ) {}

  async *fetchNotices(q: ConnectorQuery): AsyncGenerator<NormalizedNotice> {
    if (q.countries.length && !q.countries.includes("FR")) return;
    const until = q.until ?? new Date();
    let emitted = 0;
    // Fenêtres de 7 jours, découpées si la fenêtre dépasse la limite d'offset.
    const windows: Array<[Date, Date]> = [];
    for (let start = new Date(q.since); start <= until; start = addDays(start, 7)) {
      const end = addDays(start, 6);
      windows.push([start, end > until ? until : end]);
    }
    while (windows.length) {
      const [from, to] = windows.shift()!;
      const where = buildBoampWhere(from, to, q.keywords);
      const first = await this.page(where, 0);
      if (first.total_count > MAX_OFFSET + PAGE_SIZE && to.getTime() - from.getTime() >= 86_400_000) {
        const mid = new Date((from.getTime() + to.getTime()) / 2);
        windows.unshift([from, mid], [addDays(mid, 1), to]);
        continue;
      }
      let page = first;
      let offset = 0;
      for (;;) {
        for (const r of page.results) {
          yield normalizeBoampRecord(r);
          if (q.maxNotices && ++emitted >= q.maxNotices) return;
        }
        offset += PAGE_SIZE;
        if (offset >= page.total_count || offset > MAX_OFFSET || page.results.length === 0) break;
        page = await this.page(where, offset);
      }
    }
  }

  private page(where: string, offset: number): Promise<BoampPage> {
    const params = new URLSearchParams({
      where,
      limit: String(PAGE_SIZE),
      offset: String(offset),
      order_by: "dateparution ASC, idweb ASC",
    });
    return this.http.json<BoampPage>(`${this.baseUrl}/records?${params}`);
  }
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}
