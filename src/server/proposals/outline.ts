import { normalizeText } from "@/lib/utils";
import type { TenderAnalysisResult } from "../analysis/schema";

export type OutlineSection = { key: string; title: string; guidance: string };

export const DEFAULT_OUTLINE: OutlineSection[] = [
  { key: "company", title: "Présentation de l'entreprise", guidance: "Identité, activités, chiffres clés issus du profil." },
  { key: "understanding", title: "Compréhension du besoin", guidance: "Reformulation précise du besoin exprimé dans le CCTP." },
  { key: "context", title: "Analyse du contexte", guidance: "Contexte de l'acheteur, existant, contraintes." },
  { key: "objectives", title: "Objectifs du projet", guidance: "Objectifs mesurables déduits du DCE." },
  { key: "solution", title: "Solution proposée", guidance: "Réponse fonctionnelle point par point aux exigences." },
  { key: "architecture", title: "Architecture technique", guidance: "Architecture cible, composants, flux, intégrations." },
  { key: "technologies", title: "Technologies retenues", guidance: "Choix technologiques justifiés au regard des exigences." },
  { key: "methodology", title: "Méthodologie de réalisation", guidance: "Démarche projet, cycles, recette, livraisons." },
  { key: "organization", title: "Organisation projet", guidance: "Gouvernance, comitologie, rôles, outils de pilotage." },
  { key: "team", title: "Composition de l'équipe", guidance: "Profils mobilisés (uniquement à partir des données entreprise)." },
  { key: "planning", title: "Planning", guidance: "Phasage et jalons compatibles avec les délais du DCE." },
  { key: "security", title: "Sécurité et conformité", guidance: "Mesures de sécurité, conformité aux exigences du CCTP." },
  { key: "gdpr", title: "RGPD", guidance: "Traitements de données, sous-traitance au sens RGPD, mesures." },
  { key: "accessibility", title: "Accessibilité", guidance: "Conformité RGAA, démarche et contrôles." },
  { key: "ecodesign", title: "Éco-conception", guidance: "Démarche RGESN / sobriété numérique." },
  { key: "hosting", title: "Hébergement", guidance: "Hébergement, localisation des données, réversibilité." },
  { key: "maintenance", title: "Maintenance et support", guidance: "TMA, niveaux de service, support." },
  { key: "risks", title: "Gestion des risques", guidance: "Risques projet identifiés et mesures de maîtrise." },
  { key: "quality", title: "Assurance qualité", guidance: "Processus qualité, tests, revues." },
  { key: "references", title: "Références similaires", guidance: "Uniquement les références réelles de l'entreprise." },
  { key: "commitments", title: "Engagements et livrables", guidance: "Livrables attendus par le DCE et engagements." },
  { key: "conclusion", title: "Conclusion", guidance: "Synthèse de la valeur apportée." },
];

/** Rattachement des critères de notation aux sections du plan. */
const CRITERION_MAP: Array<[RegExp, string]> = [
  [/methodolog|demarche (de )?projet|organisation du projet|conduite (du |de )?projet/, "methodology"],
  [/moyens humains|equipe|competence|profil|cv/, "team"],
  [/delai|planning|calendrier/, "planning"],
  [/securit/, "security"],
  [/rgpd|donnees personnelles/, "gdpr"],
  [/accessib|rgaa/, "accessibility"],
  [/environn|eco ?concep|developpement durable|sobriet/, "ecodesign"],
  [/heberg/, "hosting"],
  [/maintenance|support|assistance|sla|niveau de service/, "maintenance"],
  [/qualit/, "quality"],
  [/reference/, "references"],
  [/architecture/, "architecture"],
  [/fonctionnel|solution|technique|valeur technique/, "solution"],
];

/**
 * Adapte le plan aux critères de notation du RC : chaque critère (hors prix) est
 * rattaché à une section existante ou ajouté comme section dédiée.
 */
export function adaptOutline(analysis: TenderAnalysisResult | null): OutlineSection[] {
  const outline = DEFAULT_OUTLINE.map((s) => ({ ...s }));
  if (!analysis) return outline;
  const extra: OutlineSection[] = [];
  analysis.awardCriteria.forEach((c, i) => {
    const n = normalizeText(`${c.criterion} ${c.subCriteria.join(" ")}`);
    if (/\bprix\b|cout|financ|tarif/.test(n) && !/technique/.test(n)) return; // traité dans l'offre financière
    const label = `Critère « ${c.criterion} »${c.weightPercent !== null ? ` (${c.weightPercent} %)` : ""}${c.subCriteria.length ? ` — sous-critères : ${c.subCriteria.join(" ; ")}` : ""}`;
    const match = CRITERION_MAP.find(([re]) => re.test(n));
    const section = match ? outline.find((s) => s.key === match[1]) : undefined;
    if (section) section.guidance = `${section.guidance}\nRépond explicitement au ${label}.`;
    else extra.push({ key: `criterion-${i + 1}`, title: `Réponse au critère : ${c.criterion}`, guidance: `Répond explicitement au ${label}.` });
  });
  const conclusionIdx = outline.findIndex((s) => s.key === "conclusion");
  outline.splice(conclusionIdx, 0, ...extra);
  return outline;
}
