-- Migration: V2 Draft and OAuth Refactor
--
-- This migration performs the following:
--   1. Adds FAILED_PROCESSING to TimelapseVisibility enum
--   2. Creates LegacyUnpublishedTimelapse table for encrypted, unpublished timelapses
--   3. Migrates unpublished Timelapse rows to LegacyUnpublishedTimelapse
--   4. Migrates Snapshot data into the Timelapse.snapshots array field
--   5. Restructures DraftTimelapse for the V2 encryption model (table is empty in production)
--   6. Removes deprecated models (Snapshot, UploadToken)
--   7. Updates Timelapse schema (removes isPublished, containerKind, deviceId)
--   8. Makes ServiceClient.createdByUserId nullable

-- =============================================
-- Phase 1: Create new structures
-- =============================================

-- AlterEnum
ALTER TYPE "TimelapseVisibility" ADD VALUE IF NOT EXISTS 'FAILED_PROCESSING';

-- CreateTable
CREATE TABLE "LegacyUnpublishedTimelapse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "primarySession" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "LegacyUnpublishedTimelapse_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "LegacyUnpublishedTimelapse"
    ADD CONSTRAINT "LegacyUnpublishedTimelapse_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "KnownDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyUnpublishedTimelapse"
    ADD CONSTRAINT "LegacyUnpublishedTimelapse_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddColumn (needed before Snapshot data migration)
ALTER TABLE "Timelapse" ADD COLUMN "snapshots" TIMESTAMP(3)[];

-- =============================================
-- Phase 2: Data migration
-- =============================================

-- Migrate every unpublished timelapse to LegacyUnpublishedTimelapse.
-- Only timelapses with a known device can be migrated (deviceId is required for client-side decryption).
-- Unpublished timelapses without a device are unrecoverable and will be deleted below.
INSERT INTO "LegacyUnpublishedTimelapse" ("id", "name", "description", "primarySession", "deviceId", "ownerId")
SELECT "id", "name", "description", "s3Key", "deviceId", "ownerId"
FROM "Timelapse"
WHERE "isPublished" = false AND "deviceId" IS NOT NULL;

-- Migrate Snapshot timestamps into the new Timelapse.snapshots array field.
UPDATE "Timelapse" t
SET "snapshots" = sub.snapshot_array
FROM (
    SELECT "timelapseId", array_agg("createdAt" ORDER BY "frame") AS snapshot_array
    FROM "Snapshot"
    GROUP BY "timelapseId"
) sub
WHERE t."id" = sub."timelapseId";

-- Ensure all timelapses have a non-null snapshots array.
UPDATE "Timelapse" SET "snapshots" = '{}' WHERE "snapshots" IS NULL;

-- Remove unpublished timelapses and their associated data from the Timelapse table.
-- Comments and Snapshots referencing unpublished timelapses must be deleted first (FK constraints).
DELETE FROM "Comment" WHERE "timelapseId" IN (SELECT "id" FROM "Timelapse" WHERE "isPublished" = false);
DELETE FROM "Snapshot" WHERE "timelapseId" IN (SELECT "id" FROM "Timelapse" WHERE "isPublished" = false);
DELETE FROM "Timelapse" WHERE "isPublished" = false;

-- =============================================
-- Phase 3: Drop old foreign keys
-- =============================================

-- DropForeignKey
ALTER TABLE "DraftTimelapse" DROP CONSTRAINT "DraftTimelapse_thumbnailTokenId_fkey";

-- DropForeignKey
ALTER TABLE "DraftTimelapse" DROP CONSTRAINT "DraftTimelapse_videoTokenId_fkey";

-- DropForeignKey
ALTER TABLE "ServiceClient" DROP CONSTRAINT "ServiceClient_createdByUserId_fkey";

-- DropForeignKey
ALTER TABLE "Snapshot" DROP CONSTRAINT "Snapshot_timelapseId_fkey";

-- DropForeignKey
ALTER TABLE "Timelapse" DROP CONSTRAINT "Timelapse_deviceId_fkey";

-- DropForeignKey
ALTER TABLE "UploadToken" DROP CONSTRAINT "UploadToken_ownerId_fkey";

-- =============================================
-- Phase 4: Schema changes
-- =============================================

-- DropIndex
DROP INDEX "DraftTimelapse_thumbnailTokenId_key";

-- DropIndex
DROP INDEX "DraftTimelapse_videoTokenId_key";

-- Truncate DraftTimelapse: the V2 model is entirely different from V1.
-- This table is empty in production (drafts were always transient).
TRUNCATE TABLE "DraftTimelapse";

-- AlterTable
ALTER TABLE "DraftTimelapse"
    DROP COLUMN "thumbnailTokenId",
    DROP COLUMN "videoTokenId",
    ADD COLUMN "associatedTimelapseId" TEXT,
    ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "deviceId" TEXT NOT NULL,
    ADD COLUMN "editList" JSONB[],
    ADD COLUMN "iv" TEXT NOT NULL,
    ADD COLUMN "name" TEXT,
    ADD COLUMN "sessions" TEXT[],
    ADD COLUMN "snapshots" TIMESTAMP(3)[],
    ADD COLUMN "thumbnailKey" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ServiceClient" ALTER COLUMN "createdByUserId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Timelapse"
    DROP COLUMN "containerKind",
    DROP COLUMN "deviceId",
    DROP COLUMN "isPublished",
    ADD COLUMN "associatedJobId" TEXT,
    ADD COLUMN "sourceDraftId" TEXT,
    ALTER COLUMN "s3Key" DROP NOT NULL;

-- =============================================
-- Phase 5: Drop deprecated tables
-- =============================================

-- DropTable
DROP TABLE "Snapshot";

-- DropTable
DROP TABLE "UploadToken";

-- =============================================
-- Phase 6: Create new indexes and foreign keys
-- =============================================

-- CreateIndex
CREATE UNIQUE INDEX "DraftTimelapse_associatedTimelapseId_key" ON "DraftTimelapse"("associatedTimelapseId");

-- AddForeignKey
ALTER TABLE "DraftTimelapse" ADD CONSTRAINT "DraftTimelapse_associatedTimelapseId_fkey" FOREIGN KEY ("associatedTimelapseId") REFERENCES "Timelapse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftTimelapse" ADD CONSTRAINT "DraftTimelapse_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "KnownDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceClient" ADD CONSTRAINT "ServiceClient_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
