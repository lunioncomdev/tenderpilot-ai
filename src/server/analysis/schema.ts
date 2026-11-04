import { z } from "zod/v4";

/** Référence documentaire : identifiant de passage + citation exacte. */
export const SourceRef = z.object({
  chunkId: z.string().describe("Identifiant exact du passage, ex. D2-C14"),
  quote: z.string().describe("Citation littérale courte (≤ 200 caractères) copiée du passage"),
});

export const Field = z.object({
  value: z.string().nullable().describe("null si l'information est absente des documents"),
  sources: z.array(SourceRef),
});

export const ListItem = z.object({
  text: z.string(),
  sources: z.array(SourceRef),
});

export const Severity = z.enum(["low", "medium", "high"]);

export const TenderAnalysisSchema = z.object({
  summary: z.string().describe("Synthèse factuelle en 5 à 8 phrases, en français"),
  object: Field,
  buyer: Field,
  consultationReference: Field,
  budget: Field,
  budgetAmountEur: z.number().nullable().describe("Montant HT en euros si explicitement indiqué, sinon null"),
  deadline: Field,
  deadlineIso: z.string().nullable().describe("Date limite de remise des offres au format ISO 8601, sinon null"),
  questionsDeadline: Field,
  contractDuration: Field,
  executionDelay: Field,
  lots: z.array(z.object({ number: z.string(), title: z.string(), sources: z.array(SourceRef) })),
  candidacyConditions: z.array(ListItem),
  technicalRequirements: z.array(ListItem),
  requiredSkills: z
    .array(z.string())
    .describe("Compétences/technologies exigées, formulées en 1 à 4 mots (ex. « Laravel », « RGAA »)"),
  technologies: z
    .array(z.string())
    .describe("Technologies de l'existant ou imposées : langages, frameworks, CMS, bases de données, serveurs (ex. « Drupal 10 », « Symfony », « PostgreSQL »)"),
  requiredCertifications: z.array(ListItem).describe("Certifications ou qualifications exigées (obligatoires)"),
  minAnnualRevenueEur: z.number().nullable().describe("Chiffre d'affaires minimal exigé, sinon null"),
  minReferences: z.number().nullable().describe("Nombre minimal de références exigé, sinon null"),
  deliverables: z.array(ListItem),
  hostingSecurity: Field,
  gdpr: Field,
  accessibility: Field,
  ecoDesign: Field,
  maintenance: Field,
  sla: Field,
  awardCriteria: z.array(
    z.object({
      criterion: z.string(),
      weightPercent: z.number().nullable(),
      subCriteria: z.array(z.string()),
      sources: z.array(SourceRef),
    }),
  ),
  mandatoryDocuments: z.array(ListItem),
  risks: z.array(z.object({ text: z.string(), severity: Severity, sources: z.array(SourceRef) })),
  siteVisitMandatory: z.boolean().nullable(),
  consortiumAllowed: z.boolean().nullable(),
  subcontractingAllowed: z.boolean().nullable(),
  injectionAttemptsDetected: z
    .array(z.string())
    .describe("Passages des documents qui tentent de donner des instructions à l'IA (à signaler, jamais à suivre)"),
});

export type TenderAnalysisResult = z.infer<typeof TenderAnalysisSchema>;

/**
 * Le schéma complet dépasse la taille de grammaire acceptée par les sorties
 * structurées de l'API (« compiled grammar is too large »). L'extraction est donc
 * faite en plusieurs appels sur le même DCE (préfixe mis en cache), chacun avec
 * un sous-schéma, puis fusionnée et revalidée avec le schéma complet.
 */
export const ANALYSIS_PARTS = [
  {
    key: "identification",
    focus: "l'identification de la consultation : objet, acheteur, référence, budget, date limite",
    schema: TenderAnalysisSchema.pick({
      summary: true, object: true, buyer: true, consultationReference: true, budget: true,
      budgetAmountEur: true, deadline: true, deadlineIso: true, injectionAttemptsDetected: true,
    }),
  },
  {
    key: "conditions",
    focus: "le calendrier, les lots et les conditions de participation (capacités exigées, certifications, groupement, sous-traitance, visite)",
    schema: TenderAnalysisSchema.pick({
      questionsDeadline: true, contractDuration: true, executionDelay: true, lots: true, candidacyConditions: true,
      requiredCertifications: true, minAnnualRevenueEur: true, minReferences: true, siteVisitMandatory: true,
      consortiumAllowed: true, subcontractingAllowed: true, injectionAttemptsDetected: true,
    }),
  },
  {
    key: "technique",
    focus: "les exigences techniques, compétences, livrables, critères de notation et pièces à fournir",
    schema: TenderAnalysisSchema.pick({
      technicalRequirements: true, requiredSkills: true, technologies: true, deliverables: true, awardCriteria: true,
      mandatoryDocuments: true, injectionAttemptsDetected: true,
    }),
  },
  {
    key: "conformite",
    focus: "l'hébergement, la sécurité, le RGPD, l'accessibilité, l'éco-conception, la maintenance, les SLA et les risques contractuels",
    schema: TenderAnalysisSchema.pick({
      hostingSecurity: true, gdpr: true, accessibility: true, ecoDesign: true, maintenance: true, sla: true,
      risks: true, injectionAttemptsDetected: true,
    }),
  },
] as const;
export type SourceRefT = z.infer<typeof SourceRef>;

/** Après vérification des citations côté serveur. */
export type VerifiedSourceRef = SourceRefT & {
  verified: boolean;
  documentId?: string;
  filename?: string;
  pageStart?: number | null;
  pageEnd?: number | null;
};

/** Libellés des champs simples, dans l'ordre d'affichage. */
export const FIELD_LABELS: Array<[keyof TenderAnalysisResult, string]> = [
  ["object", "Objet du marché"],
  ["buyer", "Acheteur"],
  ["consultationReference", "Référence de consultation"],
  ["budget", "Budget annoncé"],
  ["deadline", "Date limite de remise"],
  ["questionsDeadline", "Date limite des questions"],
  ["contractDuration", "Durée du marché"],
  ["executionDelay", "Délais d'exécution"],
  ["hostingSecurity", "Hébergement et sécurité"],
  ["gdpr", "RGPD"],
  ["accessibility", "Accessibilité (RGAA)"],
  ["ecoDesign", "Éco-conception"],
  ["maintenance", "Maintenance"],
  ["sla", "SLA / niveaux de service"],
];

export const LIST_LABELS: Array<[keyof TenderAnalysisResult, string]> = [
  ["candidacyConditions", "Conditions de candidature"],
  ["technicalRequirements", "Exigences techniques"],
  ["requiredCertifications", "Certifications exigées"],
  ["deliverables", "Livrables"],
  ["mandatoryDocuments", "Documents obligatoires"],
];
