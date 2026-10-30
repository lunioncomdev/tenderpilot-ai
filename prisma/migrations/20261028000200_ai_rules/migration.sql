-- Règles de traitement IA propres à l'organisation
ALTER TABLE "CompanyProfile" ADD COLUMN "aiRules" JSONB NOT NULL DEFAULT '{}';
