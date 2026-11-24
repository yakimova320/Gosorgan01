-- K12: подписка на календарь сроков и напоминание по e-mail за 3 дня до срока.
ALTER TABLE "Cabinet" ADD COLUMN "calendarToken" TEXT;
ALTER TABLE "Cabinet" ADD COLUMN "reminderEmail" BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX "Cabinet_calendarToken_key" ON "Cabinet"("calendarToken");

ALTER TABLE "Deadline" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
