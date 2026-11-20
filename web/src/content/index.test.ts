import { describe, expect, it } from 'vitest';
import { CONSULTATION_QUESTION, FAQ, FAQ_CONSULTATIONS, consultationsFromFaq, parseFaq } from './index';

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
