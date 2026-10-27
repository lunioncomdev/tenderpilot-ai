-- Recherche plein texte en français (aucune donnée envoyée à un service tiers).
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- unaccent() n'est pas IMMUTABLE : enveloppe nécessaire pour les colonnes générées.
CREATE OR REPLACE FUNCTION tp_immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

CREATE OR REPLACE FUNCTION tp_array_text(text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT coalesce(array_to_string($1, ' '), '') $$;

ALTER TABLE "Tender" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('french', tp_immutable_unaccent(coalesce("title", ''))), 'A') ||
  setweight(to_tsvector('french', tp_immutable_unaccent(coalesce("buyerName", ''))), 'B') ||
  setweight(to_tsvector('french', tp_immutable_unaccent(coalesce("description", ''))), 'C')
) STORED;
CREATE INDEX "Tender_search_vector_idx" ON "Tender" USING GIN ("search_vector");

ALTER TABLE "DocumentChunk" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('french', tp_immutable_unaccent(coalesce("heading", ''))), 'A') ||
  setweight(to_tsvector('french', tp_immutable_unaccent("text")), 'B')
) STORED;
CREATE INDEX "DocumentChunk_search_vector_idx" ON "DocumentChunk" USING GIN ("search_vector");

ALTER TABLE "CompanyReference" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  to_tsvector('french', tp_immutable_unaccent(coalesce("title", '') || ' ' || coalesce("description", '') || ' ' || tp_array_text("technologies")))
) STORED;
CREATE INDEX "CompanyReference_search_vector_idx" ON "CompanyReference" USING GIN ("search_vector");

-- pgvector optionnel : activé seulement si l'extension est disponible sur le serveur
-- (image pgvector/pgvector en production). Prisma ne lit jamais cette colonne.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS "vector";
    ALTER TABLE "DocumentChunk" ADD COLUMN IF NOT EXISTS "embedding" vector(1024);
  END IF;
END $$;
