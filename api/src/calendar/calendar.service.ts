import { Inject, Injectable } from '@nestjs/common';
import { newToken } from '../auth/session-token.js';
import { ApiError } from '../common/api-error.js';
import { berlinToday, toIsoDate } from '../common/berlin-date.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';
import {
  calendarName,
  caseLine,
  plainOrNull,
  deadlineCheckNote,
  deadlineLink,
  deadlineSummary,
} from '../deadlines/deadline-text.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildFeed } from './calendar-feed.js';
import { toLanguage } from '../common/language.js';

export interface CalendarView {
  /** /calendar/<токен>.ics или null, если подписки нет */
  feedPath: string | null;
  reminderEmail: boolean;
}

/** Токен из newToken(): 32 байта в base64url = 43 знака. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/** Прошедшие сроки остаются в ленте ещё столько дней. */
const PAST_DAYS = 60;
const MAX_EVENTS = 500;

/**
 * Действующий срок: факт подтверждён, срок не выполнен, дело не закрыто (или письмо во входящих).
 * То же условие у напоминаний (DeadlineReminders).
 */
export const ACTIVE_DEADLINE: Prisma.DeadlineWhereInput = {
  doneAt: null,
  claim: { status: 'CONFIRMED' },
  OR: [{ caseId: null }, { case: { status: 'OPEN' } }],
};

/** Что нужно о сроке для ленты и для письма. */
export const DEADLINE_FOR_TEXT = {
  case: { select: { title: true } },
  letter: {
    select: {
      cabinetId: true,
      claims: {
        where: { kind: 'AUTHORITY', status: 'CONFIRMED' },
        select: { value: true },
        take: 1,
      },
    },
  },
} satisfies Prisma.DeadlineInclude;

/*
 * K12: подписка на календарь сроков.
 * Адрес содержит секретный токен: кто знает адрес, видит даты и названия дел, но не тексты писем.
 * Сброс выдаёт новый токен, старый адрес сразу даёт 404. Удаление аккаунта удаляет токен вместе с кабинетом.
 */
@Injectable()
export class CalendarService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(APP_CONFIG) private readonly config: Env,
  ) {}

  private toView(c: { calendarToken: string | null; reminderEmail: boolean }): CalendarView {
    return {
      feedPath: c.calendarToken ? `/calendar/${c.calendarToken}.ics` : null,
      reminderEmail: c.reminderEmail,
    };
  }

  async view(cabinetId: string): Promise<CalendarView> {
    const c = await this.db.cabinet.findUniqueOrThrow({
      where: { id: cabinetId },
      select: { calendarToken: true, reminderEmail: true },
    });
    return this.toView(c);
  }

  /** Создать ссылку или заменить старую на новую. */
  async resetToken(cabinetId: string): Promise<CalendarView> {
    const c = await this.db.cabinet.update({
      where: { id: cabinetId },
      data: { calendarToken: newToken() },
      select: { calendarToken: true, reminderEmail: true },
    });
    return this.toView(c);
  }

  async removeToken(cabinetId: string): Promise<CalendarView> {
    const c = await this.db.cabinet.update({
      where: { id: cabinetId },
      data: { calendarToken: null },
      select: { calendarToken: true, reminderEmail: true },
    });
    return this.toView(c);
  }

  async setReminderEmail(cabinetId: string, on: boolean): Promise<CalendarView> {
    const c = await this.db.cabinet.update({
      where: { id: cabinetId },
      data: { reminderEmail: on },
      select: { calendarToken: true, reminderEmail: true },
    });
    return this.toView(c);
  }

  /** Лента .ics по токену. Неизвестный, сброшенный или кривой токен: 404. */
  async feed(token: string, now: Date = new Date()): Promise<string> {
    if (!TOKEN_RE.test(token)) throw new ApiError('NOT_FOUND');
    const cabinet = await this.db.cabinet.findFirst({
      where: { calendarToken: token, deletingAt: null },
      select: { id: true, language: true },
    });
    if (!cabinet) throw new ApiError('NOT_FOUND');
    const lang = toLanguage(cabinet.language);
    const from = berlinToday(now);
    from.setUTCDate(from.getUTCDate() - PAST_DAYS);
    const rows = await this.db.deadline.findMany({
      where: { ...ACTIVE_DEADLINE, letter: { cabinetId: cabinet.id }, date: { gte: from } },
      include: DEADLINE_FOR_TEXT,
      orderBy: { date: 'asc' },
      take: MAX_EVENTS,
    });
    return buildFeed(
      rows.map((d) => ({
        id: d.id,
        date: toIsoDate(d.date),
        summary: deadlineSummary(d.kind, d.letter.claims[0]?.value, lang),
        description: [plainOrNull(d.case?.title) ? caseLine(plainOrNull(d.case?.title)!, lang) : null, deadlineCheckNote(lang)]
          .filter(Boolean)
          .join('\n'),
        url: deadlineLink(this.config.APP_PUBLIC_URL, d),
        remindDaysBefore: d.remindDaysBefore,
      })),
      now,
      calendarName(lang),
    );
  }
}
