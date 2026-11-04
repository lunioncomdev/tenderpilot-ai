import { AlignmentType, BorderStyle, Document, Footer, Packer, PageNumber, Paragraph, TextRun } from "docx";

/**
 * Formulaires de candidature DC1 (lettre de candidature) et DC2 (déclaration du
 * candidat) pré-remplis d'après la trame des modèles de la Direction des affaires
 * juridiques (DAJ) du ministère de l'Économie. Remplissage déterministe, sans IA :
 * toute donnée absente du profil ou de l'analyse est signalée « [À COMPLÉTER] ».
 */

export const TODO = "[À COMPLÉTER]";
const CHECKED = "☒";
const UNCHECKED = "☐";

export type FormKind = "dc1" | "dc2";

export type FormContext = {
  buyer: string;
  consultationObject: string;
  consultationReference: string;
  /** Lots de la consultation ; « selected » : lots auxquels le candidat répond. */
  lots: Array<{ number: string; title: string; selected: boolean }>;
  company: {
    legalName: string;
    siret: string;
    legalForm: string;
    nafCode: string;
    vatNumber: string;
    address: string;
    postalCode: string;
    city: string;
    phone: string;
    email: string;
    legalRepName: string;
    legalRepTitle: string;
    headcount: number | null;
    annualRevenueEur: number | null;
    certifications: string[];
  };
  references: Array<{ title: string; client: string; year: number | null; amountEur: number | null }>;
};

export type FormLine = { text: string; bold?: boolean; indent?: boolean };
export type FormBlock = { heading: string; lines: FormLine[] };
export type FormContent = { title: string; subtitle: string; blocks: FormBlock[] };

const v = (s: string | null | undefined) => (s && s.trim() ? s.trim() : TODO);
const eur = (n: number | null) => (n === null ? TODO : `${new Intl.NumberFormat("fr-FR").format(n)} € HT`);
const line = (text: string, opts: Omit<FormLine, "text"> = {}): FormLine => ({ text, ...opts });

function siretLabel(siret: string): string {
  const d = siret.replace(/\D/g, "");
  if (d.length === 14) return d;
  if (d.length === 9) return `${d} (SIREN — compléter le NIC pour le SIRET)`;
  return TODO;
}

function fullAddress(c: FormContext["company"]): string {
  const city = [c.postalCode, c.city].filter((s) => s.trim()).join(" ");
  return c.address.trim() && city ? `${c.address.trim()}, ${city}` : TODO;
}

function buyerBlock(ctx: FormContext): FormBlock {
  return {
    heading: "A — Identification de l'acheteur",
    lines: [line(v(ctx.buyer))],
  };
}

function consultationBlock(ctx: FormContext): FormBlock {
  return {
    heading: "B — Objet de la consultation",
    lines: [line(v(ctx.consultationObject)), line(`Référence de la consultation : ${v(ctx.consultationReference)}`)],
  };
}

function identityLines(c: FormContext["company"]): FormLine[] {
  return [
    line(`Dénomination sociale : ${v(c.legalName)}`),
    line(`Forme juridique : ${v(c.legalForm)}`),
    line(`Adresse de l'établissement : ${fullAddress(c)}`),
    line(`Numéro SIRET : ${siretLabel(c.siret)}`),
    line(`Code NAF / APE : ${v(c.nafCode)}`),
    line(`N° de TVA intracommunautaire : ${v(c.vatNumber)}`),
    line(`Téléphone : ${v(c.phone)}`),
    line(`Adresse électronique : ${v(c.email)}`),
  ];
}

function signatureBlock(ctx: FormContext, letter: string): FormBlock {
  const c = ctx.company;
  return {
    heading: `${letter} — Signature du candidat`,
    lines: [
      line(`Nom, prénom et qualité du signataire : ${c.legalRepName.trim() ? `${c.legalRepName.trim()}, ${v(c.legalRepTitle)}` : TODO}`),
      line(`Fait à ${v(c.city)}, le ____ / ____ / ________`),
      line("Signature (électronique si la remise est dématérialisée) :"),
      line(" "),
    ],
  };
}

