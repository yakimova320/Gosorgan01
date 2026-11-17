/*
 * Проверки фактов кодом после модели (ТЗ v2 раздел 9, ТЗ v3 6.3, правило Q4).
 * Цитата должна быть в тексте письма (на указанной странице), а значение — в самой цитате.
 * Для фото допускается нечёткое совпадение цитаты (Левенштейн до 3 %), но цифры должны совпасть точно.
 */

export interface PageText {
  n: number;
  text: string;
}

export interface QuoteMatch {
  page: number;
}

/** Нижний регистр, перенос с дефисом убран, пробелы и переносы схлопнуты, типографские знаки упрощены. */
export function normalize(s: string): string {
  return s
    .replace(/­/g, '')
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const digits = (s: string) => s.replace(/\D/g, '');

/**
 * Где в тексте страниц есть цитата. page задан: только эта страница, и она должна существовать.
 * fuzzy (фото): лучшее приближённое совпадение с расстоянием до 3 % длины и теми же цифрами.
 */
export function findQuote(
  quote: string,
  pages: PageText[],
  page: number | null,
  fuzzy: boolean,
): QuoteMatch | null {
  const q = normalize(quote);
  if (q.length < 3) return null;
  const candidates = page === null ? pages : pages.filter((p) => p.n === page);
  if (page !== null && candidates.length === 0) return null;
  for (const p of candidates) {
    const text = normalize(p.text);
    if (text.includes(q)) return { page: p.n };
    if (fuzzy) {
      const window = bestWindow(q, text);
      const maxDistance = Math.floor(q.length * 0.03);
      if (
        window &&
        window.distance <= maxDistance &&
        digits(window.text) === digits(q)
      )
        return { page: p.n };
    }
  }
  return null;
}

/** Приближённый поиск подстроки (алгоритм Селлерса): минимальное расстояние и найденный отрывок. */
export function bestWindow(
  pattern: string,
  text: string,
): { distance: number; text: string } | null {
  const m = pattern.length;
  if (m === 0 || text.length === 0) return null;
  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  let prevStart = new Array<number>(m + 1).fill(0);
  let best = { distance: Infinity, end: -1, start: 0 };
  for (let j = 1; j <= text.length; j++) {
    const cur = [0];
    const curStart = [j];
    for (let i = 1; i <= m; i++) {
      const cost = pattern[i - 1] === text[j - 1] ? 0 : 1;
      const sub = prev[i - 1] + cost;
      const del = prev[i] + 1;
      const ins = cur[i - 1] + 1;
      if (sub <= del && sub <= ins) {
        cur[i] = sub;
        curStart[i] = i === 1 ? j - 1 : prevStart[i - 1];
      } else if (del <= ins) {
        cur[i] = del;
        curStart[i] = prevStart[i];
      } else {
        cur[i] = ins;
        curStart[i] = curStart[i - 1];
      }
    }
    if (cur[m] < best.distance)
      best = { distance: cur[m], end: j, start: curStart[m] };
    prev = cur;
    prevStart = curStart;
  }
  return {
    distance: best.distance,
    text: text.slice(best.start, best.end),
  };
}

// ---------- Даты ----------

const MONTHS: Record<string, number> = {
  januar: 1,
  jan: 1,
  jänner: 1,
  februar: 2,
  feb: 2,
  märz: 3,
  maerz: 3,
  mär: 3,
  april: 4,
  apr: 4,
  mai: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  okt: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  dez: 12,
};

/** Календарная дата существует: 2026-02-30 — нет. */
export function isCalendarDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  );
}

const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Все даты в тексте: 30.11.2026, 3.1.26, 30. November 2026, 30. Nov. 2026. Только существующие. */
export function datesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(
    /\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})\b/g,
  )) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    out.push(iso(y, Number(m[2]), Number(m[1])));
  }
  for (const m of text.matchAll(
    /\b(\d{1,2})\.\s*([A-Za-zÄÖÜäöü]+)\.?\s+(\d{4})\b/g,
  )) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month) out.push(iso(Number(m[3]), month, Number(m[1])));
  }
  return out.filter(isCalendarDate);
}

// ---------- Значение в цитате ----------

/** Суммы в цитате: 120,50 €, 1.234,56 EUR, 120.50 → '120.50', '1234.56'. */
export function amountsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(
    /\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}|\d+\.\d{2}\b|\d+(?=\s*(?:€|EUR|Euro)\b)/g,
  )) {
    const raw = m[0];
    const n = raw.includes(',')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw;
    out.push(Number(n).toFixed(2));
  }
  return out;
}

const alnum = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export type CheckedKind =
  | 'AUTHORITY'
  | 'CASE_NUMBER'
  | 'LETTER_DATE'
  | 'REQUIREMENT'
  | 'DEADLINE'
  | 'AMOUNT'
  | 'RELATIVE_DEADLINE';

/** Значение подтверждается своей цитатой. Причина отказа или null. */
export function valueInQuote(
  kind: CheckedKind,
  value: string,
  quote: string,
): string | null {
  switch (kind) {
    case 'LETTER_DATE':
    case 'DEADLINE':
      if (!isCalendarDate(value)) return 'несуществующая дата';
      return datesIn(quote).includes(value) ? null : 'даты нет в цитате';
    case 'AMOUNT': {
      const v = Number(value);
      if (!Number.isFinite(v)) return 'не число';
      return amountsIn(quote).includes(v.toFixed(2))
        ? null
        : 'суммы нет в цитате';
    }
    case 'CASE_NUMBER':
      return alnum(value).length > 0 && alnum(quote).includes(alnum(value))
        ? null
        : 'номера нет в цитате';
    default:
      return normalize(value).length > 0 &&
        normalize(quote).includes(normalize(value))
        ? null
        : 'значения нет в цитате';
  }
}
