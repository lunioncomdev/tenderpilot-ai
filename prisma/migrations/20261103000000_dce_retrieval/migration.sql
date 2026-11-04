-- CreateEnum
CREATE TYPE "public"."DceRetrievalMode" AS ENUM ('DISABLED', 'ANONYMOUS', 'IDENTIFIED');

-- AlterTable
ALTER TABLE "public"."Tender" ADD COLUMN     "dceFetchError" TEXT,
ADD COLUMN     "dceFetchedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."DceRetrievalSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mode" "public"."DceRetrievalMode" NOT NULL DEFAULT 'DISABLED',
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "legalName" TEXT NOT NULL DEFAULT '',
    "siret" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "address2" TEXT NOT NULL DEFAULT '',
    "postalCode" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "termsAcceptedAt" TIMESTAMP(3),
    "termsAcceptedById" TEXT,
    "autoRetrieve" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DceRetrievalSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlatformAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "passwordEnc" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DceRetrievalSettings_organizationId_key" ON "public"."DceRetrievalSettings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAccount_organizationId_host_key" ON "public"."PlatformAccount"("organizationId", "host");

-- AddForeignKey
ALTER TABLE "public"."DceRetrievalSettings" ADD CONSTRAINT "DceRetrievalSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlatformAccount" ADD CONSTRAINT "PlatformAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

