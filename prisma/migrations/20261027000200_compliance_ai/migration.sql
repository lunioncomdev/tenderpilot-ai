-- Génération IA des réponses de la matrice de conformité
ALTER TABLE "Proposal" ADD COLUMN "complianceGeneratingAt" TIMESTAMP(3), ADD COLUMN "complianceError" TEXT;
ALTER TABLE "ComplianceItem" ADD COLUMN "aiGenerated" BOOLEAN NOT NULL DEFAULT false;
