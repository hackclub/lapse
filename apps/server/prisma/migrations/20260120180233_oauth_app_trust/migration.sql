/*
  Warnings:

  - Added the required column `createdByUserId` to the `ServiceClient` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ServiceClientTrustLevel" AS ENUM ('UNTRUSTED', 'TRUSTED');

-- AlterTable
ALTER TABLE "ServiceClient" ADD COLUMN     "createdByUserId" TEXT NOT NULL,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "homepageUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "iconUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "trustLevel" "ServiceClientTrustLevel" NOT NULL DEFAULT 'UNTRUSTED';

-- CreateTable
CREATE TABLE "ServiceClientReview" (
    "id" TEXT NOT NULL,
    "serviceClientId" TEXT NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "status" "ServiceClientTrustLevel" NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceClientReview_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ServiceClient" ADD CONSTRAINT "ServiceClient_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceClientReview" ADD CONSTRAINT "ServiceClientReview_serviceClientId_fkey" FOREIGN KEY ("serviceClientId") REFERENCES "ServiceClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceClientReview" ADD CONSTRAINT "ServiceClientReview_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
