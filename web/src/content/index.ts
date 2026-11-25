import cardsRu from '../../../content/important/cards.ru.json';
import cardsUk from '../../../content/important/cards.uk.json';
import cardsDe from '../../../content/important/cards.de.json';
import faqRu from '../../../content/faq.ru.md?raw';
import faqUk from '../../../content/faq.uk.md?raw';
import faqDe from '../../../content/faq.de.md?raw';
import { getLang, type Lang } from '../i18n';

/*
 * FAQ и карточки блога (раньше «Важно знать») берутся из папки content/ в корне репозитория.
 * Их пишут и проверяют люди; здесь только чтение и разбор.
 * L07: у каждого файла есть версии .uk и .de, берётся версия языка сайта.
 */

const LANG: Lang = getLang();
const CARDS_BY_LANG = { ru: cardsRu, uk: cardsUk, de: cardsDe };
const FAQ_BY_LANG: Record<Lang, string> = { ru: faqRu, uk: faqUk, de: faqDe };
const cardsData = CARDS_BY_LANG[LANG] ?? cardsRu;

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
  /** Поправка 5 (23.11): тема заведена, текст ещё пишет команда. */
  draft?: boolean;
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

export const FAQ: FaqSection[] = parseFaq(FAQ_BY_LANG[LANG] ?? faqRu);

export interface Consultation {
  name: string;
  text: string;
}

/** Вопрос FAQ со списком консультаций: экран «Найти консультацию» берёт тексты отсюда (F05). */
export const CONSULTATION_QUESTIONS: Record<Lang, string> = {
  ru: 'Куда обратиться, если нужен юридический совет?',
  uk: 'Куди звернутися, якщо потрібна юридична порада?',
  de: 'Wohin kann ich gehen, wenn ich Rechtsrat brauche?',
};
export const CONSULTATION_QUESTION = CONSULTATION_QUESTIONS[LANG];

/**
 * Консультации из FAQ: пункты списка «Название: текст» и абзацы после него.
 * Тексты не меняются, только делятся на название и описание.
 */
export function consultationsFromFaq(
  sections: FaqSection[],
  question: string = CONSULTATION_QUESTION,
): { places: Consultation[]; notes: string[] } {
  const item = sections.flatMap((s) => s.items).find((i) => i.question === question);
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
