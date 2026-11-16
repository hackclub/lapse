-- CreateIndex
CREATE INDEX "Timelapse_createdAt_idx" ON "Timelapse"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "Timelapse_ownerId_createdAt_idx" ON "Timelapse"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Comment_timelapseId_idx" ON "Comment"("timelapseId");

-- CreateIndex
CREATE INDEX "User_hackatimeId_idx" ON "User"("hackatimeId");

-- CreateIndex
CREATE INDEX "User_slackId_idx" ON "User"("slackId");

-- CreateIndex
CREATE INDEX "KnownDevice_ownerId_idx" ON "KnownDevice"("ownerId");

-- CreateIndex
CREATE INDEX "DraftTimelapse_ownerId_idx" ON "DraftTimelapse"("ownerId");

-- CreateIndex
CREATE INDEX "DraftTimelapse_deviceId_idx" ON "DraftTimelapse"("deviceId");

-- CreateIndex
CREATE INDEX "DraftLookoutTimelapse_ownerId_idx" ON "DraftLookoutTimelapse"("ownerId");

-- CreateIndex
CREATE INDEX "DraftLookoutTimelapse_pendingAt_idx" ON "DraftLookoutTimelapse"("pendingAt");
