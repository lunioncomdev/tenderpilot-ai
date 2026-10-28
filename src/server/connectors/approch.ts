import { ThrottledHttp } from "./http";
import { cpvToPattern, uniq } from "./parse";
import type { ConnectorQuery, NormalizedNotice, TenderConnector } from "./types";

/**
 * Connecteur APProch — projets d'achats publics publiés par les acheteurs avant
 * la consultation (Direction des Achats de l'État). Jeu Opendatasoft de
 * data.economie.gouv.fr, Licence Ouverte, sans authentification.
 * https://www.data.gouv.fr/datasets/projets-dachats-publics
 *
 * Le jeu est un instantané des projets ouverts, sans date de mise à jour : chaque
 * synchronisation relit tous les projets correspondant au profil. Les projets dont
 * la publication prévue est dépassée depuis plus de 3 mois sont ignorés (déjà
 * publiés ou abandonnés, mais restés « Ouvert » dans le jeu).
 */

export type ApprochRecord = {
  code: number;
  libelle: string | null;
  statut: string | null;
  description: string | null;
  siren_de_l_entite_acheteuse: number | null;
  categorie_d_achat: string | null;
  code_s_cpv: string | null;
  date_previsionnelle_de_publication: string | null;
  date_cible_de_remise_des_offres: string | null;
  type_de_procedure: string | null;
  lien_vers_la_consultation: string | null;
  montant_estime_du_marche: string | null;
  duree_previsionnelle_du_marche: number | null;
  departement_s_d_execution_du_marche: string | null;
};

type ApprochPage = { total_count: number; results: ApprochRecord[] };

const PAGE_SIZE = 100;
const STALE_DAYS = 90;
const MAX_OFFSET = 9_900; // limite offset+limit de l'API (10 000)
const PROJECT_URL = "https://projets-achats.marches-publics.gouv.fr/project";
/** API Recherche d'entreprises (api.gouv.fr) : le jeu ne donne que le SIREN de l'acheteur. */
const SIREN_LOOKUP_URL = "https://recherche-entreprises.api.gouv.fr/search";

