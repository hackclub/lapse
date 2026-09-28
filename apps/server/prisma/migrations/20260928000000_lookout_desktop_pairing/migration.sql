-- CreateTable
CREATE TABLE "LookoutDesktopDevice" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "LookoutDesktopDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LookoutPairingCode" (
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "challenge" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "LookoutPairingCode_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "LookoutDesktopDevice_tokenHash_key" ON "LookoutDesktopDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "LookoutDesktopDevice_ownerId_idx" ON "LookoutDesktopDevice"("ownerId");

-- CreateIndex
CREATE INDEX "LookoutPairingCode_expiresAt_idx" ON "LookoutPairingCode"("expiresAt");

-- AddForeignKey
ALTER TABLE "LookoutDesktopDevice" ADD CONSTRAINT "LookoutDesktopDevice_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookoutPairingCode" ADD CONSTRAINT "LookoutPairingCode_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