export function dc1Content(ctx: FormContext): FormContent {
  const anySelected = ctx.lots.some((l) => l.selected);
  const allSelected = ctx.lots.length > 0 && ctx.lots.every((l) => l.selected);
  const box = (b: boolean) => (b ? CHECKED : UNCHECKED);
  const lots = ctx.lots.length
    ? [
        line(`${UNCHECKED} Le marché public (pas d'allotissement)`),
        line(`${box(allSelected)} Tous les lots`),
        ...ctx.lots.map((l) => line(`${box(l.selected)} Lot n° ${l.number}${l.title ? ` — ${l.title}` : ""}`, { indent: true })),
        ...(anySelected ? [] : [line("Cocher le ou les lots pour lesquels la candidature est présentée.")]),
      ]
    : [line(`${CHECKED} Le marché public (pas d'allotissement identifié dans le DCE — à vérifier)`)];

  return {
    title: "DC1 — Lettre de candidature",
    subtitle: "Désignation du mandataire par ses co-traitants",
    blocks: [
      buyerBlock(ctx),
      consultationBlock(ctx),
      { heading: "C — Objet de la candidature", lines: [line("La candidature est présentée pour :"), ...lots] },
      {
        heading: "D — Présentation du candidat",
        lines: [line(`${CHECKED} Le candidat se présente seul`), line(`${UNCHECKED} Le candidat est un groupement d'entreprises (compléter les rubriques E et G pour chaque membre)`)],
      },
      { heading: "E — Identification du candidat", lines: identityLines(ctx.company) },
      {
        heading: "F — Engagements du candidat",
        lines: [
          line("F1 — Attestations sur l'honneur", { bold: true }),
          line("Le candidat déclare sur l'honneur :"),
          line("• n'entrer dans aucun des cas d'exclusion prévus aux articles L. 2141-1 à L. 2141-5 et L. 2141-7 à L. 2141-11 du code de la commande publique ;", { indent: true }),
          line("• être en règle au regard des articles L. 5212-1 à L. 5212-11 du code du travail concernant l'emploi des travailleurs handicapés ;", { indent: true }),
          line("• que les renseignements fournis dans la présente lettre et dans le formulaire DC2 sont exacts.", { indent: true }),
          line("F2 — Capacités", { bold: true }),
          line(`${CHECKED} Le candidat présente ses capacités dans le formulaire DC2 joint.`),
          line("F3 — Documents de preuve disponibles en ligne", { bold: true }),
          line(`${UNCHECKED} Les documents justificatifs sont accessibles gratuitement à l'adresse : ${TODO}`),
        ],
      },
      {
        heading: "G — Désignation du mandataire (en cas de groupement)",
        lines: [line("Sans objet si le candidat se présente seul.")],
      },
      signatureBlock(ctx, "H"),
    ],
  };
}

