-- CreateEnum
CREATE TYPE "ErasureStatus" AS ENUM ('PREPARING', 'FILES_MOVED', 'DB_DELETED', 'RESTORING');

-- AlterTable
ALTER TABLE "Cabinet" ADD COLUMN     "deletingAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AccountErasure" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "status" "ErasureStatus" NOT NULL DEFAULT 'PREPARING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountErasure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountErasure_cabinetId_key" ON "AccountErasure"("cabinetId");
