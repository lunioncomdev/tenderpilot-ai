import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDceRequest, consultationLinks, nextDownloadStep, parseAtexoUrl, retrieveAtexo, type Identity } from "@/server/dce/atexo";
import { assertPublicHost, filenameFrom, PlatformSession } from "@/server/dce/http";
import { detectPlatform } from "@/server/dce/platforms";
import { settingsProblem } from "@/server/dce/retrieve-service";
import { decryptSecret, encryptSecret } from "@/server/dce/secrets";

const fixture = (f: string) => readFileSync(new URL(`../fixtures/atexo/${f}`, import.meta.url), "utf8");
const CONSULTATION = fixture("consultation.html"); // PLACE, consultation 3095827 (novembre 2026)
const DEMANDE = fixture("demande.html");

const WHO: Identity = {
  mode: "IDENTIFIED", firstName: "Camille", lastName: "Martin", email: "ao@example.fr", phone: "01 40 50 60 70",
  legalName: "Agence Exemple", siret: "12345678900012", address: "1 rue de la Paix", address2: "", postalCode: "75002", city: "Paris",
};

describe("plateformes Atexo", () => {
  it("reconnaît les formes d'URL de consultation", () => {
    expect(parseAtexoUrl("https://www.marches-publics.gouv.fr/entreprise/consultation/3095827?orgAcronyme=s2d")).toMatchObject({ host: "www.marches-publics.gouv.fr", id: "3095827", orgAcronyme: "s2d" });
    expect(parseAtexoUrl("https://marches.maximilien.fr/?page=Entreprise.EntrepriseAdvancedSearch&AllCons&id=946327&orgAcronyme=a8z")).toMatchObject({ id: "946327", orgAcronyme: "a8z" });
    expect(parseAtexoUrl("https://www.marches-publics.gouv.fr/entreprise")).toBeNull();
    expect(parseAtexoUrl("https://www.marches-publics.info/mpiaws/index.cfm?fuseaction=dematent.login&type=Dce&Idm=1892186")).toBeNull();
  });

  it("classe les plateformes", () => {
    expect(detectPlatform("https://webmarche.solaere.recia.fr/entreprise/consultation/4396?orgAcronyme=a1t").kind).toBe("atexo");
    expect(detectPlatform("https://www.marches-publics.info/mpiaws/index.cfm?fuseaction=dematEnt.login&amp;type=DCE&amp;IDM=1891214")).toMatchObject({ kind: "account", name: "AWS-Achat (marches-publics.info)" });
    expect(detectPlatform("http://marches2.lyon.fr").kind).toBe("generic");
    expect(detectPlatform(null).kind).toBe("none");
  });

  it("extrait les liens RC / DCE / complément de la page de consultation", () => {
    const l = consultationLinks(CONSULTATION, "https://www.marches-publics.gouv.fr/entreprise/consultation/3095827?orgAcronyme=s2d");
    expect(l.rc).toBe("https://www.marches-publics.gouv.fr/index.php?page=Entreprise.EntrepriseDownloadReglement&id=MzA5NTgyNw==&orgAcronyme=s2d");
    expect(l.dce).toBe("https://www.marches-publics.gouv.fr/index.php?page=Entreprise.EntrepriseDemandeTelechargementDce&id=3095827&orgAcronyme=s2d");
    expect(l.complement).toContain("EntrepriseDownloadComplement");
  });

  it("remplit le formulaire de retrait en mode identifié", () => {
    const f = buildDceRequest(DEMANDE, WHO);
    const P = "ctl0$CONTENU_PAGE$EntrepriseFormulaireDemande$";
    expect(f.get(`${P}RadioGroup`)).toBe(`${P}choixTelechargement`);
    expect(f.get(`${P}accepterConditions`)).toBe("on");
    expect(f.get(`${P}siren`)).toBe("123456789");
    expect(f.get(`${P}siret`)).toBe("00012");
    expect(f.get(`${P}tel`)).toBe("0140506070");
    expect(f.get(`${P}raisonSocial`)).toBe("Agence Exemple");
    expect(f.get("PRADO_POSTBACK_TARGET")).toBe("ctl0$CONTENU_PAGE$validateButton");
    expect(f.get("PRADO_PAGESTATE")?.length).toBeGreaterThan(100);
  });

  it("remplit le formulaire en mode anonyme sans coordonnées", () => {
    const f = buildDceRequest(DEMANDE, { ...WHO, mode: "ANONYMOUS" });
    const P = "ctl0$CONTENU_PAGE$EntrepriseFormulaireDemande$";
    expect(f.get(`${P}RadioGroup`)).toBe(`${P}choixAnonyme`);
    expect(f.get(`${P}email`)).toBeNull();
  });

  it("trouve l'étape de téléchargement après validation", () => {
    expect(nextDownloadStep('<a href="/index.php?page=Entreprise.EntrepriseDownloadCompleteDce&amp;id=1">Télécharger le DCE complet</a>', "https://x.fr/index.php")).toEqual({
      url: "https://x.fr/index.php?page=Entreprise.EntrepriseDownloadCompleteDce&id=1",
    });
    expect(nextDownloadStep(`new Prado.WebUI.TLinkButton({'ID':"a",'EventTarget':"ctl0$CONTENU_PAGE$telechargementComplet"});`, "https://x.fr/")).toEqual({ target: "ctl0$CONTENU_PAGE$telechargementComplet" });
    expect(nextDownloadStep("<p>rien</p>", "https://x.fr/")).toBeNull();
  });

  it("enchaîne consultation → RC → formulaire → DCE (plateforme simulée)", async () => {
    const calls: string[] = [];
    const file = (name: string, body: string) =>
      new Response(body, { headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${name}"` } });
    const fake: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url.replace("https://www.marches-publics.gouv.fr", "")}`);
      if (url.includes("/entreprise/consultation/")) return new Response(CONSULTATION, { headers: { "content-type": "text/html", "set-cookie": "PHPSESSID=abc; path=/" } });
      if (url.includes("DownloadReglement")) return file("RC.pdf", "%PDF-1.4 rc");
      if (url.includes("DownloadComplement")) return file("Complement.pdf", "%PDF-1.4 cpl");
      if (url.includes("DemandeTelechargementDce") && init?.method === "POST") {
        expect(decodeURIComponent(String(init.body))).toContain("$accepterConditions=on");
        expect((init.headers as Record<string, string>).Cookie).toBe("PHPSESSID=abc");
        return new Response('<a href="/index.php?page=Entreprise.EntrepriseDownloadCompleteDce&amp;id=1">Télécharger le dossier complet</a>', { headers: { "content-type": "text/html" } });
      }
      if (url.includes("DemandeTelechargementDce")) return new Response(DEMANDE, { headers: { "content-type": "text/html" } });
      if (url.includes("DownloadCompleteDce")) return file("DCE_3095827.zip", "PK...");
      return new Response("introuvable", { status: 404 });
    };
    const ref = parseAtexoUrl("https://www.marches-publics.gouv.fr/entreprise/consultation/3095827?orgAcronyme=s2d")!;
    const r = await retrieveAtexo(new PlatformSession(ref.host, { maxBytes: 1e6, fetchImpl: fake }), ref, WHO);
    expect(r.warnings).toEqual([]);
    expect(r.files.map((f) => [f.kind, f.filename])).toEqual([["RC", "RC.pdf"], ["COMPLEMENT", "Complement.pdf"], ["DCE", "DCE_3095827.zip"]]);
    expect(calls.filter((c) => c.startsWith("POST"))).toHaveLength(1);
  });

  it("refuse de quitter la plateforme et les hôtes internes", async () => {
    const s = new PlatformSession("www.marches-publics.gouv.fr", { maxBytes: 10, fetchImpl: fetch });
    await expect(s.request("https://evil.example/x")).rejects.toThrow(/hors de la plateforme/);
    await expect(assertPublicHost("localhost")).rejects.toThrow(/refusé/);
    await expect(assertPublicHost("127.0.0.1")).rejects.toThrow(/refusé/);
  });
});

describe("récupération des DCE : configuration", () => {
  it("décode les noms de fichiers", () => {
    expect(filenameFrom(`attachment; filename*=UTF-8''R%C3%A8glement.pdf`, "x")).toBe("Règlement.pdf");
    expect(filenameFrom(`attachment; filename="${Buffer.from("Règlement.pdf").toString("latin1")}"`, "x")).toBe("Règlement.pdf");
    expect(filenameFrom(null, "defaut.zip")).toBe("defaut.zip");
  });

  it("chiffre et déchiffre les mots de passe", () => {
    const enc = encryptSecret("m0t de passe !");
    expect(enc).not.toContain("m0t");
    expect(decryptSecret(enc)).toBe("m0t de passe !");
    expect(() => decryptSecret(enc.slice(0, -4) + "AAAA")).toThrow(/illisible/);
  });

  it("explique ce qui manque pour retirer", () => {
    const base = { ...WHO, mode: "IDENTIFIED", termsAcceptedAt: new Date() } as unknown as Parameters<typeof settingsProblem>[0];
    expect(settingsProblem(null)).toMatch(/désactivé/);
    expect(settingsProblem(base)).toBeNull();
    expect(settingsProblem({ ...base!, termsAcceptedAt: null })).toMatch(/CGU/);
    expect(settingsProblem({ ...base!, siret: "" })).toMatch(/SIRET/);
    expect(settingsProblem({ ...base!, mode: "ANONYMOUS", siret: "", email: "" })).toBeNull();
  });
});
