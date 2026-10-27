import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BoampConnector, boampNoticePdfUrl, buildBoampWhere, normalizeBoampRecord, type BoampRecord } from "@/server/connectors/boamp";
import { computeDedupKey } from "@/server/connectors/dedup";
import { ThrottledHttp } from "@/server/connectors/http";
import { parseEformsDateTime } from "@/server/connectors/parse";
import { buildTedQuery, cpvToPattern, normalizeTedNotice, TedConnector } from "@/server/connectors/ted";

const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", name), "utf-8"));

const boamp = fixture("boamp-records.json") as { results: BoampRecord[] };
const ted = fixture("ted-search.json") as { notices: Record<string, unknown>[] };

describe("BOAMP", () => {
  it("normalise un avis eForms avec date limite et montant", () => {
    const rec = boamp.results.find((r) => r.idweb === "26-101861")!;
    const n = normalizeBoampRecord(rec);
    expect(n.source).toBe("BOAMP");
    expect(n.externalId).toBe("26-101861");
    expect(n.kind).toBe("TENDER");
    expect(n.estimatedValue).toBe(531000);
    expect(n.currency).toBe("EUR");
    expect(n.cpvCodes).toContain("72212218");
    expect(n.deadlineAt?.toISOString()).toBe("2026-11-23T15:00:00.000Z");
    expect(n.buyerCountry).toBe("FR");
    expect(n.noticeUrl).toContain("26-101861");
  });

  it("retrouve la date limite dans les données eForms quand le champ plat est vide", () => {
    const rec = boamp.results.find((r) => r.idweb === "26-103042")!;
    expect(rec.datelimitereponse).toBeNull();
    const n = normalizeBoampRecord(rec);
    expect(n.deadlineAt).not.toBeNull();
    expect(n.deadlineAt!.toISOString().slice(0, 10)).toBe("2026-11-23");
    expect(n.durationMonths).toBe(48);
    expect(n.estimatedValue).toBe(316000);
  });

  it("classe annulations et rectificatifs et conserve les liens", () => {
    const base = boamp.results[0];
    expect(normalizeBoampRecord({ ...base, nature: "ANNULATION", annonce_lie: ["26-1"] }).kind).toBe("CANCELLATION");
    const corr = normalizeBoampRecord({ ...base, nature: "RECTIFICATIF", annonce_lie: ["26-2"] });
    expect(corr.kind).toBe("CORRECTION");
    expect(corr.relatedExternalIds).toEqual(["26-2"]);
  });

  it("retrouve le lien du dossier de consultation dans les trois formats BOAMP", () => {
    const base = boamp.results[0];
    const eforms = normalizeBoampRecord(boamp.results.find((r) => r.idweb === "26-103266")!);
    expect(eforms.documentsUrl).toBe("https://marches.maximilien.fr/entreprise/consultation/949384?orgAcronyme=p2q");
    const fn = normalizeBoampRecord({ ...base, donnees: JSON.stringify({ FNSimple: { initial: { communication: { urlDocConsul: "https://www.marches-publics.info/dce?Idm=1" } } } }) });
    expect(fn.documentsUrl).toBe("https://www.marches-publics.info/dce?Idm=1");
    const mapa = normalizeBoampRecord({ ...base, donnees: JSON.stringify({ MAPA: { organisme: { urlProfilAcheteur: "https://webmarche.solaere.recia.fr/x" } } }) });
    expect(mapa.documentsUrl).toBe("https://webmarche.solaere.recia.fr/x");
  });

  it("construit l'URL de l'extrait PDF de l'avis à partir du mois de parution", () => {
    expect(boampNoticePdfUrl("26-103266", new Date("2026-10-25T00:00:00Z"))).toBe("https://www.boamp.fr/telechargements/FILES/PDF/2026/10/26-103266.pdf");
    expect(boampNoticePdfUrl("26-67989", new Date("2026-07-09T00:00:00Z"))).toBe("https://www.boamp.fr/telechargements/FILES/PDF/2026/07/26-67989.pdf");
    expect(() => boampNoticePdfUrl("../x", new Date())).toThrow();
  });

  it("échappe les mots-clés dans la requête ODSQL", () => {
    const w = buildBoampWhere(new Date("2026-10-01"), new Date("2026-10-07"), ['api "x") OR (1=1']);
    expect(w).toContain(`search(objet, "api \\"x\\") OR (1=1")`);
    expect(w).toContain("dateparution >= date'2026-10-01'");
  });

  it("pagine via le client HTTP et respecte maxNotices", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ total_count: 3, results: boamp.results }), { status: 200 });
    }) as unknown as typeof fetch;
    const c = new BoampConnector("https://example.test/boamp", new ThrottledHttp({ minIntervalMs: 0, fetchImpl }));
    const out = [];
    for await (const n of c.fetchNotices({ since: new Date("2026-10-20"), until: new Date("2026-10-22"), cpvCodes: [], keywords: ["chatbot"], countries: ["FR"], maxNotices: 2 })) out.push(n);
    expect(out).toHaveLength(2);
    expect(calls[0]).toContain("/records?");
  });

  it("n'interroge pas le BOAMP si la France n'est pas dans les zones", async () => {
    const c = new BoampConnector("https://example.test", new ThrottledHttp({ minIntervalMs: 0, fetchImpl: (() => { throw new Error("ne doit pas être appelé"); }) as unknown as typeof fetch }));
    const out = [];
    for await (const n of c.fetchNotices({ since: new Date(), cpvCodes: [], keywords: [], countries: ["BE"] })) out.push(n);
    expect(out).toHaveLength(0);
  });
});

