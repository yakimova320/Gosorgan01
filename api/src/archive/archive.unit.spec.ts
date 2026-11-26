import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { demoArchive, demoEmbed, DEMO_ARCHIVE_NONE } from '../llm/adapters/demo-archive.js';
import { EMBEDDING_DIM } from '../llm/llm.types.js';
import { fitVector, normalize, toPgVector } from '../llm/vector.js';
import { CHUNK_CHARS, MAX_CHUNKS_PER_LETTER, splitLetter, textHash } from './chunking.js';
import { loadCheckedTerms, termsIn } from './glossary.js';

const LETTER = [
  'Jobcenter Musterstadt',
  'Aktenzeichen: JC-2026-1001',
  '',
  'Bitte reichen Sie die Kontoauszüge für September ein.',
  'Bitte antworten Sie bis zum 30.11.2026.',
].join('\n');

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

describe('L05: куски письма', () => {
  it('короткое письмо — один кусок, точный отрезок текста', () => {
    expect(splitLetter(LETTER)).toEqual([LETTER]);
    expect(splitLetter('  \n\n ')).toEqual([]);
  });

  it('длинное письмо режется по строкам, каждый кусок есть в письме и не длиннее предела', () => {
    const line = 'Bitte reichen Sie die Unterlagen bis zum Ende des Monats bei uns ein.';
    const text = Array.from({ length: 60 }, (_, i) => `${i}. ${line}`).join('\n');
    const chunks = splitLetter(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(text).toContain(c);
      expect(c.length).toBeLessThanOrEqual(CHUNK_CHARS);
    }
  });

  it('очень длинная строка режется по словам; кусков не больше предела', () => {
    const long = 'Wort '.repeat(5000);
    const chunks = splitLetter(long);
    expect(chunks).toHaveLength(MAX_CHUNKS_PER_LETTER);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_CHARS);
  });

  it('textHash меняется вместе с текстом', () => {
    expect(textHash('a')).toBe(textHash('a'));
    expect(textHash('a')).not.toBe(textHash('b'));
  });
});

describe('L05: векторы', () => {
  it('fitVector: длиннее — обрезка и длина 1; короче или не числа — null', () => {
    const v = fitVector(Array.from({ length: 3072 }, (_, i) => (i < EMBEDDING_DIM ? 2 : 100)));
    expect(v).toHaveLength(EMBEDDING_DIM);
    expect(dot(v!, v!)).toBeCloseTo(1, 6);
    expect(fitVector([1, 2, 3])).toBeNull();
    expect(fitVector(Array(EMBEDDING_DIM).fill('x'))).toBeNull();
    expect(fitVector('nope')).toBeNull();
  });

  it('нулевой вектор получает направление; запись для pgvector', () => {
    expect(normalize([0, 0, 0])).toEqual([1, 0, 0]);
    expect(toPgVector([0.5, -1, Number.NaN])).toBe('[0.5,-1,0]');
  });

  it('demo: тексты с общими словами ближе, чем без них', () => {
    const q = demoEmbed('Welche Kontoauszüge?');
    const near = demoEmbed('Bitte reichen Sie die Kontoauszüge ein.');
    const far = demoEmbed('Bitte legen Sie den Mietvertrag vor.');
    expect(q).toHaveLength(EMBEDDING_DIM);
    expect(dot(q, near)).toBeGreaterThan(dot(q, far));
  });
});

describe('L05: demo-ответ archive.v1', () => {
  const fragments = `### F1\nПисьмо: «Jobcenter» · 11.11.2026\n${LETTER}\n\n### F2\nПисьмо: «Bürgeramt» · 11.11.2026\nBitte legen Sie den Mietvertrag vor.`;

  it('цитата — целая строка фрагмента, где больше всего общих слов', () => {
    const r = demoArchive('Welche Kontoauszüge soll ich einreichen?', fragments);
    expect(r.sources[0]).toEqual({ fragment: 'F1', quote: 'Bitte reichen Sie die Kontoauszüge für September ein.' });
    expect(r.answer).toContain('Kontoauszüge');
  });

  it('нет общих слов — честный ответ без источников, на языке кабинета', () => {
    expect(demoArchive('Wetter morgen?', fragments)).toEqual({ answer: DEMO_ARCHIVE_NONE, sources: [] });
    expect(demoArchive('Wetter morgen?', fragments, 'de').answer).toContain('steht dazu nichts');
  });
});

describe('L05: справочник терминов', () => {
  it('черновики и файл с ошибкой не используются; поиск термина в тексте', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jasno-glossary-'));
    try {
      expect(loadCheckedTerms(dir)).toEqual([]);
      writeFileSync(join(dir, 'glossary.json'), '{ сломано');
      expect(loadCheckedTerms(dir)).toEqual([]);
      writeFileSync(
        join(dir, 'glossary.json'),
        JSON.stringify({
          terms: [
            { id: 'w', term: 'Widerspruch', text: { ru: 'Возражение.', uk: '', de: '' }, checkedAt: '2026-11-26' },
            { id: 'f', term: 'Frist', text: { ru: 'Срок.', uk: '', de: '' }, checkedAt: '', draft: true },
          ],
        }),
      );
      const terms = loadCheckedTerms(dir);
      expect(terms.map((t) => t.term)).toEqual(['Widerspruch']);
      expect(termsIn('Die Widerspruchsfrist beträgt einen Monat.', terms)).toHaveLength(1);
      expect(termsIn('Frist', terms)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('в content/glossary.json у каждого термина три языка и id без повторов', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const data = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '..', '..', '..', 'content', 'glossary.json'), 'utf8'),
    ) as { terms: { id: string; term: string; text: Record<string, string> }[] };
    expect(new Set(data.terms.map((t) => t.id)).size).toBe(data.terms.length);
    for (const t of data.terms) for (const l of ['ru', 'uk', 'de']) expect(t.text[l], `${t.id}.${l}`).toBeTruthy();
  });
});
