/*
  Warnings:

  - Added the required column `iv` to the `DraftTimelapse` table without a default value. This is not possible if the table is not empty.

*/
-- Delete all existing draft timelapses
DELETE FROM "DraftTimelapse";

-- AlterTable
ALTER TABLE "DraftTimelapse" ADD COLUMN     "iv" TEXT NOT NULL;
