-- AlterTable
ALTER TABLE "public"."Organization" ADD COLUMN     "aiModel" TEXT,
ADD COLUMN     "openaiApiKeyEnc" TEXT,
ADD COLUMN     "syncPausedAt" TIMESTAMP(3),
ADD COLUMN     "syncPausedById" TEXT;
