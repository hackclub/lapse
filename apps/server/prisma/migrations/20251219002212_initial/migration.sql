-- CreateEnum
CREATE TYPE "PermissionLevel" AS ENUM ('USER', 'ADMIN', 'ROOT');

-- CreateEnum
CREATE TYPE "TimelapseVisibility" AS ENUM ('UNLISTED', 'PUBLIC');

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
    "profilePictureUrl" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hackatimeApiKey" TEXT,
    "slackId" TEXT,
    "lastHeartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftTimelapse" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT NOT NULL,
    "videoTokenId" TEXT NOT NULL,
    "thumbnailTokenId" TEXT NOT NULL,

    CONSTRAINT "DraftTimelapse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadToken" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploaded" BOOLEAN NOT NULL DEFAULT false,
    "expires" TIMESTAMP(3) NOT NULL,
    "maxSize" INTEGER NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "UploadToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timelapse" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "s3Key" TEXT NOT NULL,
    "thumbnailS3Key" TEXT,
    "hackatimeProject" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "visibility" "TimelapseVisibility" NOT NULL DEFAULT 'UNLISTED',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "containerKind" "VideoContainerKind" NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "ownerId" TEXT NOT NULL,
    "deviceId" TEXT,

    CONSTRAINT "Timelapse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "timelapseId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL,
    "frame" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "heartbeatId" INTEGER NOT NULL DEFAULT 0,
    "timelapseId" TEXT NOT NULL,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "DraftTimelapse_videoTokenId_key" ON "DraftTimelapse"("videoTokenId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftTimelapse_thumbnailTokenId_key" ON "DraftTimelapse"("thumbnailTokenId");

-- AddForeignKey
ALTER TABLE "KnownDevice" ADD CONSTRAINT "KnownDevice_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftTimelapse" ADD CONSTRAINT "DraftTimelapse_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftTimelapse" ADD CONSTRAINT "DraftTimelapse_videoTokenId_fkey" FOREIGN KEY ("videoTokenId") REFERENCES "UploadToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftTimelapse" ADD CONSTRAINT "DraftTimelapse_thumbnailTokenId_fkey" FOREIGN KEY ("thumbnailTokenId") REFERENCES "UploadToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadToken" ADD CONSTRAINT "UploadToken_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timelapse" ADD CONSTRAINT "Timelapse_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timelapse" ADD CONSTRAINT "Timelapse_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "KnownDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_timelapseId_fkey" FOREIGN KEY ("timelapseId") REFERENCES "Timelapse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_timelapseId_fkey" FOREIGN KEY ("timelapseId") REFERENCES "Timelapse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
