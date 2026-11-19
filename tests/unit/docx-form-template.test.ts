import JSZip from "jszip";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import { checkBox, fillDocxForm, scanParagraphs, textOf, type FormOp } from "@/server/applications/docx-form-template";
import { planDossier, type DossierPiece } from "@/server/applications/dossier-export";
import { officialDc1Ops, officialDc2Ops, REF_PLACEHOLDER, type FormContext } from "@/server/applications/forms-docx";

// ── Modèle de test : structure des formulaires DAJ (libellés + lignes vides, cases FORMCHECKBOX) ──

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"';
const p = (text: string, rPr = "") => `<w:p><w:pPr><w:rPr>${rPr}</w:rPr></w:pPr><w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const empty = () => "<w:p/>";
const emptyWithProps = () => '<w:p><w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:pPr></w:p>';
const ffBox = `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="c1"/><w:enabled/><w:calcOnExit w:val="0"/><w:checkBox><w:sizeAuto/><w:default w:val="0"/></w:checkBox></w:ffData></w:fldChar></w:r><w:r><w:instrText xml:space="preserve"> FORMCHECKBOX </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const boxed = (text: string) => `<w:p>${ffBox}<w:r><w:t xml:space="preserve"> ${text}</w:t></w:r></w:p>`;
const cell = (...paras: string[]) => `<w:tc><w:tcPr/>${paras.join("")}</w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
${p("A - Identification de l’acheteur", "<w:b/>")}
${p("(Reprendre le contenu de la mention figurant dans l’avis d’appel à la concurrence.)")}
${empty()}${empty()}
${p("B - Objet de la consultation", "<w:b/>")}
${p("(Reprendre le contenu de la mention figurant dans l’avis.)")}
${emptyWithProps()}
${p("C - Objet de la candidature", "<w:b/>")}
${boxed("pour le marché public (en cas de non allotissement) ;")}
${boxed("pour tous les lots de la procédure de passation du marché public ;")}
${boxed("pour le lot n°……. ou les lots n°…………… de la procédure (en cas d’allotissement ; si les lots n’ont pas été numérotés, indiquer ci-dessous l’intitulé).")}
${empty()}
${p("D - Présentation du candidat", "<w:b/>")}
${boxed("Le candidat se présente seul :")}
${p("[Indiquer le nom commercial et la dénomination sociale du candidat individuel, son adresse électronique, ses numéros de téléphone et son numéro SIRET.]")}
${p("Nom commercial et dénomination sociale de l’unité ou de l’établissement qui exécutera la prestation :")}
${empty()}
${p("Adresses postale et du siège social (si elle est différente de l’adresse postale) :")}
${empty()}
${p("Adresse électronique :")}
${empty()}
${p("Numéros de téléphone et de télécopie :")}
${empty()}
${p("Numéro SIRET, à défaut, un numéro d’identification européen ou international ou propre au pays d’origine de l’opérateur économique issu d’un répertoire figurant dans la liste des ICD :")}
${empty()}
${p("Numéro de télécopie :")}
${p("Afin d’attester que le candidat n’est pas dans un de ces cas d’exclusion, cocher la case suivante :")}
<w:p>${ffBox}</w:p>
${p("F3 - Capacités")}
${boxed("le formulaire DC2.")}
${p("G - Désignation du mandataire (en cas de groupement)")}
${p("Nom commercial et dénomination sociale de l’unité ou de l’établissement qui exécutera la prestation :")}
${empty()}
${p("Adresse électronique :")}
${empty()}
<w:tbl>
${row(cell(p(" ")), cell(p("Exercice du …… au ……")), cell(p("Exercice du …… au ……")), cell(p("Exercice du …… au ……")))}
${row(cell(p("Chiffre d’affaires global (ne remplir que pour les exercices demandés)")), cell(empty()), cell(empty()), cell(empty()))}
</w:tbl>
<w:p><w:r><w:rPr><w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings"/></w:rPr><w:sym w:font="Wingdings" w:char="F06F"/></w:r><w:r><w:t xml:space="preserve"> Case Wingdings</w:t></w:r></w:p>
<w:p><w:r><w:t>☐ Case Unicode</w:t></w:r></w:p>
<w:p><w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>☐</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t xml:space="preserve"> Case contrôle de contenu</w:t></w:r></w:p>
<w:sectPr/>
</w:body></w:document>`;

const FOOTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${W}><w:p><w:r><w:t>DC1 – Lettre de candidature </w:t></w:r><w:r><w:t>(référence de la </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>consultation)</w:t></w:r><w:r><w:t> Page 1</w:t></w:r></w:p></w:ftr>`;

async function template(document = DOCUMENT): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`);
  zip.file("word/document.xml", document);
  zip.file("word/footer1.xml", FOOTER);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function parts(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const doc = await zip.file("word/document.xml")!.async("string");
  const footer = await zip.file("word/footer1.xml")!.async("string");
  return { doc, footer, paras: scanParagraphs(doc).map((p) => p.text) };
}

const after = (paras: string[], label: string) => paras[paras.findIndex((t) => t.startsWith(label)) + 1];

const company: FormContext["company"] = {
  legalName: "Agence Exemple", siret: "12345678900012", legalForm: "SAS", nafCode: "62.01Z", vatNumber: "FR12123456789",
  address: "1 rue de la Paix", postalCode: "75002", city: "Paris", phone: "01 40 50 60 70", email: "ao@example.fr",
  legalRepName: "Camille Martin", legalRepTitle: "Présidente", headcount: 12, annualRevenueEur: 1_200_000, certifications: ["ISO 27001"],
};
const ctx: FormContext = {
  buyer: "Ville de Lyon", consultationObject: "Refonte du portail", consultationReference: "2026-042",
  lots: [{ number: "1", title: "Développement", selected: true }, { number: "2", title: "TMA", selected: false }],
  company, references: [{ title: "Portail usagers", client: "Métropole X", year: 2025, amountEur: 180_000 }],
};

describe("analyse du XML WordprocessingML", () => {
  it("découpe les paragraphes de premier niveau, auto-fermés compris, et en extrait le texte", () => {
    const paras = scanParagraphs(`<w:p><w:pPr/><w:r><w:t>a</w:t></w:r><w:r><w:tab/><w:t>b &amp; c</w:t></w:r></w:p><w:p/><w:p w:rsidR="1"><w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p>`);
    expect(paras.map((p) => p.text)).toEqual(["a b & c", "", ""]);
    expect(paras.map((p) => p.empty)).toEqual([false, true, false]);
    expect(textOf("<w:t xml:space=\"preserve\">x </w:t><w:br/><w:t>y</w:t>")).toBe("x  y");
  });

  it("coche les quatre sortes de cases", () => {
    expect(checkBox('<w:checkBox><w:sizeAuto/><w:default w:val="0"/></w:checkBox>')).toContain('<w:default w:val="1"/>');
    expect(checkBox("<w:checkBox><w:sizeAuto/></w:checkBox>")).toContain('<w:default w:val="1"/></w:checkBox>');
    expect(checkBox('<w:checkBox><w:sizeAuto/><w:default w:val="0"/><w:checked w:val="0"/></w:checkBox>')).toContain('<w:checked w:val="1"/>');
    expect(checkBox('<w:sym w:font="Wingdings" w:char="F06F"/>')).toBe('<w:sym w:font="Wingdings" w:char="F0FE"/>');
    expect(checkBox("<w:t>☐ oui</w:t>")).toBe("<w:t>☒ oui</w:t>");
    const sdt = checkBox('<w:sdt><w:sdtPr><w14:checkbox><w14:checked w14:val="0"/><w14:checkedState w14:val="2612"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>☐</w:t></w:r></w:sdtContent></w:sdt>');
    expect(sdt).toContain('<w14:checked w14:val="1"/>');
    expect(sdt).toContain("<w:t>☒</w:t>");
    expect(checkBox("<w:t>rien</w:t>")).toBeNull();
  });
});

