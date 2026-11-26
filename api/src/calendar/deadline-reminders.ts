import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { berlinToday, toIsoDate } from '../common/berlin-date.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';
import { toLanguage } from '../common/language.js';
import { deadlineLink, deadlineSummary, plainOrNull } from '../deadlines/deadline-text.js';
import { StorageService } from '../documents/storage.service.js';
import { lockActiveCabinet } from '../erasure/cabinet-lock.js';
import { MailTransport, mailErrorCode } from '../mail/mail-transport.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ACTIVE_DEADLINE, DEADLINE_FOR_TEXT } from './calendar.service.js';
import { reminderMail } from './reminder-mail.template.js';

/** Проход раз в 15 минут. Первый проход не сразу после старта: тестам не мешает. */
const TICK_MS = 15 * 60 * 1000;
/** Письма уходят только днём по берлинскому времени. */
const SEND_FROM_HOUR = 8;
const SEND_UNTIL_HOUR = 21;
/** Кандидаты: сроки на ближайшие 14 дней (remindDaysBefore по умолчанию 3). */
const LOOKAHEAD_DAYS = 14;
const BATCH = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

export function berlinHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
}

export interface ReminderRunResult {
  sent: number;
  failed: number;
}

/*
 * K12: напоминание по e-mail за remindDaysBefore (3) дня до срока.
 * Одно письмо на срок: reminderSentAt ставится до отправки условным UPDATE, второй обработчик
 * этот срок уже не возьмёт. Выполненный срок, неподтверждённый факт, закрытое дело,
 * выключенные напоминания и удаляемый аккаунт письма не получают.
 * file: письмо .eml в папке кабинета (как письма сброса пароля), под блокировкой кабинета.
 * smtp: отправка после отметки; при ошибке отметка снимается, следующий проход попробует снова.
 */
@Injectable()
export class DeadlineReminders implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Reminders');
  private timer?: NodeJS.Timeout;
  private running: Promise<unknown> = Promise.resolve();
  /** Часы можно подменить в тестах. */
  now: () => Date = () => new Date();

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(MailTransport) private readonly transport: MailTransport,
    @Inject(APP_CONFIG) private readonly config: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.REMINDERS_ENABLED) return;
    this.timer = setInterval(() => this.kick(), TICK_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  kick(): void {
    this.running = this.running.then(() =>
      this.runDue().catch((e: unknown) =>
        this.logger.error(`проход напоминаний не удался: ${mailErrorCode(e)}`),
      ),
    );
  }

  /** Один проход. ignoreHours: для тестов и ручной проверки. */
  async runDue(options?: { ignoreHours?: boolean }): Promise<ReminderRunResult> {
    const now = this.now();
    const result = { sent: 0, failed: 0 };
    const hour = berlinHour(now);
    if (!options?.ignoreHours && (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR))
      return result;
    const today = berlinToday(now);
    const until = new Date(today.getTime() + LOOKAHEAD_DAYS * DAY_MS);
    const rows = await this.db.deadline.findMany({
      where: {
        ...ACTIVE_DEADLINE,
        reminderSentAt: null,
        date: { gte: today, lte: until },
        letter: { cabinet: { reminderEmail: true, deletingAt: null } },
      },
      include: {
        ...DEADLINE_FOR_TEXT,
        letter: {
          select: {
            ...DEADLINE_FOR_TEXT.letter.select,
            cabinet: { select: { email: true, language: true } },
          },
        },
      },
      orderBy: { date: 'asc' },
      take: BATCH,
    });
    for (const d of rows) {
      const daysLeft = Math.round((d.date.getTime() - today.getTime()) / DAY_MS);
      if (daysLeft > d.remindDaysBefore) continue;
      const message = reminderMail({
        to: d.letter.cabinet.email,
        appUrl: this.config.APP_PUBLIC_URL,
        date: toIsoDate(d.date),
        daysLeft,
        summary: deadlineSummary(d.kind, d.letter.claims[0]?.value, toLanguage(d.letter.cabinet.language)),
        lang: toLanguage(d.letter.cabinet.language),
        caseTitle: plainOrNull(d.case?.title),
        link: deadlineLink(this.config.APP_PUBLIC_URL, d),
      });
      const ok = await this.send(d.id, d.letter.cabinetId, message, now);
      if (ok === true) result.sent++;
      else if (ok === false) result.failed++;
    }
    return result;
  }

  /** true: отправлено; false: ошибка отправки; null: срок уже взят или аккаунт удаляется. */
  private async send(
    deadlineId: string,
    cabinetId: string,
    message: ReturnType<typeof reminderMail>,
    now: Date,
  ): Promise<boolean | null> {
    if (this.transport.mode === 'file') {
      return this.db.$transaction(async (tx) => {
        if (!(await lockActiveCabinet(tx, cabinetId))) return null;
        const { count } = await tx.deadline.updateMany({
          where: { id: deadlineId, reminderSentAt: null },
          data: { reminderSentAt: now },
        });
        if (count !== 1) return null;
        await this.storage.writeMail(
          cabinetId,
          `reminder-${deadlineId}`,
          await this.transport.compose(message),
        );
        return true;
      });
    }
    const { count } = await this.db.deadline.updateMany({
      where: { id: deadlineId, reminderSentAt: null },
      data: { reminderSentAt: now },
    });
    if (count !== 1) return null;
    try {
      await this.transport.sendSmtp(message);
      return true;
    } catch (e) {
      this.logger.error(`напоминание не отправлено: ${mailErrorCode(e)}`);
      await this.db.deadline.updateMany({
        where: { id: deadlineId, reminderSentAt: now },
        data: { reminderSentAt: null },
      });
      return false;
    }
  }
}
