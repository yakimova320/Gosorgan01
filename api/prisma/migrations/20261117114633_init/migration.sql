-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CaseOrigin" AS ENUM ('INCOMING', 'OUTGOING');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('PDF_TEXT', 'IMAGE');

-- CreateEnum
CREATE TYPE "ClaimKind" AS ENUM ('AUTHORITY', 'CASE_NUMBER', 'LETTER_DATE', 'REQUIREMENT', 'DEADLINE', 'AMOUNT', 'OTHER');

-- CreateEnum
CREATE TYPE "ClaimBasis" AS ENUM ('DOCUMENT', 'USER');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('UNCONFIRMED', 'CONFIRMED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DeadlineKind" AS ENUM ('REPLY', 'DOCUMENTS', 'OBJECTION', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "MessageKind" AS ENUM ('QUESTION', 'STATEMENT', 'ANSWER');

-- CreateEnum
CREATE TYPE "DraftKind" AS ENUM ('CLARIFICATION', 'DOCUMENTS', 'EXTENSION', 'STATUS_REQUEST', 'TEMPLATE', 'FREE');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('PREPARED', 'SENT');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('LETTER_RECEIVED', 'CASE_CREATED_FROM_LETTER', 'CLAIM_CONFIRMED', 'CLAIM_REJECTED', 'QUESTION_ASKED', 'USER_REPORTED_SENT', 'DRAFT_PREPARED', 'DRAFT_SENT', 'DEADLINE_DONE', 'REVISION');

-- CreateTable
CREATE TABLE "Cabinet" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordChangedAt" TIMESTAMP(3),
    "language" TEXT NOT NULL DEFAULT 'ru',
    "profile" JSONB,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cabinet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authority" TEXT,
    "caseNumber" TEXT,
    "status" "CaseStatus" NOT NULL DEFAULT 'OPEN',
    "origin" "CaseOrigin" NOT NULL DEFAULT 'INCOMING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Letter" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "caseId" TEXT,
    "sourceType" "SourceType" NOT NULL,
    "rawText" TEXT NOT NULL,
    "pages" JSONB NOT NULL,
    "files" JSONB NOT NULL,
    "explanation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Letter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "letterId" TEXT,
    "caseId" TEXT,
    "kind" "ClaimKind" NOT NULL,
    "value" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "quote" TEXT,
    "page" INTEGER,
    "basis" "ClaimBasis" NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'UNCONFIRMED',
    "reason" TEXT,
    "supersedesId" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deadline" (
    "id" TEXT NOT NULL,
    "letterId" TEXT NOT NULL,
    "caseId" TEXT,
    "claimId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "kind" "DeadlineKind" NOT NULL,
    "doneAt" TIMESTAMP(3),
    "remindDaysBefore" INTEGER NOT NULL DEFAULT 3,

    CONSTRAINT "Deadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "details" JSONB NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "kind" "MessageKind" NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" "DraftKind" NOT NULL,
    "templateId" TEXT,
    "germanText" TEXT NOT NULL,
    "russianText" TEXT NOT NULL,
    "claimIds" JSONB NOT NULL,
    "claimSnapshot" JSONB NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "verification" JSONB NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'PREPARED',
    "sentAt" TIMESTAMP(3),
    "sentVia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT,
    "letterId" TEXT,
    "caseId" TEXT,
    "promptName" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "output" TEXT,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "attempts" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cabinet_email_key" ON "Cabinet"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_cabinetId_idx" ON "Session"("cabinetId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_cabinetId_idx" ON "PasswordResetToken"("cabinetId");

-- CreateIndex
CREATE INDEX "Case_cabinetId_idx" ON "Case"("cabinetId");

-- CreateIndex
CREATE INDEX "Letter_cabinetId_idx" ON "Letter"("cabinetId");

-- CreateIndex
CREATE INDEX "Letter_caseId_idx" ON "Letter"("caseId");

-- CreateIndex
CREATE INDEX "Claim_letterId_idx" ON "Claim"("letterId");

-- CreateIndex
CREATE INDEX "Claim_caseId_idx" ON "Claim"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "Deadline_claimId_key" ON "Deadline"("claimId");

-- CreateIndex
CREATE INDEX "Deadline_letterId_idx" ON "Deadline"("letterId");

-- CreateIndex
CREATE INDEX "Deadline_caseId_idx" ON "Deadline"("caseId");

-- CreateIndex
CREATE INDEX "Event_caseId_idx" ON "Event"("caseId");

-- CreateIndex
CREATE INDEX "Message_caseId_idx" ON "Message"("caseId");

-- CreateIndex
CREATE INDEX "Draft_caseId_idx" ON "Draft"("caseId");

-- CreateIndex
CREATE INDEX "LlmCall_cabinetId_idx" ON "LlmCall"("cabinetId");

-- CreateIndex
CREATE INDEX "LlmCall_letterId_idx" ON "LlmCall"("letterId");

-- CreateIndex
CREATE INDEX "LlmCall_caseId_idx" ON "LlmCall"("caseId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Letter" ADD CONSTRAINT "Letter_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "Letter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Claim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "Letter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deadline" ADD CONSTRAINT "Deadline_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
