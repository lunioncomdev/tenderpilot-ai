import { z } from "zod/v4";
import { SourceRef } from "../../analysis/schema";
import { SAFETY_RULES } from "./common";

export const GENERATE_SECTION_PROMPT_VERSION = "generate-section@2026-11-07.2";

export const SectionOutputSchema = z.object({
  content: z.string().describe("Contenu de la section en Markdown (titres ###, listes, tableaux simples). Sans le titre principal."),
  claimsToValidate: z
    .array(z.string())
    .describe("Affirmations ou engagements proposés qui ne proviennent PAS des données entreprise et doivent être validés"),
  dceSources: z.array(SourceRef).describe("Passages du DCE auxquels la section répond"),
  companyFactsUsed: z.array(z.string()).describe("Identifiants des données entreprise utilisées (ex. REF-3, PROFIL.methodology)"),
});
export type SectionOutput = z.infer<typeof SectionOutputSchema>;

export const GENERATE_SECTION_SYSTEM = `
Tu es rédacteur senior de mémoires techniques pour une agence digitale qui répond à des marchés publics informatiques.
Tu rédiges une section du mémoire technique, de façon précise, concrète et adaptée au DCE fourni, en répondant explicitement aux exigences et aux critères de notation.

${SAFETY_RULES}

RÈGLES SPÉCIFIQUES AU MÉMOIRE (impératives) :
- Les seules informations vraies sur l'entreprise sont celles du bloc <entreprise>. N'invente JAMAIS : référence client, diplôme, certification, effectif, chiffre d'affaires, expérience, engagement contractuel, nom de collaborateur.
- Si une information utile manque, écris le texte avec un emplacement explicite « [À COMPLÉTER : …] ».
- Toute proposition d'engagement ou de moyen qui ne figure pas dans les données entreprise (ex. délai d'intervention, outil, mesure) doit être suivie de « [À VALIDER] » et listée dans "claimsToValidate".
- Ne mentionne aucun prix (l'offre financière est traitée à part).
- Reprends le vocabulaire de l'acheteur ; reste factuel, sans superlatifs creux.
- Le champ "content" est le texte remis à l'acheteur : il ne doit contenir AUCUN identifiant de source (REF-n, PROFIL.xxx, D2-C14…), ni entre crochets ni ailleurs. Les sources vont uniquement dans "companyFactsUsed" et "dceSources". Une référence client se cite par son titre et son client, jamais par « REF-n ». Seuls les marqueurs « [À COMPLÉTER : …] » et « [À VALIDER] » sont autorisés dans le texte.
`.trim();

const SOURCE_ID = String.raw`(?:REF-\d+|PROFIL\.\w+|D\d+-C\d+)`;
/** Marqueur ne contenant que des identifiants de source : [REF-1], [PROFIL.description ; REF-2], (D2-C14)… */
const SOURCE_MARKER = new RegExp(String.raw`[ \t]*[\[(]\s*${SOURCE_ID}(?:\s*[,;/]?\s*${SOURCE_ID})*\s*[\])]`, "g");

/** Retire du texte rédigé les identifiants de source internes que l'IA aurait recopiés malgré la consigne. */
export function stripSourceMarkers(content: string): string {
  return content.replace(SOURCE_MARKER, "");
}

export function generateSectionPrompt(p: {
  sectionTitle: string;
  guidance: string;
  analysisSummary: string;
  awardCriteria: string;
  requirements: string;
  company: string;
  references: string;
  previousContent?: string;
  instruction?: string;
  /** Lot auquel répond le mémoire (consultation allotie). */
  lot?: string;
}): string {
  return `
<analyse>
${p.analysisSummary}

Critères de notation :
${p.awardCriteria || "Non précisés"}

Exigences principales :
${p.requirements || "Non précisées"}
</analyse>

<entreprise>
${p.company}

Références (identifiants REF-n) :
${p.references || "Aucune référence enregistrée."}
</entreprise>

Rédige la section « ${p.sectionTitle} » du mémoire technique.${p.lot ? `
Ce mémoire répond uniquement au ${p.lot} : ne traite que les besoins, exigences et livrables de ce lot, sans aborder les autres lots.` : ""}
Consignes pour cette section : ${p.guidance}
${p.previousContent ? `\nVersion actuelle (à améliorer) :\n<version_actuelle>\n${p.previousContent}\n</version_actuelle>\n` : ""}${p.instruction ? `\nDemande de l'utilisateur : ${p.instruction}\n` : ""}
Longueur visée : 250 à 700 mots selon l'importance de la section au regard des critères.`.trim();
}
