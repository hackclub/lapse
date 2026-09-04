-- Panel token + pending publish intent on Lookout drafts.
--
-- The panel opens as soon as a recording is saved, which is well before Lookout has finished
-- compiling, so the user's answers are held here until there is a video to attach them to.
ALTER TABLE "DraftLookoutTimelapse" ADD COLUMN "panelToken" TEXT;
ALTER TABLE "DraftLookoutTimelapse" ADD COLUMN "pendingName" TEXT;
ALTER TABLE "DraftLookoutTimelapse" ADD COLUMN "pendingDescription" TEXT;
ALTER TABLE "DraftLookoutTimelapse" ADD COLUMN "pendingVisibility" "TimelapseVisibility";
ALTER TABLE "DraftLookoutTimelapse" ADD COLUMN "pendingHackatimeProject" TEXT;
ALTER TABLE "DraftLookoutTimelapse" ADD COLUMN "pendingAt" TIMESTAMP(3);

-- Backfill existing drafts before the column goes NOT NULL. gen_random_uuid() twice gives 256
-- bits of unguessability, which is what this token is standing in for.
UPDATE "DraftLookoutTimelapse"
SET "panelToken" = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE "panelToken" IS NULL;

ALTER TABLE "DraftLookoutTimelapse" ALTER COLUMN "panelToken" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "DraftLookoutTimelapse_panelToken_key" ON "DraftLookoutTimelapse"("panelToken");

-- CreateTable
CREATE TABLE "LookoutDevice" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "LookoutDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LookoutDevice_tokenHash_key" ON "LookoutDevice"("tokenHash");

-- AddForeignKey
ALTER TABLE "LookoutDevice" ADD CONSTRAINT "LookoutDevice_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "LookoutPairingCode" (
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "challenge" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "LookoutPairingCode_pkey" PRIMARY KEY ("code")
);

-- AddForeignKey
ALTER TABLE "LookoutPairingCode" ADD CONSTRAINT "LookoutPairingCode_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
