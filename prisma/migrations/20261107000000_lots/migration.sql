-- Lots des consultations allotites : sélection des lots, pièces, mémoires et bordereaux par lot
CREATE TABLE "public"."TenderLot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "fromAnalysis" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenderLot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TenderLot_tenderId_number_key" ON "public"."TenderLot"("tenderId", "number");
CREATE INDEX "TenderLot_organizationId_tenderId_idx" ON "public"."TenderLot"("organizationId", "tenderId");
ALTER TABLE "public"."TenderLot" ADD CONSTRAINT "TenderLot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."TenderLot" ADD CONSTRAINT "TenderLot_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "public"."Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ApplicationPiece" ADD COLUMN "lotId" TEXT;
ALTER TABLE "public"."Proposal" ADD COLUMN "lotId" TEXT;
ALTER TABLE "public"."Pricing" ADD COLUMN "lotId" TEXT;

-- Une pièce par clé et par lot ; NULLS NOT DISTINCT : une seule pièce commune par clé (PostgreSQL ≥ 15).
DROP INDEX "public"."ApplicationPiece_tenderId_key_key";
CREATE UNIQUE INDEX "ApplicationPiece_tenderId_key_lotId_key" ON "public"."ApplicationPiece"("tenderId", "key", "lotId") NULLS NOT DISTINCT;

ALTER TABLE "public"."ApplicationPiece" ADD CONSTRAINT "ApplicationPiece_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "public"."TenderLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Proposal" ADD CONSTRAINT "Proposal_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "public"."TenderLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."Pricing" ADD CONSTRAINT "Pricing_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "public"."TenderLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
