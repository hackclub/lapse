-- CreateTable
CREATE TABLE "ExperimentAssignment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "experiment" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ExperimentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExperimentAssignment_experiment_idx" ON "ExperimentAssignment"("experiment");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentAssignment_userId_experiment_key" ON "ExperimentAssignment"("userId", "experiment");

-- AddForeignKey
ALTER TABLE "ExperimentAssignment" ADD CONSTRAINT "ExperimentAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
