-- L05 (#81): вопросы к архиву писем (RAG). Куски текста письма с векторами pgvector.
--
-- Расширение vector ставится один раз на всю базу. Если его ещё нет, оно ставится в схему public
-- (не в схему миграции: тесты создают и удаляют свои схемы, расширение не должно исчезать вместе с ними).
-- Если оно уже включено в другой схеме (Supabase: обычно extensions), используется та схема.
-- Supabase: Dashboard → Database → Extensions → vector (docs/deploy.md, раздел «Supabase»).
DO $$
DECLARE
  nsp TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE EXTENSION vector SCHEMA public;
  END IF;
  SELECT n.nspname INTO nsp
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname = 'vector';

  EXECUTE format(
    'CREATE TABLE "LetterChunk" (
        "id" TEXT NOT NULL,
        "cabinetId" TEXT NOT NULL,
        "letterId" TEXT NOT NULL,
        "n" INTEGER NOT NULL,
        "text" TEXT NOT NULL,
        "textHash" TEXT NOT NULL,
        "embedding" %I.vector(768) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "LetterChunk_pkey" PRIMARY KEY ("id")
    )',
    nsp
  );
END $$;

CREATE UNIQUE INDEX "LetterChunk_letterId_n_key" ON "LetterChunk"("letterId", "n");

CREATE INDEX "LetterChunk_cabinetId_idx" ON "LetterChunk"("cabinetId");

ALTER TABLE "LetterChunk" ADD CONSTRAINT "LetterChunk_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LetterChunk" ADD CONSTRAINT "LetterChunk_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "Letter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
