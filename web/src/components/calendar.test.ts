import { describe, expect, it } from 'vitest';
import { feedUrl, googleCalendarUrl, webcalUrl } from './calendar';

describe('ссылки календаря (K12)', () => {
  it('адрес API абсолютный и относительный', () => {
    expect(feedUrl('/calendar/abc.ics', 'http://127.0.0.1:3000', 'http://localhost:5173')).toBe(
      'http://127.0.0.1:3000/calendar/abc.ics',
    );
    expect(feedUrl('/calendar/abc.ics', 'https://jasno.example/', 'http://x')).toBe(
      'https://jasno.example/calendar/abc.ics',
    );
    expect(feedUrl('/calendar/abc.ics', '', 'https://jasno.example')).toBe('https://jasno.example/calendar/abc.ics');
  });

  it('webcal и Google Календарь', () => {
    expect(webcalUrl('https://jasno.example/calendar/abc.ics')).toBe('webcal://jasno.example/calendar/abc.ics');
    expect(googleCalendarUrl('https://jasno.example/calendar/abc.ics')).toBe(
      'https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fjasno.example%2Fcalendar%2Fabc.ics',
    );
  });
});
