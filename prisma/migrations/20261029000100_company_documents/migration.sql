-- Pièces administratives de l'entreprise (Kbis, attestations…) avec date de validité
CREATE TYPE "public"."CompanyDocType" AS ENUM ('KBIS', 'URSSAF', 'FISCALE', 'ASSURANCE_RC', 'RIB', 'DC2', 'BILANS', 'REFERENCES', 'CERTIFICATION', 'POUVOIR', 'AUTRE');

CREATE TABLE "public"."CompanyDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "public"."CompanyDocType" NOT NULL,
    "label" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyDocument_organizationId_type_idx" ON "public"."CompanyDocument"("organizationId", "type");

ALTER TABLE "public"."CompanyDocument" ADD CONSTRAINT "CompanyDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
