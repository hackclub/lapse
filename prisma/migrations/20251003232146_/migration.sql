-- CreateEnum
CREATE TYPE "PermissionLevel" AS ENUM ('USER', 'ADMIN', 'ROOT');

-- CreateEnum
CREATE TYPE "TimelapsePrivacy" AS ENUM ('UNLISTED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "VideoContainerKind" AS ENUM ('WEBM', 'MP4');

-- CreateTable
CREATE TABLE "KnownDevice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "KnownDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "permissionLevel" "PermissionLevel" NOT NULL DEFAULT 'USER',
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hackatimeApiKey" TEXT,
    "slackId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timelapse" (
    "id" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "hackatimeProject" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "privacy" "TimelapsePrivacy" NOT NULL DEFAULT 'UNLISTED',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "containerKind" "VideoContainerKind" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,

    CONSTRAINT "Timelapse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL,
    "frame" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "timelapseId" TEXT NOT NULL,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");

-- AddForeignKey
ALTER TABLE "KnownDevice" ADD CONSTRAINT "KnownDevice_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timelapse" ADD CONSTRAINT "Timelapse_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timelapse" ADD CONSTRAINT "Timelapse_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "KnownDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_timelapseId_fkey" FOREIGN KEY ("timelapseId") REFERENCES "Timelapse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
