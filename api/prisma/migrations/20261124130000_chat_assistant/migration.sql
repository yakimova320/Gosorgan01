-- Чат-помощник (24.11): свободный разговор с Ja!sno, отдельный лимит операций CHAT.
ALTER TYPE "LlmOperationKind" ADD VALUE 'CHAT';

CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT');

CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatMessage_cabinetId_createdAt_idx" ON "ChatMessage"("cabinetId", "createdAt");

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
