-- CreateTable
CREATE TABLE "PrivacyTokenUse" (
    "jti" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyTokenUse_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "PrivacyTokenUse_usedAt_idx" ON "PrivacyTokenUse"("usedAt");
