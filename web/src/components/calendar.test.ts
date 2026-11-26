import { describe, expect, it } from 'vitest';
import { deadlineEvent, googleEventUrl } from './calendar';

describe('Google Календарь: готовое событие (K12, поправка 26.11)', () => {
  it('событие на весь день: конец — следующий день, в том числе через конец месяца и года', () => {
    const url = new URL(googleEventUrl({ date: '2026-12-31', title: 'Срок', details: '' }));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('dates')).toBe('20261231/20270101');
    expect(new URL(googleEventUrl({ date: '2028-02-28', title: '', details: '' })).searchParams.get('dates')).toBe(
      '20280228/20280229',
    );
  });

  it('текст и описание кодируются: пробелы, &, переводы строк, кириллица', () => {
    const url = new URL(googleEventUrl({ date: '2026-12-01', title: 'Срок: A & B', details: 'строка 1\nстрока 2' }));
    expect(url.searchParams.get('text')).toBe('Срок: A & B');
    expect(url.searchParams.get('details')).toBe('строка 1\nстрока 2');
  });

  it('событие срока: вид, ведомство, дело и ссылка на дело, без текста письма', () => {
    const e = deadlineEvent(
      { date: '2026-12-01', kind: 'DOCUMENTS', authority: 'Jobcenter', caseTitle: 'Kontoauszüge', caseId: 'c1' },
      'http://localhost:5173/',
    );
    expect(e.title).toBe('Срок: прислать документы — Jobcenter');
    expect(e.details.split('\n')).toEqual([
      'Дело: Kontoauszüge',
      'Срок из письма, подтверждённый в Ja!sno. Проверьте дату по оригиналу письма.',
      'http://localhost:5173/app/cases/c1',
    ]);
    expect(deadlineEvent({ date: '2026-12-01', caseTitle: 'X', caseId: 'c2' }, 'https://j.example').title).toBe('Срок');
  });
});
