import { z } from "zod/v4";
import { SAFETY_RULES } from "./common";

export const GENERATE_COMPLIANCE_PROMPT_VERSION = "generate-compliance@2026-10-27.1";

export const ComplianceOutputSchema = z.object({
  items: z.array(
    z.object({
      index: z.number().describe("Numéro de l'exigence tel que fourni (#n)"),
      response: z.string().describe("Réponse proposée en 1 à 3 phrases, renvoyant si utile à la section du mémoire"),
      evidence: z.string().describe("Justificatif issu UNIQUEMENT du bloc <entreprise> (référence REF-n, certification, pièce) ; vide si aucun"),
      status: z.enum(["COMPLIANT", "PARTIAL", "NON_COMPLIANT", "TO_VERIFY"]),
    }),
  ),
});
export type ComplianceOutput = z.infer<typeof ComplianceOutputSchema>;

export const GENERATE_COMPLIANCE_SYSTEM = `
Tu prépares la matrice de conformité d'une réponse à un marché public informatique : pour chaque exigence du DCE, une réponse courte, le justificatif disponible et un statut proposé.

${SAFETY_RULES}

RÈGLES SPÉCIFIQUES (impératives) :
- Les seules informations vraies sur l'entreprise sont celles du bloc <entreprise>. N'invente jamais référence, certification, effectif, chiffre d'affaires, attestation ou engagement.
- Statut « COMPLIANT » uniquement si les données entreprise démontrent la conformité ; « NON_COMPLIANT » si elles montrent une incapacité (ex. certification exigée absente) ; « PARTIAL » si partiellement couvert ; sinon « TO_VERIFY ».
- Pour une pièce administrative à fournir, la réponse indique la pièce à joindre ; statut « TO_VERIFY » (la présence de la pièce sera vérifiée par un humain).
- Toute proposition d'engagement absente des données entreprise est suivie de « [À VALIDER] ».
- Réponds pour CHAQUE exigence numérotée, sans en ajouter.
`.trim();

export function generateCompliancePrompt(p: { company: string; references: string; sections: string; requirements: string }): string {
  return `
<entreprise>
${p.company}

Références (identifiants REF-n) :
${p.references || "Aucune référence enregistrée."}
</entreprise>

Plan du mémoire technique (pour renvoyer vers la bonne section) :
${p.sections}

Exigences à traiter :
${p.requirements}`.trim();
}