function odsString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Construit la clause ODSQL. Les valeurs sont échappées (pas d'injection ODSQL). */
export function buildApprochWhere(cpvCodes: string[], keywords: string[], now: Date): string {
  const filters = [
    ...uniq(cpvCodes.map(cpvToPattern)).map((p) => `code_s_cpv LIKE ${odsString(p)}`),
    ...keywords.slice(0, 30).map((k) => `search(libelle, ${odsString(k)})`),
  ];
  const staleBefore = new Date(now.getTime() - STALE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const where = [
    `statut = "Ouvert"`,
    `(date_previsionnelle_de_publication IS NULL OR date_previsionnelle_de_publication >= date'${staleBefore}')`,
  ];
  if (filters.length) where.push(`(${filters.join(" OR ")})`);
  return where.join(" AND ");
}

const UNITS: Record<string, number> = { k: 1e3, M: 1e6 };

/** « 100k - 500k€ » → 300 000 (milieu de la fourchette) ; « + 100M€ » → 100 000 000. */
export function parseAmountRange(s: string | null): number | null {
  if (!s) return null;
  const bounds = [...s.matchAll(/(\d+(?:[.,]\d+)?)\s*([kM])?/g)].map(
    ([, n, u]) => Number(n.replace(",", ".")) * (u ? UNITS[u] : 1),
  );
  if (!bounds.length) return null;
  return bounds.length === 1 ? bounds[0] : (bounds[0] + bounds[1]) / 2;
}

function day(s: string | null, time = "00:00:00"): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T${time}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function frDate(s: string): string {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

export function normalizeApprochRecord(r: ApprochRecord, buyerName: string | null): NormalizedNotice {
  const code = String(r.code);
  const range = r.montant_estime_du_marche;
  const estimatedValue = parseAmountRange(range);
  const planned = r.date_previsionnelle_de_publication;
  // Lien « nu » vers la page d'accueil d'une plateforme : sans intérêt comme lien DCE.
  const link = r.lien_vers_la_consultation?.trim() || null;
  const documentsUrl = link && /^https?:\/\/[^/]+\/?$/.test(link) ? null : link;
  // « 01|02|…|95 » pour un marché national : pas de département unique à retenir.
  const departments = (r.departement_s_d_execution_du_marche ?? "").split("|").map((d) => d.trim()).filter(Boolean);

  return {
    source: "APPROCH",
    externalId: code,
    publicationRef: code,
    procedureId: null,
    kind: "TENDER",
    relatedExternalIds: [],
    title: (r.libelle ?? "").trim() || `Projet d'achat APProch ${code}`,
    description: [range ? `Montant estimé : ${range}.` : "", (r.description ?? "").trim()].filter(Boolean).join("\n\n"),
    buyerName: buyerName ?? (r.siren_de_l_entite_acheteuse ? `SIREN ${r.siren_de_l_entite_acheteuse}` : ""),
    buyerCountry: "FR",
    region: departments.length === 1 ? departments[0] : null,
    cpvCodes: r.code_s_cpv ? uniq(r.code_s_cpv.split(/[\s,;]+/).filter(Boolean)) : [],
    estimatedValue,
    currency: estimatedValue !== null ? "EUR" : null,
    // Projet non encore publié : la date prévisionnelle de publication figure dans le type d'avis.
    publishedAt: null,
    deadlineAt: day(r.date_cible_de_remise_des_offres, "12:00:00"),
    procedureType: r.type_de_procedure,
    noticeType: planned ? `Projet d'achat — publication prévue le ${frDate(planned)}` : "Projet d'achat",
    contractType: r.categorie_d_achat?.toUpperCase() ?? null,
    durationMonths: r.duree_previsionnelle_du_marche,
    noticeUrl: `${PROJECT_URL}/${code}`,
    documentsUrl,
    version: null,
    raw: r,
  };
}

export class ApprochConnector implements TenderConnector {
  readonly key = "APPROCH" as const;
  readonly label = "APProch";
  readonly description = "Projets d'achats publics annoncés avant la consultation — Direction des Achats de l'État";

  private readonly buyers = new Map<string, string | null>();

  constructor(
    private readonly baseUrl: string,
    private readonly http = new ThrottledHttp({ minIntervalMs: 1000 }),
    private readonly sirenHttp = new ThrottledHttp({ minIntervalMs: 200, maxRetries: 2 }),
  ) {}

  async *fetchNotices(q: ConnectorQuery): AsyncGenerator<NormalizedNotice> {
    if (q.countries.length && !q.countries.includes("FR")) return;
    const where = buildApprochWhere(q.cpvCodes, q.keywords, q.until ?? new Date());
    let emitted = 0;
    for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE_SIZE) {
      const page = await this.page(where, offset);
      for (const r of page.results) {
        yield normalizeApprochRecord(r, await this.buyerName(r.siren_de_l_entite_acheteuse));
        if (q.maxNotices && ++emitted >= q.maxNotices) return;
      }
      if (offset + PAGE_SIZE >= page.total_count || page.results.length === 0) return;
    }
  }

  private page(where: string, offset: number): Promise<ApprochPage> {
    const params = new URLSearchParams({ where, limit: String(PAGE_SIZE), offset: String(offset), order_by: "code ASC" });
    return this.http.json<ApprochPage>(`${this.baseUrl}/records?${params}`);
  }

  /** Raison sociale de l'acheteur ; `null` si l'annuaire ne répond pas (le SIREN sera affiché). */
  private async buyerName(siren: number | null): Promise<string | null> {
    if (!siren) return null;
    const key = String(siren).padStart(9, "0");
    if (this.buyers.has(key)) return this.buyers.get(key)!;
    let name: string | null = null;
    try {
      const res = await this.sirenHttp.json<{ results: Array<{ siren: string; nom_complet?: string }> }>(
        `${SIREN_LOOKUP_URL}?${new URLSearchParams({ q: key, per_page: "1" })}`,
      );
      name = res.results.find((e) => e.siren === key)?.nom_complet ?? null;
    } catch {
      name = null;
    }
    this.buyers.set(key, name);
    return name;
  }
}
