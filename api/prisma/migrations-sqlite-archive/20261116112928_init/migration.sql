-- CreateTable
CREATE TABLE "Cabinet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordChangedAt" DATETIME,
    "language" TEXT NOT NULL DEFAULT 'ru',
    "profile" JSONB,
    "consentAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cabinetId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cabinetId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cabinetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authority" TEXT,
    "caseNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "origin" TEXT NOT NULL DEFAULT 'INCOMING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Case_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Letter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cabinetId" TEXT NOT NULL,
    "caseId" TEXT,
    "sourceType" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "pages" JSONB NOT NULL,
    "files" JSONB NOT NULL,
    "explanation" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Letter_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Letter_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "letterId" TEXT,
    "caseId" TEXT,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "quote" TEXT,
    "page" INTEGER,
    "basis" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNCONFIRMED',
    "reason" TEXT,
    "supersedesId" TEXT,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Claim_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "Letter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Claim_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Claim_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Claim" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Deadline" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "letterId" TEXT NOT NULL,
    "caseId" TEXT,
    "claimId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "kind" TEXT NOT NULL,
    "doneAt" DATETIME,
    "remindDaysBefore" INTEGER NOT NULL DEFAULT 3,
    CONSTRAINT "Deadline_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "Letter" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deadline_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deadline_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "details" JSONB NOT NULL,
    CONSTRAINT "Event_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "templateId" TEXT,
    "germanText" TEXT NOT NULL,
    "russianText" TEXT NOT NULL,
    "claimIds" JSONB NOT NULL,
    "claimSnapshot" JSONB NOT NULL,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "verification" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "sentAt" DATETIME,
    "sentVia" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Draft_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
