import type { DocumentKind, DocumentStatus, NoticeState, Recommendation, SectionStatus, TenderOrigin, TenderStatus, ComplianceStatus } from "@prisma/client";

/**
 * Libellés français. Toute chaîne d'interface partagée passe par ce dictionnaire
 * afin de permettre l'ajout d'autres langues (même structure, autre fichier).
 */
export const fr = {
  app: { name: "TenderPilot AI", tagline: "Veille et réponse aux appels d'offres informatiques" },
  nav: {
    dashboard: "Tableau de bord",
    tenders: "Explorer les appels d'offres",
    pipeline: "Mes candidatures",
    proposals: "Mémoires techniques",
    company: "Profil entreprise",
    sources: "Sources et automatisations",
    settings: "Paramètres",
  },
  tenderStatus: {
    DETECTED: "Détecté",
    TO_ANALYZE: "À analyser",
    QUALIFIED: "Qualifié",
    GO: "GO",
    NO_GO: "NO-GO",
    IN_PREPARATION: "En préparation",
    IN_VALIDATION: "En validation",
    READY_TO_SUBMIT: "Prêt à déposer",
    SUBMITTED: "Déposé",
    AWAITING_DECISION: "En attente de décision",
    WON: "Gagné",
    LOST: "Perdu",
  } satisfies Record<TenderStatus, string>,
  noticeState: { ACTIVE: "Actif", MODIFIED: "Rectifié", CANCELLED: "Annulé", AWARDED: "Attribué" } satisfies Record<NoticeState, string>,
  origin: { BOAMP: "BOAMP", TED: "TED", MANUAL: "Saisie manuelle" } satisfies Record<TenderOrigin, string>,
  recommendation: { GO: "GO", NO_GO: "NO-GO", TO_VERIFY: "À vérifier" } satisfies Record<Recommendation, string>,
  documentKind: {
    RC: "Règlement de consultation", CCTP: "CCTP", CCAP: "CCAP", AE: "Acte d'engagement", BPU: "BPU", DPGF: "DPGF",
    ANNEXE: "Annexe", QR: "Questions / réponses", AVIS: "Avis", AUTRE: "Autre",
  } satisfies Record<DocumentKind, string>,
  documentStatus: { UPLOADED: "En attente", PROCESSING: "Traitement…", EXTRACTED: "Extrait", NEEDS_OCR: "OCR requis", FAILED: "Échec" } satisfies Record<DocumentStatus, string>,
  sectionStatus: { PENDING: "À rédiger", GENERATING: "Génération…", AI_DRAFT: "Brouillon IA", EDITED: "Modifiée", VALIDATED: "Validée", FAILED: "Échec" } satisfies Record<SectionStatus, string>,
  complianceStatus: { COMPLIANT: "Conforme", PARTIAL: "Partiel", NON_COMPLIANT: "Non conforme", TO_VERIFY: "À vérifier" } satisfies Record<ComplianceStatus, string>,
} as const;

export const PIPELINE_ORDER: TenderStatus[] = [
  "DETECTED", "TO_ANALYZE", "QUALIFIED", "GO", "IN_PREPARATION", "IN_VALIDATION",
  "READY_TO_SUBMIT", "SUBMITTED", "AWAITING_DECISION", "WON", "LOST", "NO_GO",
];
