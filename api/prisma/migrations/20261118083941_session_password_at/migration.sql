-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "passwordAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- A02: у существующих сессий момент пароля = момент входа, чтобы сессии старше смены пароля остались недействительными
UPDATE "Session" SET "passwordAt" = "createdAt";
