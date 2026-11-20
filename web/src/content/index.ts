import cardsData from '../../../content/important/cards.ru.json';
import faqRaw from '../../../content/faq.ru.md?raw';

/*
 * FAQ и карточки «Важно знать» берутся из папки content/ в корне репозитория.
 * Их пишут и проверяют люди; здесь только чтение и разбор.
 */

export interface Card {
  id: string;
  topic: string;
  title: string;
  text: string;
  german: string[];
  keywords: string[];
  sources: { name: string; url: string }[];
  checkedAt: string;
  note?: string;
}

export interface Topic {
  id: string;
  title: string;
}

export const TOPICS: Topic[] = cardsData.topics;
export const CARDS: Card[] = cardsData.cards;

export type FaqBlock = { kind: 'p'; text: string } | { kind: 'ul' | 'ol'; items: string[] };

export interface FaqItem {
  question: string;
  blocks: FaqBlock[];
}

export interface FaqSection {
  title: string;
  items: FaqItem[];
}

/** Разбирает content/faq.ru.md: «## раздел», «### вопрос», абзацы и списки. */
export function parseFaq(md: string): FaqSection[] {
  const sections: FaqSection[] = [];
  let item: FaqItem | null = null;
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('<!--') || line.startsWith('# ')) continue;
    if (line.startsWith('## ')) {
      sections.push({ title: line.slice(3).trim(), items: [] });
      item = null;
      continue;
    }
    if (line.startsWith('### ')) {
      item = { question: line.slice(4).trim(), blocks: [] };
      sections[sections.length - 1]?.items.push(item);
      continue;
    }
    if (!item || !line.trim()) continue;
    const bullet = /^- (.*)$/.exec(line);
    const numbered = /^\d+\. (.*)$/.exec(line);
    const kind = bullet ? 'ul' : numbered ? 'ol' : null;
    if (kind) {
      const text = (bullet ?? numbered)![1];
      const last = item.blocks[item.blocks.length - 1];
      if (last && last.kind === kind) last.items.push(text);
      else item.blocks.push({ kind, items: [text] });
    } else {
      item.blocks.push({ kind: 'p', text: line.trim() });
    }
  }
  return sections;
}

export const FAQ: FaqSection[] = parseFaq(faqRaw);

export interface Consultation {
  name: string;
  text: string;
}

/** Вопрос FAQ со списком консультаций: экран «Найти консультацию» берёт тексты отсюда (F05). */
export const CONSULTATION_QUESTION = 'Куда обратиться, если нужен юридический совет?';

/**
 * Консультации из FAQ: пункты списка «Название: текст» и абзацы после него.
 * Тексты не меняются, только делятся на название и описание.
 */
export function consultationsFromFaq(sections: FaqSection[]): { places: Consultation[]; notes: string[] } {
  const item = sections.flatMap((s) => s.items).find((i) => i.question === CONSULTATION_QUESTION);
  const places: Consultation[] = [];
  const notes: string[] = [];
  for (const block of item?.blocks ?? []) {
    if (block.kind === 'p') notes.push(block.text);
    else
      for (const line of block.items) {
        const at = line.indexOf(': ');
        if (at < 0) places.push({ name: line, text: '' });
        else {
          const text = line.slice(at + 2);
          places.push({ name: line.slice(0, at), text: text.charAt(0).toUpperCase() + text.slice(1) });
        }
      }
  }
  return { places, notes };
}

export const FAQ_CONSULTATIONS = consultationsFromFaq(FAQ);
