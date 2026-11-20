-- K11 (#134): отдельное согласие на анализ письма ИИ. Существующие кабинеты: согласия нет, его спросят перед загрузкой.
ALTER TABLE "Cabinet" ADD COLUMN "aiConsentAt" TIMESTAMP(3),
ADD COLUMN "aiConsentVersion" INTEGER;
