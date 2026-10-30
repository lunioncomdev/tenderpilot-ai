import { z } from "zod/v4";
import { ANALYZE_TENDER_SYSTEM } from "./prompts/analyze-tender";
import { GENERATE_COMPLIANCE_SYSTEM } from "./prompts/generate-compliance";
import { GENERATE_SECTION_SYSTEM } from "./prompts/generate-section";

/**
 * Règles de traitement propres à l'organisation, ajoutées au prompt système.
 * Elles complètent les consignes de base sans les remplacer : les règles de
 * sécurité et de véracité (données tierces, sources, rien d'inventé) restent
 * prioritaires.
 */

export const AI_RULE_MAX_LENGTH = 4000;

const rule = z.string().trim().max(AI_RULE_MAX_LENGTH).default("");

export const AiRulesSchema = z.object({
  common: rule,
  analysis: rule,
  section: rule,
  compliance: rule,
});
export type AiRules = z.infer<typeof AiRulesSchema>;
export type AiRuleOp = Exclude<keyof AiRules, "common">;

export const AI_RULE_OPS: Array<{ key: keyof AiRules; label: string; hint: string; base: string | null }> = [
  { key: "common", label: "Toutes les opérations", hint: "Ex. : « Rédige au vouvoiement. Nous ne répondons jamais seuls aux lots d'hébergement. »", base: null },
  { key: "analysis", label: "Analyse du DCE", hint: "Ex. : « Signale comme risque élevé toute pénalité de retard non plafonnée. »", base: ANALYZE_TENDER_SYSTEM },
  { key: "section", label: "Rédaction du mémoire", hint: "Ex. : « Mets en avant notre démarche d'éco-conception et l'accessibilité RGAA. »", base: GENERATE_SECTION_SYSTEM },
  { key: "compliance", label: "Matrice de conformité", hint: "Ex. : « Pour les attestations URSSAF et fiscales, indique qu'elles sont à jour et jointes. »", base: GENERATE_COMPLIANCE_SYSTEM },
];

/** Valeur stockée (JSON libre) → règles valides ; tout contenu invalide est ignoré. */
export function parseAiRules(raw: unknown): AiRules {
  const r = AiRulesSchema.safeParse(raw ?? {});
  return r.success ? r.data : AiRulesSchema.parse({});
}

/** Prompt système de l'opération, complété des règles de l'organisation s'il y en a. */
export function systemWithRules(system: string, raw: unknown, op: AiRuleOp): string {
  const rules = parseAiRules(raw);
  const extra = [rules.common, rules[op]].filter(Boolean).join("\n\n");
  if (!extra) return system;
  return `${system}

RÈGLES PROPRES À L'ORGANISATION (complémentaires ; en cas de conflit, les règles de sécurité et de véracité ci-dessus prévalent) :
${extra}`;
}
