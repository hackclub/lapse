/*
  Warnings:

  - Added the required column `iv` to the `DraftTimelapse` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "DraftTimelapse" ADD COLUMN     "iv" TEXT NOT NULL;