export function dc2Content(ctx: FormContext): FormContent {
  const c = ctx.company;
  const refs = ctx.references.length
    ? ctx.references.map((r) => line(`• ${r.title} — ${r.client}${r.year ? ` (${r.year})` : ""}${r.amountEur !== null ? ` — ${eur(r.amountEur)}` : ""}`, { indent: true }))
    : [line(TODO, { indent: true })];
  return {
    title: "DC2 — Déclaration du candidat individuel ou du membre du groupement",
    subtitle: "",
    blocks: [
      buyerBlock(ctx),
      consultationBlock(ctx),
      { heading: "C — Identification du candidat", lines: [...identityLines(c), line(`Représentant légal : ${c.legalRepName.trim() ? `${c.legalRepName.trim()}, ${v(c.legalRepTitle)}` : TODO}`)] },
      {
        heading: "D — Procédure collective",
        lines: [line(`${UNCHECKED} Le candidat est en redressement judiciaire (joindre la copie du ou des jugements).`), line(`${CHECKED} Le candidat n'est pas en redressement judiciaire — à vérifier.`)],
      },
      {
        heading: "E — Capacités du candidat",
        lines: [
          line("E1 — Aptitude à exercer l'activité professionnelle", { bold: true }),
          line(`Inscription au registre du commerce et des sociétés (RCS) ou au répertoire des métiers : ${c.siret.replace(/\D/g, "").length >= 9 ? `SIREN ${c.siret.replace(/\D/g, "").slice(0, 9)}` : TODO}`),
          line("E2 — Capacité économique et financière", { bold: true }),
          line("Chiffre d'affaires global hors taxes des trois derniers exercices disponibles :"),
          line(`• Dernier exercice : ${eur(c.annualRevenueEur)}`, { indent: true }),
          line(`• Exercice précédent : ${TODO}`, { indent: true }),
          line(`• Exercice antérieur : ${TODO}`, { indent: true }),
          line(`Part du chiffre d'affaires concernant le domaine du marché public : ${TODO}`),
          line("E3 — Capacités techniques et professionnelles", { bold: true }),
          line(`Effectif moyen annuel : ${c.headcount === null ? TODO : `${c.headcount} personne(s)`}`),
          line(`Certificats de qualification et certifications : ${c.certifications.length ? c.certifications.join(", ") : "Aucune déclarée"}`),
          line("Principales références des trois dernières années :"),
          ...refs,
        ],
      },
      {
        heading: "F — Capacités des opérateurs économiques sur lesquels le candidat s'appuie",
        lines: [line("Sans objet sauf recours à la sous-traitance ou aux capacités d'autres opérateurs (joindre un DC4 et leurs propres DC2).")],
      },
      {
        heading: "G — Documents de preuve disponibles en ligne",
        lines: [line(`${UNCHECKED} Adresse internet et renseignements d'accès : ${TODO}`)],
      },
      signatureBlock(ctx, "H"),
    ],
  };
}

export function formContent(kind: FormKind, ctx: FormContext): FormContent {
  return kind === "dc1" ? dc1Content(ctx) : dc2Content(ctx);
}

/** Champs encore à compléter dans le formulaire (nombre de « [À COMPLÉTER] »). */
export function countTodos(content: FormContent): number {
  return content.blocks.reduce((n, b) => n + b.lines.reduce((m, l) => m + (l.text.split(TODO).length - 1), 0), 0);
}

function runs(text: string, bold?: boolean): TextRun[] {
  // Les champs à compléter ressortent en rouge.
  return text.split(/(\[À COMPLÉTER\])/).filter(Boolean).map((part) =>
    part === TODO ? new TextRun({ text: part, bold: true, color: "C00000" }) : new TextRun({ text: part, bold }),
  );
}

export async function renderFormDocx(content: FormContent, companyName: string): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: content.title, bold: true, size: 30 })] }),
  ];
  if (content.subtitle) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: content.subtitle, size: 22 })] }));
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: "Pré-rempli d'après la trame du modèle DAJ. Vérifiez que l'acheteur n'impose pas son propre modèle ou le DUME, et complétez les champs en rouge.", italics: true, size: 18, color: "595959" })],
    }),
  );
  for (const b of content.blocks) {
    children.push(
      new Paragraph({
        spacing: { before: 240, after: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "1F3864", space: 2 } },
        children: [new TextRun({ text: b.heading, bold: true, size: 24, color: "1F3864" })],
      }),
    );
    for (const l of b.lines) {
      children.push(new Paragraph({ spacing: { after: 60 }, indent: l.indent ? { left: 360 } : undefined, children: runs(l.text, l.bold) }));
    }
  }
  const doc = new Document({
    creator: companyName,
    title: content.title,
    styles: { default: { document: { run: { font: "Calibri", size: 21 } } } },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
        footers: {
          default: new Footer({
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${companyName} — ${content.title.split(" — ")[0]} — page `, size: 16 }), new TextRun({ children: [PageNumber.CURRENT], size: 16 })] })],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
