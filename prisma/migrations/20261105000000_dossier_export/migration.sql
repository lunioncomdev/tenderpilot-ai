-- Identité légale du candidat (DC1 / DC2) et fichiers joints aux pièces du dossier
ALTER TABLE "public"."CompanyProfile"
ADD COLUMN "legalForm" TEXT NOT NULL DEFAULT '',
ADD COLUMN "nafCode" TEXT NOT NULL DEFAULT '',
ADD COLUMN "vatNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN "address" TEXT NOT NULL DEFAULT '',
ADD COLUMN "postalCode" TEXT NOT NULL DEFAULT '',
ADD COLUMN "city" TEXT NOT NULL DEFAULT '',
ADD COLUMN "phone" TEXT NOT NULL DEFAULT '',
ADD COLUMN "email" TEXT NOT NULL DEFAULT '',
ADD COLUMN "legalRepName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "legalRepTitle" TEXT NOT NULL DEFAULT '';

-- Reprise des coordonnées déjà saisies pour le retrait des DCE
UPDATE "public"."CompanyProfile" p SET
  "address" = TRIM(CONCAT_WS(' ', NULLIF(d."address", ''), NULLIF(d."address2", ''))),
  "postalCode" = d."postalCode",
  "city" = d."city",
  "phone" = d."phone",
  "email" = d."email",
  "siren" = COALESCE(NULLIF(p."siren", ''), NULLIF(d."siret", ''))
FROM "public"."DceRetrievalSettings" d
WHERE d."organizationId" = p."organizationId";

CREATE TABLE "public"."ApplicationPieceFile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pieceId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationPieceFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApplicationPieceFile_organizationId_pieceId_idx" ON "public"."ApplicationPieceFile"("organizationId", "pieceId");

ALTER TABLE "public"."ApplicationPieceFile" ADD CONSTRAINT "ApplicationPieceFile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ApplicationPieceFile" ADD CONSTRAINT "ApplicationPieceFile_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "public"."ApplicationPiece"("id") ON DELETE CASCADE ON UPDATE CASCADE;
