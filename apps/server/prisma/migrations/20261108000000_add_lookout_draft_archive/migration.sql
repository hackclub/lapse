-- AlterTable
ALTER TABLE "DraftLookoutTimelapse" ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "archivedReason" TEXT;

-- CreateTable
CREATE TABLE "LookoutDraftEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "draftId" TEXT NOT NULL,
    "lookoutSessionId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "actor" TEXT,
    "timelapseId" TEXT,
    "detail" JSONB,

    CONSTRAINT "LookoutDraftEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LookoutDraftEvent_lookoutSessionId_idx" ON "LookoutDraftEvent"("lookoutSessionId");

-- CreateIndex
CREATE INDEX "LookoutDraftEvent_ownerId_idx" ON "LookoutDraftEvent"("ownerId");

-- CreateIndex
CREATE INDEX "LookoutDraftEvent_draftId_idx" ON "LookoutDraftEvent"("draftId");