describe("remplissage d'un modèle de formulaire", () => {
  it("écrit sous le libellé en sautant la consigne entre parenthèses, et conserve la mise en forme de la ligne", async () => {
    const ops: FormOp[] = [
      { op: "fillBelow", field: "A", label: "Identification de l’acheteur", value: "Ville de Lyon" },
      { op: "fillBelow", field: "B", label: "Objet de la consultation", value: "Refonte\nRéférence : 2026-042" },
    ];
    const { buf, report } = await fillDocxForm(await template(), ops);
    const { doc, paras } = await parts(buf);
    expect(report).toEqual({ placed: ["A", "B"], kept: [], unplaced: [] });
    expect(paras[2]).toBe("Ville de Lyon");
    expect(paras[3]).toBe("");
    expect(doc).toContain('<w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">Refonte</w:t>');
    expect(doc).toContain("<w:br/>");
    expect(doc).toContain('<w:t xml:space="preserve">Référence : 2026-042</w:t>');
  });

  it("préfère le libellé seul à la consigne qui le cite, et ne touche que la première occurrence", async () => {
    const ops: FormOp[] = [
      { op: "fillBelow", field: "mail", label: "Adresse électronique", value: "ao@example.fr" },
      { op: "fillBelow", field: "nom", label: "Nom commercial et dénomination sociale de l’unité", value: "Agence Exemple" },
    ];
    const { buf } = await fillDocxForm(await template(), ops);
    const { paras } = await parts(buf);
    expect(after(paras, "Adresse électronique")).toBe("ao@example.fr");
    expect(after(paras, "Nom commercial")).toBe("Agence Exemple");
    // La consigne « [Indiquer … son adresse électronique …] » n'est pas modifiée.
    expect(paras.find((t) => t.startsWith("[Indiquer"))).not.toContain("ao@example.fr");
    // Libellé long cité dans la consigne qui le précède : la valeur va bien sous le libellé.
    const { buf: buf2 } = await fillDocxForm(await template(), [{ op: "fillBelow", field: "siret", label: "Numéro SIRET", value: "12345678900012" }]);
    const { paras: paras2 } = await parts(buf2);
    expect(after(paras2, "Numéro SIRET")).toBe("12345678900012");
    expect(paras2.find((t) => t.startsWith("[Indiquer"))).not.toContain("12345678900012");
    // Rubrique G (mandataire) : lignes toujours vides.
    const g = paras.indexOf("G - Désignation du mandataire (en cas de groupement)");
    expect(paras.slice(g + 1)).toContain("");
    expect(paras.slice(g + 1).filter((t) => t === "ao@example.fr" || t === "Agence Exemple")).toEqual([]);
  });

  it("ajoute la valeur à la suite d'un libellé « : » qu'aucune ligne vide ne suit", async () => {
    const { buf, report } = await fillDocxForm(await template(), [{ op: "fillBelow", field: "fax", label: "Numéro de télécopie", value: "01 02\n03 04" }]);
    const { paras } = await parts(buf);
    expect(report.placed).toEqual(["fax"]);
    expect(paras).toContain("Numéro de télécopie : 01 02 ; 03 04");
  });

  it("laisse intacte une rubrique déjà renseignée par l'acheteur dans son modèle", async () => {
    const prefilled = DOCUMENT.replace(`${empty()}${empty()}`, p("Ministère des armées — DGA"));
    const { buf, report } = await fillDocxForm(await template(prefilled), [{ op: "fillBelow", field: "A", label: "Identification de l’acheteur", value: "Ville de Lyon" }]);
    const { paras } = await parts(buf);
    expect(report).toEqual({ placed: [], kept: ["A"], unplaced: [] });
    expect(paras[2]).toBe("Ministère des armées — DGA");
    expect(paras.join("\n")).not.toContain("Ville de Lyon");
  });

  it("coche la case du paragraphe visé, ou celle du paragraphe vide voisin", async () => {
    const ops: FormOp[] = [
      { op: "check", field: "tous", label: "pour tous les lots" },
      { op: "check", field: "honneur", label: "cocher la case suivante" },
      { op: "check", field: "wingdings", label: "Case Wingdings" },
      { op: "check", field: "unicode", label: "Case Unicode" },
      { op: "check", field: "sdt", label: "Case contrôle de contenu" },
      { op: "check", field: "absent", label: "Case inexistante" },
    ];
    const { buf, report } = await fillDocxForm(await template(), ops);
    const { doc } = await parts(buf);
    expect(report.unplaced).toEqual(["absent"]);
    expect((doc.match(/<w:default w:val="1"\/>/g) ?? []).length).toBe(2);
    expect(doc).toContain('w:char="F0FE"');
    expect(doc).toContain("☒ Case Unicode");
    expect(doc).toContain('<w14:checked w14:val="1"/>');
    // Les autres cases restent décochées.
    expect(doc).toContain('<w:default w:val="0"/>');
  });

  it("ne coche « Oui » qu'après l'ancre et en mot entier", async () => {
    const xml = `<w:document ${W}><w:body>${boxed("Oui, autre question")}${p("Le candidat est-il une moyenne entreprise ?")}${boxed("Oui")}${boxed("Non.")}</w:body></w:document>`;
    const zip = new JSZip();
    zip.file("word/document.xml", xml);
    const { buf, report } = await fillDocxForm(await zip.generateAsync({ type: "nodebuffer" }), [{ op: "check", field: "pme", label: "Oui", after: "moyenne entreprise" }]);
    const doc = await (await JSZip.loadAsync(buf)).file("word/document.xml")!.async("string");
    expect(report.placed).toEqual(["pme"]);
    const boxes = [...doc.matchAll(/<w:default w:val="(\d)"\/>/g)].map((m) => m[1]);
    expect(boxes).toEqual(["0", "1", "0"]);
  });

  it("remplit les cellules d'une ligne de tableau après celle du libellé", async () => {
    const { buf, report } = await fillDocxForm(await template(), [{ op: "fillRow", field: "CA", label: "Chiffre d’affaires global", values: ["1 200 000 € HT", "", "900 000 € HT"] }]);
    const { doc } = await parts(buf);
    expect(report.placed).toEqual(["CA"]);
    const rowXml = /<w:tr>(?:(?!<w:tr>)[\s\S])*Chiffre[\s\S]*?<\/w:tr>/.exec(doc)![0];
    const cells = [...rowXml.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((m) => textOf(m[0]));
    expect(cells).toEqual(["Chiffre d’affaires global (ne remplir que pour les exercices demandés)", "1 200 000 € HT", "", "900 000 € HT"]);
  });

  it("remplace un texte réparti sur plusieurs runs, dans le pied de page", async () => {
    const { buf, report } = await fillDocxForm(await template(), [{ op: "replace", field: "ref", from: REF_PLACEHOLDER, to: "2026-042" }]);
    const { footer } = await parts(buf);
    expect(report.placed).toEqual(["ref"]);
    expect(textOf(footer)).toBe("DC1 – Lettre de candidature 2026-042 Page 1");
    expect(footer).toContain("<w:i/>");
  });

  it("échappe les caractères XML des valeurs et signale les rubriques introuvables", async () => {
    const { buf, report } = await fillDocxForm(await template(), [
      { op: "fillBelow", field: "A", label: "Identification de l’acheteur", value: "SIVOM <Nord & Est>" },
      { op: "fillBelow", field: "X", label: "Rubrique qui n'existe pas", value: "x" },
    ]);
    const { doc, paras } = await parts(buf);
    expect(report).toEqual({ placed: ["A"], kept: [], unplaced: ["X"] });
    expect(doc).toContain("SIVOM &lt;Nord &amp; Est&gt;");
    expect(paras[2]).toBe("SIVOM <Nord & Est>");
    expect(doc).not.toContain("<Nord");
  });
});

describe("DC1 / DC2 sur le modèle officiel", () => {
  it("remplit le DC1 : rubriques A à F, lots retenus, identité, cases cochées", async () => {
    const { ops, missing } = officialDc1Ops(ctx);
    const { buf, report } = await fillDocxForm(await template(), ops);
    const { doc, paras } = await parts(buf);
    expect(missing).toEqual([]);
    expect(report.unplaced).toEqual([]);
    expect(after(paras, "(Reprendre le contenu de la mention figurant dans l’avis d’appel")).toBe("Ville de Lyon");
    expect(paras).toContain("Refonte du portailRéférence de la consultation : 2026-042".replace("portailRéf", "portail Réf"));
    expect(after(paras, "Nom commercial")).toBe("Agence Exemple");
    expect(after(paras, "Adresses postale")).toBe("1 rue de la Paix, 75002 Paris");
    expect(after(paras, "Numéro SIRET")).toBe("12345678900012");
    expect(after(paras, " pour le lot n°")).toBe("Lot n° 1 — Développement");
    // Cases : lot(s), candidat seul, attestation sur l'honneur, formulaire DC2 → 4 cochées ; « marché public », « tous les lots » décochées.
    expect((doc.match(/<w:default w:val="1"\/>/g) ?? []).length).toBe(4);
    expect((doc.match(/<w:default w:val="0"\/>/g) ?? []).length).toBe(2);
    const text = (await mammoth.extractRawText({ buffer: buf })).value;
    expect(text).toContain("ao@example.fr");
    expect(text).toContain("01 40 50 60 70");
  });

  it("DC1 : coche « tous les lots » ou « marché public » selon la sélection, et signale l'absence de lot retenu", () => {
    const labels = (c: FormContext) => officialDc1Ops(c).ops.filter((o) => o.op === "check").map((o) => o.field);
    expect(labels({ ...ctx, lots: [] })).toContain("C — Marché non alloti");
    expect(labels({ ...ctx, lots: ctx.lots.map((l) => ({ ...l, selected: true })) })).toContain("C — Tous les lots");
    const none = officialDc1Ops({ ...ctx, lots: ctx.lots.map((l) => ({ ...l, selected: false })) });
    expect(none.ops.filter((o) => o.field.startsWith("C — "))).toEqual([]);
    expect(none.missing).toContain("C — Lots retenus (aucun lot sélectionné)");
  });

  it("DC2 : forme juridique, PME, registre, chiffre d'affaires et capacités ; données manquantes listées", async () => {
    const { ops, missing } = officialDc2Ops(ctx);
    expect(missing).toEqual([]);
    expect(ops.find((o) => o.field === "PME : oui")).toMatchObject({ op: "check", label: "Oui", after: "moyenne entreprise" });
    expect(ops.find((o) => o.op === "fillRow")).toMatchObject({ label: "Chiffre d’affaires global", values: [`${new Intl.NumberFormat("fr-FR").format(1_200_000)} € HT`] });
    const g1 = ops.find((o) => o.field.startsWith("G1")) as Extract<FormOp, { op: "fillBelow" }>;
    expect(g1.value).toContain("Effectif moyen annuel : 12 personne(s)");
    expect(g1.value).toContain("ISO 27001");
    expect(g1.value).toContain(`• Portail usagers — Métropole X (2025) — ${new Intl.NumberFormat("fr-FR").format(180_000)} € HT`);
    const e1 = ops.find((o) => o.field.startsWith("E1")) as Extract<FormOp, { op: "fillBelow" }>;
    expect(e1.value).toContain("SIREN 123456789");
    expect(e1.value).toContain("62.01Z");

    const big = officialDc2Ops({ ...ctx, company: { ...company, headcount: 300 } });
    expect(big.ops.find((o) => o.field === "PME : non")).toBeDefined();

    const sparse = officialDc2Ops({ ...ctx, company: { ...company, legalForm: "", headcount: null, annualRevenueEur: null, certifications: [] }, references: [] });
    expect(sparse.missing).toEqual(expect.arrayContaining(["Forme juridique", "PME (oui / non) — effectif inconnu", "F1 — Chiffre d’affaires du dernier exercice", "G1 — Effectif moyen annuel", "G1 — Références"]));
    expect(sparse.ops.find((o) => o.field === "Forme juridique")).toBeUndefined();

    // Sur le modèle de test (structure DC1), le tableau de CA est rempli, les rubriques propres au DC2 sont signalées.
    const { report } = await fillDocxForm(await template(), ops);
    expect(report.placed).toContain("F1 — Chiffre d’affaires du dernier exercice");
    expect(report.unplaced).toEqual(expect.arrayContaining(["Forme juridique", "E1 — Inscription au registre professionnel", "G1 — Capacités techniques et professionnelles"]));
  });

  it("le sommaire du dossier indique le modèle utilisé", () => {
    const piece = (key: string, label: string): DossierPiece => ({ key, group: "CANDIDATURE", label, detail: "", status: "DONE", lotId: null, files: [] });
    const plan = planDossier({ pieces: [piece("dc1", "DC1"), piece("dc2", "DC2")], companyDocs: [], deadline: null, proposals: [], formTemplates: { dc1: "dce" } });
    expect(plan.summary[0].issues).toEqual(["modèle officiel du DCE rempli : vérifier, compléter et signer"]);
    expect(plan.summary[1].issues).toEqual(["généré pré-rempli : compléter, vérifier et signer"]);
  });
});
