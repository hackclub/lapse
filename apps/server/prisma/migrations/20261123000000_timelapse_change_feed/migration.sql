-- AlterTable
ALTER TABLE "Timelapse" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- A timelapse that existed before this was tracked last changed, as far as anyone can tell, when it was created.
UPDATE "Timelapse" SET "updatedAt" = "createdAt";

-- CreateTable
CREATE TABLE "TimelapseDeletion" (
    "timelapseId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelapseDeletion_pkey" PRIMARY KEY ("timelapseId")
);

-- CreateIndex
CREATE INDEX "Timelapse_updatedAt_id_idx" ON "Timelapse"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "TimelapseDeletion_deletedAt_timelapseId_idx" ON "TimelapseDeletion"("deletedAt", "timelapseId");
