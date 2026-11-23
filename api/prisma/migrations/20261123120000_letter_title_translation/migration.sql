-- Поправки 7 и 8 (23.11): машинный перевод письма на русский и название письма.
ALTER TYPE "LlmOperationKind" ADD VALUE 'TRANSLATE';

ALTER TABLE "Letter" ADD COLUMN "title" TEXT,
ADD COLUMN "translation" JSONB;
