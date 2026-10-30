-- Dossier de candidature : pièces à réunir et suivi de leur avancement
CREATE TYPE "public"."PieceGroup" AS ENUM ('CANDIDATURE', 'OFFRE');

CREATE TYPE "public"."PieceStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'NOT_APPLICABLE');

CREATE TABLE "public"."ApplicationPiece" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "group" "public"."PieceGroup" NOT NULL,
    "order" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "fromDce" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."PieceStatus" NOT NULL DEFAULT 'TODO',
    "note" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationPiece_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApplicationPiece_tenderId_key_key" ON "public"."ApplicationPiece"("tenderId", "key");

CREATE INDEX "ApplicationPiece_organizationId_tenderId_idx" ON "public"."ApplicationPiece"("organizationId", "tenderId");

ALTER TABLE "public"."ApplicationPiece" ADD CONSTRAINT "ApplicationPiece_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ApplicationPiece" ADD CONSTRAINT "ApplicationPiece_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "public"."Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
