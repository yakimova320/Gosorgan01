-- CreateEnum
CREATE TYPE "ResetMailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PasswordResetMail" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "status" "ResetMailStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "tokenId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PasswordResetMail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PasswordResetMail_cabinetId_createdAt_idx" ON "PasswordResetMail"("cabinetId", "createdAt");

-- CreateIndex
CREATE INDEX "PasswordResetMail_status_nextAttemptAt_idx" ON "PasswordResetMail"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "PasswordResetMail" ADD CONSTRAINT "PasswordResetMail_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
