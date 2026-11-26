-- E01 (#163): шифрование писем в браузере.
-- Ключи: KeyVault (мастер-ключ под секретом восстановления), DocumentKey (ключи документов под мастер-ключом).
-- Поиск по архиву: LetterSummary (зашифрованное обезличенное резюме + открытый вектор) вместо LetterChunk.
-- LetterChunk удаляется вместе с данными: в нём лежали открытые куски текста писем.

-- Ключи
CREATE TABLE "KeyVault" (
    "cabinetId" TEXT NOT NULL,
    "wrappedMaster" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KeyVault_pkey" PRIMARY KEY ("cabinetId")
);
ALTER TABLE "KeyVault" ADD CONSTRAINT "KeyVault_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DocumentKey" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "wrapped" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentKey_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DocumentKey_cabinetId_idx" ON "DocumentKey"("cabinetId");
ALTER TABLE "DocumentKey" ADD CONSTRAINT "DocumentKey_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Документы
ALTER TABLE "Letter" ADD COLUMN "keyId" TEXT;
ALTER TABLE "Case" ADD COLUMN "keyId" TEXT;

-- «Срок без точной даты»: раньше узнавали по началу text, теперь text зашифрован
ALTER TABLE "Claim" ADD COLUMN "relative" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Claim" SET "relative" = true WHERE "kind" = 'OTHER' AND "text" LIKE 'Срок без точной даты%';

-- Поиск по архиву: вектор обезличенного резюме
DROP TABLE "LetterChunk";

DO $$
DECLARE
  nsp TEXT;
BEGIN
  SELECT n.nspname INTO nsp
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname = 'vector';

  EXECUTE format(
    'CREATE TABLE "LetterSummary" (
        "letterId" TEXT NOT NULL,
        "cabinetId" TEXT NOT NULL,
        "summary" TEXT NOT NULL,
        "embedderId" TEXT NOT NULL,
        "embedding" %I.vector(768) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "LetterSummary_pkey" PRIMARY KEY ("letterId")
    )',
    nsp
  );
END $$;

CREATE INDEX "LetterSummary_cabinetId_idx" ON "LetterSummary"("cabinetId");
ALTER TABLE "LetterSummary" ADD CONSTRAINT "LetterSummary_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "Letter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LetterSummary" ADD CONSTRAINT "LetterSummary_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