describe("TED", () => {
  it("normalise un avis de marché", () => {
    const raw = ted.notices.find((n) => n["publication-number"] === "742320-2026")!;
    const n = normalizeTedNotice(raw);
    expect(n.externalId).toBe("2e599dd1-f706-4dc6-9653-44d8ba44f31c");
    expect(n.publicationRef).toBe("742320-2026");
    expect(n.procedureId).toBe("5cc7cf49-25e1-46a2-9057-88271be4fd22");
    expect(n.kind).toBe("TENDER");
    expect(n.buyerCountry).toBe("FR");
    expect(n.estimatedValue).toBe(250000);
    expect(n.title).toContain("ExaGrid");
    expect(n.deadlineAt?.toISOString().slice(0, 10)).toBe("2026-11-23");
    expect(n.version).toBe(2);
  });

  it("classe les avis d'attribution", () => {
    const raw = ted.notices.find((n) => String(n["notice-type"]).startsWith("can"))!;
    expect(normalizeTedNotice(raw).kind).toBe("AWARD");
  });

  it("construit une requête experte avec préfixes CPV et pays", () => {
    expect(cpvToPattern("72000000")).toBe("72*");
    expect(cpvToPattern("72212000")).toBe("72212*");
    const q = buildTedQuery({ since: new Date("2026-10-01"), until: new Date("2026-10-27"), cpvCodes: ["72000000", "72200000"], keywords: [], countries: ["FR", "BE"] });
    expect(q).toBe("classification-cpv IN (72* 722*) AND buyer-country IN (FRA BEL) AND publication-date>=20261001 AND publication-date<=20261027 SORT BY publication-date");
  });

  it("suit le jeton d'itération", async () => {
    let call = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      call++;
      if (call === 1) {
        expect(body.iterationNextToken).toBeUndefined();
        return new Response(JSON.stringify({ notices: ted.notices.slice(0, 2), totalNoticeCount: 3, iterationNextToken: "tok" }));
      }
      expect(body.iterationNextToken).toBe("tok");
      return new Response(JSON.stringify({ notices: ted.notices.slice(2), totalNoticeCount: 3, iterationNextToken: null }));
    }) as unknown as typeof fetch;
    const c = new TedConnector("https://example.test", new ThrottledHttp({ minIntervalMs: 0, fetchImpl }));
    const out = [];
    for await (const n of c.fetchNotices({ since: new Date("2026-10-20"), cpvCodes: ["72000000"], keywords: [], countries: ["FR"] })) out.push(n);
    expect(out).toHaveLength(3);
    expect(call).toBe(2);
  });
});

describe("HTTP", () => {
  it("réessaie sur 429 puis réussit", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return n === 1 ? new Response("slow down", { status: 429, headers: { "retry-after": "1" } }) : new Response('{"ok":true}');
    }) as unknown as typeof fetch;
    const sleeps: number[] = [];
    const http = new ThrottledHttp({ minIntervalMs: 0, fetchImpl, sleep: async (ms) => void sleeps.push(ms) });
    await expect(http.json("https://x.test")).resolves.toEqual({ ok: true });
    expect(sleeps).toContain(1000);
  });

  it("ne réessaie pas une erreur 400", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return new Response("bad", { status: 400 });
    }) as unknown as typeof fetch;
    const http = new ThrottledHttp({ minIntervalMs: 0, fetchImpl, sleep: async () => {} });
    await expect(http.json("https://x.test")).rejects.toThrow("HTTP 400");
    expect(n).toBe(1);
  });
});

describe("Utilitaires", () => {
  it("combine date et heure eForms", () => {
    expect(parseEformsDateTime("2026-11-26+01:00", "12:00:00+02:00")?.toISOString()).toBe("2026-11-26T10:00:00.000Z");
    expect(parseEformsDateTime("2026-11-23+01:00")?.toISOString()).toBe("2026-11-23T11:00:00.000Z");
  });

  it("produit la même empreinte pour un même marché publié sur deux sources", () => {
    const d = new Date("2026-11-23T11:00:00Z");
    const a = computeDedupKey({ buyerName: "Association Française de Normalisation (AFNOR)", title: "Maintenance des équipements d'infrastructure des baies ExaGrid", deadlineAt: d });
    const b = computeDedupKey({ buyerName: "ASSOCIATION FRANCAISE DE NORMALISATION (AFNOR)", title: "Maintenance des equipements d infrastructure des baies EXAGRID", deadlineAt: new Date("2026-11-23T15:00:00Z") });
    expect(a).toBe(b);
  });
});
