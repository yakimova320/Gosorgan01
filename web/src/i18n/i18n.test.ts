import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import de from './de.json';
import uk from './uk.json';
import { browserLang, t, tMsg, tn } from './index';

/** Все t('…') и tn('…') в коде сайта (кроме тестов, i18n и примерных данных). */
function keysInCode(): string[] {
  const root = resolve(import.meta.dirname, '..');
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== 'i18n' && name !== 'mocks') walk(p);
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        const src = readFileSync(p, 'utf8');
        for (const m of src.matchAll(/\btn?\('((?:[^'\\]|\\.)*)'/g)) out.add(m[1].replace(/\\'/g, "'"));
      }
    }
  };
  walk(root);
  return [...out];
}

describe('переводы (L07)', () => {
  const keys = keysInCode();

  it('у каждого текста сайта есть украинский и немецкий перевод', () => {
    expect(keys.length).toBeGreaterThan(500);
    const missingUk = keys.filter((k) => !(k in uk));
    const missingDe = keys.filter((k) => !(k in de));
    expect(missingUk).toEqual([]);
    expect(missingDe).toEqual([]);
  });

  it('переменные {…} в переводе те же, что в русском тексте', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const k of keys) {
      const ru = vars(k.split('|')[0]);
      expect([k, vars((uk as Record<string, string>)[k].split('|')[0])]).toEqual([k, ru]);
      expect([k, vars((de as Record<string, string>)[k].split('|')[0])]).toEqual([k, ru]);
    }
  });

  it('множественное число', () => {
    const f = 'Ещё {n} день|Ещё {n} дня|Ещё {n} дней';
    expect(tn(f, 1, undefined, 'ru')).toBe('Ещё 1 день');
    expect(tn(f, 3, undefined, 'ru')).toBe('Ещё 3 дня');
    expect(tn(f, 11, undefined, 'ru')).toBe('Ещё 11 дней');
    expect(tn(f, 2, undefined, 'uk')).toBe('Ще 2 дні');
    expect(tn(f, 1, undefined, 'de')).toBe('Noch 1 Tag');
    expect(tn(f, 5, undefined, 'de')).toBe('Noch 5 Tage');
  });

  it('тексты проверок и язык браузера', () => {
    expect(t('Войти', undefined, 'de')).toBe('Anmelden');
    expect(t('Шаг {v0} из 3', { v0: 2 }, 'uk')).toBe('Крок 2 з 3');
    expect(tMsg('Не больше 300 знаков', 'de')).toBe('Höchstens 300 Zeichen');
    expect(tMsg('Не больше 12 знаков', 'uk')).toBe('Не більше 12 знаків');
    expect(tMsg('текст без перевода', 'de')).toBe('текст без перевода');
    expect(browserLang(['de-DE', 'en'])).toBe('de');
    expect(browserLang(['uk'])).toBe('uk');
    expect(browserLang(['en-US'])).toBe('ru');
  });

  it('тексты сервера: факты, история, основания', () => {
    expect(tMsg('Ведомство: Jobcenter Musterstadt', 'de')).toBe('Amt: Jobcenter Musterstadt');
    expect(tMsg('Срок: до 30.11.2026 (прислать документы)', 'uk')).toBe('Строк: до 30.11.2026 (надіслати документи)');
    expect(tMsg('Срок: до 30.11.2026 (ответить) (исправлено вами)', 'de')).toBe('Frist: bis 30.11.2026 (antworten) (von Ihnen korrigiert)');
    expect(tMsg('Сумма: 120,50 €', 'de')).toBe('Betrag: 120,50 €');
    expect(tMsg('Фактов: 3', 'uk')).toBe('Фактів: 3');
    expect(tMsg('Почтой · 19.11.2026', 'de')).toBe('Per Post · 19.11.2026');
    expect(tMsg('Дело создано из письма', 'de')).toBe('Vorgang aus dem Brief angelegt');
    expect(tMsg('Как продлить ВНЖ: подробно?', 'de')).toBe('Как продлить ВНЖ: подробно?');
  });
});
