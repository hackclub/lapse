-- CreateTable
CREATE TABLE "ServiceClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "redirectUris" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ServiceClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceTokenAudit" (
    "id" TEXT NOT NULL,
    "serviceClientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceTokenAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceGrant" (
    "id" TEXT NOT NULL,
    "serviceClientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ServiceGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceClient_clientId_key" ON "ServiceClient"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceGrant_serviceClientId_userId_key" ON "ServiceGrant"("serviceClientId", "userId");

-- AddForeignKey
ALTER TABLE "ServiceTokenAudit" ADD CONSTRAINT "ServiceTokenAudit_serviceClientId_fkey" FOREIGN KEY ("serviceClientId") REFERENCES "ServiceClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceTokenAudit" ADD CONSTRAINT "ServiceTokenAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceGrant" ADD CONSTRAINT "ServiceGrant_serviceClientId_fkey" FOREIGN KEY ("serviceClientId") REFERENCES "ServiceClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceGrant" ADD CONSTRAINT "ServiceGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
