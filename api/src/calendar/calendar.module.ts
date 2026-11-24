import { Module } from '@nestjs/common';
import { LettersModule } from '../letters/letters.module.js';
import { MailModule } from '../mail/mail.module.js';
import { CalendarFeedController, CalendarSettingsController } from './calendar.controller.js';
import { CalendarService } from './calendar.service.js';
import { DeadlineReminders } from './deadline-reminders.js';

/*
 * K12: подписка на календарь сроков и напоминание по e-mail.
 * Удаление аккаунта: токен удаляется вместе со строкой кабинета, файлы напоминаний лежат
 * в папке писем кабинета и удаляются очисткой reset-mail (MailModule).
 */
@Module({
  imports: [LettersModule, MailModule],
  controllers: [CalendarSettingsController, CalendarFeedController],
  providers: [CalendarService, DeadlineReminders],
  exports: [DeadlineReminders],
})
export class CalendarModule {}
