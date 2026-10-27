import { describe, expect, it } from "vitest";
import { BoampConnector } from "@/server/connectors/boamp";
import { DEFAULT_CPV_CODES, DEFAULT_KEYWORDS } from "@/server/connectors/defaults";
import { TedConnector } from "@/server/connectors/ted";

/**
 * Tests contre les API publiques RÉELLES (réseau requis). Désactivés par défaut :
 * `pnpm test:live`.
 */
const live = process.env.LIVE === "1" ? describe : describe.skip;
const since = new Date(Date.now() - 7 * 86_400_000);

live("API publiques", () => {
  it("BOAMP renvoie des avis normalisés", async () => {
    const out = [];
    for await (const n of new BoampConnector("https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp").fetchNotices({ since, cpvCodes: [], keywords: DEFAULT_KEYWORDS, countries: ["FR"], maxNotices: 20 })) out.push(n);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].externalId).toMatch(/^\d{2}-\d+$/);
  });

  it("TED renvoie des avis normalisés", async () => {
    const out = [];
    for await (const n of new TedConnector("https://api.ted.europa.eu/v3").fetchNotices({ since, cpvCodes: DEFAULT_CPV_CODES, keywords: [], countries: ["FR"], maxNotices: 20 })) out.push(n);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].publicationRef).toMatch(/^\d+-\d{4}$/);
    expect(out.every((n) => n.buyerCountry === "FR")).toBe(true);
  });
});
