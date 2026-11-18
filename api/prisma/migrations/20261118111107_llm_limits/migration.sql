-- CreateEnum
CREATE TYPE "LlmOperationKind" AS ENUM ('UPLOAD', 'EXPLAIN', 'OTHER');

-- AlterTable
ALTER TABLE "LlmCall" ADD COLUMN     "operationId" TEXT;

-- CreateTable
CREATE TABLE "LlmOperation" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "kind" "LlmOperationKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmUsageHour" (
    "hour" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "failedCalls" INTEGER NOT NULL DEFAULT 0,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "callsWithoutUsage" INTEGER NOT NULL DEFAULT 0,
    "estimatedTokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LlmUsageHour_pkey" PRIMARY KEY ("hour","provider")
);

-- CreateIndex
CREATE INDEX "LlmOperation_cabinetId_createdAt_idx" ON "LlmOperation"("cabinetId", "createdAt");

-- AddForeignKey
ALTER TABLE "LlmOperation" ADD CONSTRAINT "LlmOperation_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
