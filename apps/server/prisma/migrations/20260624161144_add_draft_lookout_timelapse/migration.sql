-- CreateTable
CREATE TABLE "DraftLookoutTimelapse" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lookoutSessionId" TEXT NOT NULL,
    "lookoutToken" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "DraftLookoutTimelapse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DraftLookoutTimelapse_lookoutSessionId_key" ON "DraftLookoutTimelapse"("lookoutSessionId");

-- AddForeignKey
ALTER TABLE "DraftLookoutTimelapse" ADD CONSTRAINT "DraftLookoutTimelapse_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
