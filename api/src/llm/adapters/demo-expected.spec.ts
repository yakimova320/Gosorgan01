import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPdfText } from '../../documents/pdf-text.js';
import { buildClaims } from '../../letters/claims.builder.js';
import { plan } from '../../eval/eval.runner.js';
import { ExtractV2Schema } from '../schemas/extract.schema.js';
import { DemoAdapter, demoExtract, demoRequestRu } from './demo.adapter.js';
import { FIXTURES_DIR, findExpectedLetter } from './demo-expected.js';

/*
 * #173: письма 16–30 в demo дают факты из эталона, цитаты проходят обычную проверку.
 * TEXT_LAYER — настоящий текст PDF (с водяным знаком, подвалом и переносами строк),
 * OCR — текст, который transcribe в demo отдаёт для фото.
 */

interface Fx {
  id: string;
  file: string;
  source: 'TEXT_LAYER' | 'OCR';
  text: string;
  expected: {
    authority: string | null;
    caseNumber: string | null;
    letterDate: string | null;
    requirements: string[];
    deadlines: string[];
  };
}
const fixtures = (re: RegExp) =>
  readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json') && re.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(resolve(FIXTURES_DIR, f), 'utf8')) as Fx);

const NEW = fixtures(/^(1[6-9]|2\d|30)_/);
const OLD = fixtures(/^(0\d|1[0-5])_/);

const extract = async (letterText: string) =>
  ExtractV2Schema.parse(
    JSON.parse(
      (
        await new DemoAdapter().complete({
          promptName: 'extract',
          promptVersion: 5,
          system: '',
          user: '',
          variables: { letterText, lang: 'ru' },
          images: [],
        })
      ).text,
    ),
  );

const letterTextOf = async (fx: Fx) =>
  fx.source === 'TEXT_LAYER'
    ? (await readPdfText(readFileSync(resolve(FIXTURES_DIR, fx.file)))).map((p) => p.text).join('\n\n')
    : fx.text;

describe('demo: письма 16–30 из эталона', () => {
  it('найдены все 30 вариантов (15 писем × PDF и фото)', () => {
    expect(NEW).toHaveLength(30);
    expect(NEW.filter((f) => f.source === 'OCR')).toHaveLength(15);
  });

  it.each(NEW.map((f) => [f.id, f] as const))('%s: факты равны expected, ничего не отброшено', async (_id, fx) => {
    const text = await letterTextOf(fx);
    const result = await extract(text);
    const { claims, dropped } = buildClaims(result, [{ n: 1, text }], fx.source === 'OCR');
    const one = (k: string) => claims.find((c) => c.kind === k)?.value ?? null;
    const all = (k: string) => claims.filter((c) => c.kind === k).map((c) => c.value).sort();

    expect(dropped).toEqual([]);
    expect(one('AUTHORITY')).toBe(fx.expected.authority);
    expect(one('CASE_NUMBER')).toBe(fx.expected.caseNumber);
    expect(one('LETTER_DATE')).toBe(fx.expected.letterDate);
    expect(all('REQUIREMENT')).toEqual([...fx.expected.requirements].sort());
    expect(all('DEADLINE')).toEqual([...fx.expected.deadlines].sort());
  });

  it('19: относительный срок без даты — фраза без пересчёта в дату', async () => {
    const fx = NEW.find((f) => f.id === '19_familienkasse_relative_frist')!;
    const { claims } = buildClaims(await extract(fx.text), [{ n: 1, text: fx.text }], false);
    expect(claims.filter((c) => c.kind === 'DEADLINE')).toEqual([]);
    expect(claims.find((c) => c.kind === 'OTHER')?.value).toBe('innerhalb von 14 Kalendertagen');
  });

  it('23 и 30: отменённые даты не становятся сроками; 29: номера дела нет', async () => {
    for (const id of ['23_auslaenderstelle_terminaenderung', '30_vorgang_abgeschlossen']) {
      const fx = NEW.find((f) => f.id === id)!;
      const result = await extract(fx.text);
      expect(result.deadlines).toEqual([]);
    }
    const fx29 = NEW.find((f) => f.id === '29_aktenzeichen_fehlt')!;
    expect((await extract(fx29.text)).caseNumber).toEqual({ value: null, quote: null, page: null });
  });
});

describe('demo: перевод требований писем 16–30', () => {
  it('каждое требование переведено на RU, UK и DE', () => {
    for (const fx of NEW)
      for (const r of fx.expected.requirements)
        for (const lang of ['ru', 'uk', 'de'] as const) {
          const text = demoRequestRu(r, lang);
          expect(text, `${fx.id} ${lang}: ${r}`).toBeTruthy();
          // дата в тексте требования была бы «не из своего факта» (Q1)
          expect(text).not.toMatch(/\d{2}\.\d{2}\.\d{4}/);
        }
  });

  it('23: паспорт взять на приём, а не прислать; 21: условие оплаты сохраняется', () => {
    expect(demoRequestRu('Bitte bringen Sie Ihren Reisepass und ein aktuelles biometrisches Foto zum neuen Termin mit.')).toMatch(/^Взять на новый приём/);
    expect(demoRequestRu('Falls Sie bereits gezahlt haben, senden Sie uns bitte stattdessen einen Zahlungsnachweis.', 'de')).toMatch(/^Wenn Sie schon bezahlt haben/);
  });
});

describe('demo: письма 01–15 и незнакомые письма как раньше', () => {
  it.each(OLD.map((f) => [f.id, f] as const))('%s: правила demoExtract, эталон не используется', async (_id, fx) => {
    expect(findExpectedLetter(fx.text)).toBeNull();
    const { title: _t, summary: _s, ...rest } = (await extract(fx.text)) as Record<string, unknown>;
    expect(rest).toEqual(JSON.parse(JSON.stringify(demoExtract(fx.text))));
  });

  it('незнакомое письмо и кусок письма 17 не узнаются', () => {
    expect(findExpectedLetter('Stadt Irgendwo\nBitte zahlen Sie bis zum 01.01.2027.')).toBeNull();
    const fx = NEW.find((f) => f.id === '17_wohngeld_zwei_fristen')!;
    expect(findExpectedLetter(fx.text.slice(0, 200))).toBeNull();
    expect(findExpectedLetter('')).toBeNull();
  });
});

describe('pnpm eval: наборы писем', () => {
  it('по умолчанию только 01–15, письма 16–30 — через --set new', () => {
    const base = plan(FIXTURES_DIR);
    expect(base.letters.every(({ fx }) => /^(0\d|1[0-5])_/.test(fx.id))).toBe(true);
    const fresh = plan(FIXTURES_DIR, 'new');
    expect(fresh.letters).toHaveLength(30);
    expect(fresh.letters.every(({ fx }) => /^(1[6-9]|2\d|30)_/.test(fx.id))).toBe(true);
    expect(plan(FIXTURES_DIR, 'all').letters).toHaveLength(base.letters.length + 30);
  });
});
