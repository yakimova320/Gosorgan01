import { buildIcs, foldLine, icsText } from './ics.js';

describe('B12: файл календаря .ics', () => {
  const ics = buildIcs({
    id: 'dl1',
    date: '2026-11-30',
    summary: 'Срок: ответить — Jobcenter Musterstadt',
    description: 'Дело: Jobcenter; проверьте дату\nпо оригиналу',
    remindDaysBefore: 3,
    now: new Date('2026-11-20T10:11:12.345Z'),
  });
  const lines = ics.split('\r\n');

  it('событие на весь день срока, напоминание за 3 дня, строки CRLF', () => {
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(lines).toContain('BEGIN:VCALENDAR');
    expect(lines).toContain('UID:dl1@jasno');
    expect(lines).toContain('DTSTAMP:20261120T101112Z');
    expect(lines).toContain('DTSTART;VALUE=DATE:20261130');
    expect(lines).toContain('DTEND;VALUE=DATE:20261201');
    expect(lines).toContain('TRIGGER:-P3D');
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it('экранирование и перенос длинных строк по 75 байт без разрыва символов', () => {
    expect(icsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const long = 'SUMMARY:' + 'ж'.repeat(60);
    const folded = foldLine(long).split('\r\n');
    expect(folded.length).toBeGreaterThan(1);
    for (const part of folded) expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
    expect(folded.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(long);
    expect(lines.some((l) => l.startsWith('DESCRIPTION:Дело: Jobcenter\\; проверьте'))).toBe(true);
  });
});
