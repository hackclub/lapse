/*
  Warnings:

  - You are about to drop the column `thumbnailTokenId` on the `DraftTimelapse` table. All the data in the column will be lost.
  - You are about to drop the column `videoTokenId` on the `DraftTimelapse` table. All the data in the column will be lost.
  - You are about to drop the column `containerKind` on the `Timelapse` table. All the data in the column will be lost.
  - You are about to drop the column `deviceId` on the `Timelapse` table. All the data in the column will be lost.
  - You are about to drop the column `isPublished` on the `Timelapse` table. All the data in the column will be lost.
  - You are about to drop the `Snapshot` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UploadToken` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[associatedTimelapseId]` on the table `DraftTimelapse` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `deviceId` to the `DraftTimelapse` table without a default value. This is not possible if the table is not empty.
  - Added the required column `iv` to the `DraftTimelapse` table without a default value. This is not possible if the table is not empty.
  - Added the required column `thumbnailKey` to the `DraftTimelapse` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "TimelapseVisibility" ADD VALUE 'FAILED_PROCESSING';

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

-- DropIndex
DROP INDEX "DraftTimelapse_thumbnailTokenId_key";

-- DropIndex
DROP INDEX "DraftTimelapse_videoTokenId_key";

-- AlterTable
ALTER TABLE "DraftTimelapse" DROP COLUMN "thumbnailTokenId",
DROP COLUMN "videoTokenId",
ADD COLUMN     "associatedTimelapseId" TEXT,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "deviceId" TEXT NOT NULL,
ADD COLUMN     "editList" JSONB[],
ADD COLUMN     "iv" TEXT NOT NULL,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "sessions" TEXT[],
ADD COLUMN     "snapshots" TIMESTAMP(3)[],
ADD COLUMN     "thumbnailKey" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ServiceClient" ALTER COLUMN "createdByUserId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Timelapse" DROP COLUMN "containerKind",
DROP COLUMN "deviceId",
DROP COLUMN "isPublished",
ADD COLUMN     "associatedJobId" TEXT,
ADD COLUMN     "snapshots" TIMESTAMP(3)[],
ADD COLUMN     "sourceDraftId" TEXT,
ALTER COLUMN "s3Key" DROP NOT NULL;

-- DropTable
DROP TABLE "Snapshot";

-- DropTable
DROP TABLE "UploadToken";

-- CreateIndex
CREATE UNIQUE INDEX "DraftTimelapse_associatedTimelapseId_key" ON "DraftTimelapse"("associatedTimelapseId");

-- AddForeignKey
ALTER TABLE "DraftTimelapse" ADD CONSTRAINT "DraftTimelapse_associatedTimelapseId_fkey" FOREIGN KEY ("associatedTimelapseId") REFERENCES "Timelapse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftTimelapse" ADD CONSTRAINT "DraftTimelapse_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "KnownDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceClient" ADD CONSTRAINT "ServiceClient_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
