import { describe, expect, it } from 'vitest';
import { buildFeed } from './calendar-feed.js';
import { daysLeftText, germanDate, reminderMail } from './reminder-mail.template.js';
import { berlinHour } from './deadline-reminders.js';

const now = new Date('2026-11-25T10:00:00.000Z');

describe('buildFeed (K12)', () => {
  it('пустая лента: только календарь', () => {
    const ics = buildFeed([], now);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(ics).toContain('X-WR-CALNAME:Ja!sno — сроки');
  });

  it('два срока: постоянный UID, весь день, напоминание за 3 дня, ссылка', () => {
    const ics = buildFeed(
      [
        {
          id: 'dl1',
          date: '2026-12-01',
          summary: 'Срок: ответить — Jobcenter',
          description: 'Дело: Jobcenter, документы',
          url: 'http://localhost:5173/app/cases/c1',
          remindDaysBefore: 3,
        },
        {
          id: 'dl2',
          date: '2026-12-31',
          summary: 'Срок: прислать документы',
          description: 'Проверьте дату',
          url: 'http://localhost:5173/app/letters/l2',
          remindDaysBefore: 0,
        },
      ],
      now,
    );
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('UID:dl1@jasno');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261201');
    expect(ics).toContain('DTEND;VALUE=DATE:20261202');
    expect(ics).toContain('DTEND;VALUE=DATE:20270101');
    expect(ics).toContain('TRIGGER:-P3D');
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(1);
    expect(ics).toContain('URL:http://localhost:5173/app/cases/c1');
    const flat = ics.replace(/\r\n /g, ''); // строки после переноса склеиваются обратно
    expect(flat).toContain('Дело: Jobcenter\\, документы');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
  });
});

describe('письмо-напоминание (K12)', () => {
  it('склонение дней', () => {
    expect(daysLeftText(0)).toBe('сегодня');
    expect(daysLeftText(1)).toBe('завтра');
    expect(daysLeftText(3)).toBe('через 3 дня');
    expect(daysLeftText(5)).toBe('через 5 дней');
    expect(daysLeftText(11)).toBe('через 11 дней');
    expect(daysLeftText(21)).toBe('через 21 день');
    expect(germanDate('2026-12-01')).toBe('01.12.2026');
  });

  it('текст без лишнего: вид срока, дело, дата, ссылки', () => {
    const m = reminderMail({
      to: 'a@example.org',
      appUrl: 'http://localhost:5173/',
      date: '2026-12-01',
      daysLeft: 3,
      summary: 'Срок: ответить — Jobcenter',
      caseTitle: 'Jobcenter, документы',
      link: 'http://localhost:5173/app/cases/c1',
    });
    expect(m.subject).toBe('Ja!sno: срок через 3 дня (01.12.2026)');
    expect(m.text).toContain('Срок: ответить — Jobcenter');
    expect(m.text).toContain('Дело: Jobcenter, документы');
    expect(m.text).toContain('http://localhost:5173/app/cases/c1');
    expect(m.text).toContain('http://localhost:5173/app/profile');
  });

  it('час по Берлину', () => {
    expect(berlinHour(new Date('2026-11-25T06:30:00.000Z'))).toBe(7);
    expect(berlinHour(new Date('2026-07-01T06:30:00.000Z'))).toBe(8);
  });
});
