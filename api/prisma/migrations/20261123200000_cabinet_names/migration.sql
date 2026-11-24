-- Поправка 9 (23.11): имя и фамилия отдельными столбцами, чтобы их было видно в таблице Supabase.
-- Источник правды остаётся profile (JSON); существующие кабинеты заполняются из него.
ALTER TABLE "Cabinet" ADD COLUMN "firstName" TEXT,
ADD COLUMN "lastName" TEXT;

UPDATE "Cabinet"
SET "firstName" = "profile"->>'firstName',
    "lastName" = "profile"->>'lastName'
WHERE "profile" IS NOT NULL;
