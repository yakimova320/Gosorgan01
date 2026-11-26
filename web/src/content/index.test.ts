import { describe, expect, it } from 'vitest';
import { CONSULTATION_QUESTION, FAQ, FAQ_CONSULTATIONS, HOME_FAQ_QUESTIONS, consultationsFromFaq, homeFaq, parseFaq } from './index';

describe('главные вопросы FAQ на главной (UX 26.11)', () => {
  it('в каждом языке все 4 вопроса есть в FAQ, у каждого есть ответ', () => {
    for (const [lang, md] of [['ru', faqRu], ['uk', faqUk], ['de', faqDe]] as const) {
      const items = homeFaq(parseFaq(md), HOME_FAQ_QUESTIONS[lang]);
      expect([lang, items.map((i) => i.question)]).toEqual([lang, HOME_FAQ_QUESTIONS[lang]]);
      for (const i of items) expect(i.blocks.length).toBeGreaterThan(0);
    }
  });
});

describe('консультации из FAQ (F05)', () => {
  it('вопрос о консультациях есть в FAQ, каждый пункт попадает на экран без изменений текста', () => {
    const item = FAQ.flatMap((s) => s.items).find((i) => i.question === CONSULTATION_QUESTION);
    expect(item).toBeDefined();
    const lines = item!.blocks.flatMap((b) => (b.kind === 'p' ? [] : b.items));
    expect(FAQ_CONSULTATIONS.places).toHaveLength(lines.length);
    expect(FAQ_CONSULTATIONS.places.map((c) => c.name)).toEqual(expect.arrayContaining(['Verbraucherzentrale', 'Mieterverein']));
    for (const [i, c] of FAQ_CONSULTATIONS.places.entries())
      expect(lines[i].toLowerCase()).toBe(`${c.name}: ${c.text}`.toLowerCase());
    expect(FAQ_CONSULTATIONS.notes.length).toBeGreaterThan(0);
  });

  it('пункт без двоеточия и абзац после списка', () => {
    const md = `## Р\n\n### ${CONSULTATION_QUESTION}\n\n- MBE: бесплатно.\n- Адвокат\n\nКонтактов нет.\n`;
    expect(consultationsFromFaq(parseFaq(md))).toEqual({
      places: [
        { name: 'MBE', text: 'Бесплатно.' },
        { name: 'Адвокат', text: '' },
      ],
      notes: ['Контактов нет.'],
    });
  });
});

import cardsRu from '../../../content/important/cards.ru.json';
import cardsUk from '../../../content/important/cards.uk.json';
import cardsDe from '../../../content/important/cards.de.json';
import faqRu from '../../../content/faq.ru.md?raw';
import faqUk from '../../../content/faq.uk.md?raw';
import faqDe from '../../../content/faq.de.md?raw';
import { CONSULTATION_QUESTIONS } from './index';

describe('L07: FAQ и карточки на украинском и немецком', () => {
  const shape = (md: string) => parseFaq(md).map((s) => s.items.map((i) => i.blocks.map((b) => (b.kind === 'p' ? 'p' : `${b.kind}${b.items.length}`)).join()));
  it.each([
    ['uk', faqUk],
    ['de', faqDe],
  ] as const)('FAQ %s: те же разделы, вопросы и списки, есть вопрос о консультациях', (lang, md) => {
    expect(shape(md)).toEqual(shape(faqRu));
    const { places } = consultationsFromFaq(parseFaq(md), CONSULTATION_QUESTIONS[lang]);
    expect(places.map((p) => p.name)).toEqual(expect.arrayContaining(['Verbraucherzentrale', 'Mieterverein']));
  });

  it.each([
    ['uk', cardsUk],
    ['de', cardsDe],
  ] as const)('карточки %s: те же id, темы, источники и даты, текст переведён', (_lang, data) => {
    expect(data.topics.map((t) => t.id)).toEqual(cardsRu.topics.map((t) => t.id));
    expect(data.cards.map((c) => [c.id, c.topic, c.checkedAt, c.sources, c.german, Boolean(c.draft), 'note' in c])).toEqual(
      cardsRu.cards.map((c) => [c.id, c.topic, c.checkedAt, c.sources, c.german, Boolean(c.draft), 'note' in c]),
    );
    for (const [i, c] of data.cards.entries()) {
      expect(c.title).not.toBe(cardsRu.cards[i].title);
      expect(c.keywords.length).toBeGreaterThan(0);
    }
  });
});
