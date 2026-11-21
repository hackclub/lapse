-- CreateEnum
CREATE TYPE "RecordingClient" AS ENUM ('BROWSER', 'DESKTOP', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Timelapse" ADD COLUMN "recordedWith" "RecordingClient";

-- The pre-Lookout recorder only ran in the browser. Lookout timelapses are filled in by `backfillRecordingClients`.
UPDATE "Timelapse" SET "recordedWith" = 'BROWSER' WHERE "lookoutSessionId" IS NULL;

-- CreateIndex
CREATE INDEX "Timelapse_recordedWith_idx" ON "Timelapse"("recordedWith");
