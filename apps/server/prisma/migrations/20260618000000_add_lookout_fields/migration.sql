-- AlterTable
ALTER TABLE "Timelapse" ADD COLUMN "lookoutSessionId" TEXT,
ADD COLUMN "lookoutToken" TEXT,
ADD COLUMN "lookoutVideoUrl" TEXT,
ADD COLUMN "lookoutThumbnailUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Timelapse_lookoutSessionId_key" ON "Timelapse"("lookoutSessionId");
