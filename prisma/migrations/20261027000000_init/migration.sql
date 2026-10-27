-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";


-- CreateEnum
CREATE TYPE "public"."Plan" AS ENUM ('STARTER', 'PRO', 'AGENCY');

-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "public"."SourceKey" AS ENUM ('BOAMP', 'TED');

-- CreateEnum
CREATE TYPE "public"."SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."TenderStatus" AS ENUM ('DETECTED', 'TO_ANALYZE', 'QUALIFIED', 'GO', 'NO_GO', 'IN_PREPARATION', 'IN_VALIDATION', 'READY_TO_SUBMIT', 'SUBMITTED', 'AWAITING_DECISION', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "public"."NoticeState" AS ENUM ('ACTIVE', 'MODIFIED', 'CANCELLED', 'AWARDED');

-- CreateEnum
CREATE TYPE "public"."TenderOrigin" AS ENUM ('BOAMP', 'TED', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."DocumentKind" AS ENUM ('RC', 'CCTP', 'CCAP', 'AE', 'BPU', 'DPGF', 'ANNEXE', 'QR', 'AVIS', 'AUTRE');

-- CreateEnum
CREATE TYPE "public"."DocumentStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'EXTRACTED', 'NEEDS_OCR', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."Recommendation" AS ENUM ('GO', 'NO_GO', 'TO_VERIFY');

-- CreateEnum
CREATE TYPE "public"."ProposalStatus" AS ENUM ('DRAFT', 'GENERATING', 'IN_REVIEW', 'VALIDATED');

-- CreateEnum
CREATE TYPE "public"."SectionStatus" AS ENUM ('PENDING', 'GENERATING', 'AI_DRAFT', 'EDITED', 'VALIDATED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."ComplianceStatus" AS ENUM ('COMPLIANT', 'PARTIAL', 'NON_COMPLIANT', 'TO_VERIFY');

-- CreateTable
CREATE TABLE "public"."Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" "public"."Plan" NOT NULL DEFAULT 'PRO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "public"."Role" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CompanyProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "siren" TEXT,
    "country" TEXT NOT NULL DEFAULT 'FR',
    "eligibleCountries" TEXT[] DEFAULT ARRAY['FR']::TEXT[],
    "description" TEXT NOT NULL DEFAULT '',
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "certifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "headcount" INTEGER,
    "annualRevenueEur" INTEGER,
    "insuranceRc" BOOLEAN NOT NULL DEFAULT false,
    "canSubcontract" BOOLEAN NOT NULL DEFAULT true,
    "canJoinConsortium" BOOLEAN NOT NULL DEFAULT true,
    "minBudgetEur" INTEGER,
    "maxBudgetEur" INTEGER,
    "cpvCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dailyRates" JSONB NOT NULL DEFAULT '{}',
    "scoringWeights" JSONB NOT NULL DEFAULT '{}',
    "methodology" TEXT NOT NULL DEFAULT '',
    "qualityProcess" TEXT NOT NULL DEFAULT '',
    "securityPolicy" TEXT NOT NULL DEFAULT '',
    "gdprCommitments" TEXT NOT NULL DEFAULT '',
    "ecoDesign" TEXT NOT NULL DEFAULT '',
    "accessibility" TEXT NOT NULL DEFAULT '',
    "allowAiDocumentUpload" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CompanyReference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "clientType" TEXT,
    "year" INTEGER,
    "amountEur" INTEGER,
    "durationMonths" INTEGER,
    "description" TEXT NOT NULL,
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sector" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SourceConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" "public"."SourceKey" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "lastSyncAt" TIMESTAMP(3),
    "lastStatus" "public"."SyncStatus",

    CONSTRAINT "SourceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SyncRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" "public"."SourceKey" NOT NULL,
    "status" "public"."SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "trigger" TEXT NOT NULL DEFAULT 'manual',

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Tender" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "origin" "public"."TenderOrigin" NOT NULL,
    "externalId" TEXT NOT NULL,
    "publicationRef" TEXT,
    "procedureId" TEXT,
    "dedupKey" TEXT NOT NULL,
    "duplicateOfId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "buyerName" TEXT NOT NULL DEFAULT '',
    "buyerCountry" TEXT,
    "region" TEXT,
    "cpvCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estimatedValue" DECIMAL(14,2),
    "currency" TEXT,
    "publishedAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "procedureType" TEXT,
    "noticeType" TEXT,
    "contractType" TEXT,
    "durationMonths" INTEGER,
    "isPublicMarket" BOOLEAN NOT NULL DEFAULT true,
    "allowsConsortium" BOOLEAN,
    "noticeUrl" TEXT,
    "documentsUrl" TEXT,
    "noticeState" "public"."NoticeState" NOT NULL DEFAULT 'ACTIVE',
    "status" "public"."TenderStatus" NOT NULL DEFAULT 'DETECTED',
    "preScore" INTEGER,
    "assigneeId" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),

    CONSTRAINT "Tender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SavedSearch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "alertEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastAlertAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TenderDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "parentId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "kind" "public"."DocumentKind" NOT NULL DEFAULT 'AUTRE',
    "status" "public"."DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "pageCount" INTEGER,
    "charCount" INTEGER,
    "error" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenderDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DocumentChunk" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "heading" TEXT,
    "text" TEXT NOT NULL,
    "tokenEstimate" INTEGER NOT NULL,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TenderAnalysis" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "status" "public"."JobStatus" NOT NULL DEFAULT 'PENDING',
    "model" TEXT,
    "promptVersion" TEXT,
    "result" JSONB,
    "citationStats" JSONB,
    "error" TEXT,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TenderAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TenderScore" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "analysisId" TEXT,
    "total" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "eliminatory" JSONB NOT NULL,
    "recommendation" "public"."Recommendation" NOT NULL,
    "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weaknesses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missingInfo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "risks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "justification" TEXT NOT NULL,
    "weights" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenderScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AiUsageLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Proposal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "public"."ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProposalSection" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "guidance" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "status" "public"."SectionStatus" NOT NULL DEFAULT 'PENDING',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "toValidate" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProposalSectionVersion" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalSectionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ComplianceItem" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "requirement" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "evidence" TEXT NOT NULL DEFAULT '',
    "status" "public"."ComplianceStatus" NOT NULL DEFAULT 'TO_VERIFY',
    "source" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ComplianceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Comment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "public"."Membership"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "public"."Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyProfile_organizationId_key" ON "public"."CompanyProfile"("organizationId");

-- CreateIndex
CREATE INDEX "CompanyReference_organizationId_idx" ON "public"."CompanyReference"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceConfig_organizationId_source_key" ON "public"."SourceConfig"("organizationId", "source");

-- CreateIndex
CREATE INDEX "SyncRun_organizationId_startedAt_idx" ON "public"."SyncRun"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "Tender_organizationId_status_idx" ON "public"."Tender"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Tender_organizationId_deadlineAt_idx" ON "public"."Tender"("organizationId", "deadlineAt");

-- CreateIndex
CREATE INDEX "Tender_organizationId_publishedAt_idx" ON "public"."Tender"("organizationId", "publishedAt");

-- CreateIndex
CREATE INDEX "Tender_organizationId_procedureId_idx" ON "public"."Tender"("organizationId", "procedureId");

-- CreateIndex
CREATE INDEX "Tender_organizationId_dedupKey_idx" ON "public"."Tender"("organizationId", "dedupKey");

-- CreateIndex
CREATE UNIQUE INDEX "Tender_organizationId_origin_externalId_key" ON "public"."Tender"("organizationId", "origin", "externalId");

-- CreateIndex
CREATE INDEX "SavedSearch_organizationId_userId_idx" ON "public"."SavedSearch"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "TenderDocument_organizationId_tenderId_idx" ON "public"."TenderDocument"("organizationId", "tenderId");

-- CreateIndex
CREATE UNIQUE INDEX "TenderDocument_tenderId_sha256_key" ON "public"."TenderDocument"("tenderId", "sha256");

-- CreateIndex
CREATE INDEX "DocumentChunk_organizationId_idx" ON "public"."DocumentChunk"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentChunk_documentId_index_key" ON "public"."DocumentChunk"("documentId", "index");

-- CreateIndex
CREATE INDEX "TenderAnalysis_organizationId_tenderId_createdAt_idx" ON "public"."TenderAnalysis"("organizationId", "tenderId", "createdAt");

-- CreateIndex
CREATE INDEX "TenderScore_organizationId_tenderId_createdAt_idx" ON "public"."TenderScore"("organizationId", "tenderId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageLog_organizationId_createdAt_idx" ON "public"."AiUsageLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Proposal_organizationId_tenderId_idx" ON "public"."Proposal"("organizationId", "tenderId");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalSection_proposalId_key_key" ON "public"."ProposalSection"("proposalId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalSectionVersion_sectionId_version_key" ON "public"."ProposalSectionVersion"("sectionId", "version");

-- CreateIndex
CREATE INDEX "ComplianceItem_proposalId_idx" ON "public"."ComplianceItem"("proposalId");

-- CreateIndex
CREATE INDEX "Comment_tenderId_createdAt_idx" ON "public"."Comment"("tenderId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "public"."AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "public"."AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "public"."Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CompanyProfile" ADD CONSTRAINT "CompanyProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CompanyReference" ADD CONSTRAINT "CompanyReference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SourceConfig" ADD CONSTRAINT "SourceConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SyncRun" ADD CONSTRAINT "SyncRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Tender" ADD CONSTRAINT "Tender_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Tender" ADD CONSTRAINT "Tender_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Tender" ADD CONSTRAINT "Tender_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "public"."Tender"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SavedSearch" ADD CONSTRAINT "SavedSearch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SavedSearch" ADD CONSTRAINT "SavedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TenderDocument" ADD CONSTRAINT "TenderDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TenderDocument" ADD CONSTRAINT "TenderDocument_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "public"."Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TenderDocument" ADD CONSTRAINT "TenderDocument_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."TenderDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DocumentChunk" ADD CONSTRAINT "DocumentChunk_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "public"."TenderDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TenderAnalysis" ADD CONSTRAINT "TenderAnalysis_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TenderAnalysis" ADD CONSTRAINT "TenderAnalysis_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "public"."Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TenderScore" ADD CONSTRAINT "TenderScore_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TenderScore" ADD CONSTRAINT "TenderScore_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "public"."Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TenderScore" ADD CONSTRAINT "TenderScore_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "public"."TenderAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AiUsageLog" ADD CONSTRAINT "AiUsageLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Proposal" ADD CONSTRAINT "Proposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Proposal" ADD CONSTRAINT "Proposal_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "public"."Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProposalSection" ADD CONSTRAINT "ProposalSection_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "public"."Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProposalSectionVersion" ADD CONSTRAINT "ProposalSectionVersion_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "public"."ProposalSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ComplianceItem" ADD CONSTRAINT "ComplianceItem_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "public"."Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Comment" ADD CONSTRAINT "Comment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Comment" ADD CONSTRAINT "Comment_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "public"."Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

