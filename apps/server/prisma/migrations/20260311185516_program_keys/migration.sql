-- CreateTable
CREATE TABLE "ProgramKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramKeyAudit" (
    "id" TEXT NOT NULL,
    "programKeyId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "endpoint" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramKeyAudit_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ProgramKey" ADD CONSTRAINT "ProgramKey_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramKeyAudit" ADD CONSTRAINT "ProgramKeyAudit_programKeyId_fkey" FOREIGN KEY ("programKeyId") REFERENCES "ProgramKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
