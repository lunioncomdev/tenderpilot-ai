-- Chiffrage des bordereaux de prix (BPU / DPGF / DQE)
CREATE TABLE "public"."Pricing" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "adjustmentPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pricing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."PricingLine" (
    "id" TEXT NOT NULL,
    "pricingId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "sheet" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "isHeading" BOOLEAN NOT NULL DEFAULT false,
    "reference" TEXT NOT NULL DEFAULT '',
    "designation" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION,
    "priceCell" TEXT,
    "amountCell" TEXT,
    "manualPrice" DOUBLE PRECISION,
    "days" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "PricingLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Pricing_tenderId_documentId_key" ON "public"."Pricing"("tenderId", "documentId");
CREATE INDEX "Pricing_organizationId_tenderId_idx" ON "public"."Pricing"("organizationId", "tenderId");
CREATE UNIQUE INDEX "PricingLine_pricingId_sheet_row_key" ON "public"."PricingLine"("pricingId", "sheet", "row");

ALTER TABLE "public"."Pricing" ADD CONSTRAINT "Pricing_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Pricing" ADD CONSTRAINT "Pricing_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "public"."Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Pricing" ADD CONSTRAINT "Pricing_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."TenderDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."PricingLine" ADD CONSTRAINT "PricingLine_pricingId_fkey" FOREIGN KEY ("pricingId") REFERENCES "public"."Pricing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
