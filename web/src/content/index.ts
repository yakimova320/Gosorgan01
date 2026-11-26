import cardsRu from '../../../content/important/cards.ru.json';
import cardsUk from '../../../content/important/cards.uk.json';
import cardsDe from '../../../content/important/cards.de.json';
import faqRu from '../../../content/faq.ru.md?raw';
import faqUk from '../../../content/faq.uk.md?raw';
import faqDe from '../../../content/faq.de.md?raw';
import glossaryData from '../../../content/glossary.json';
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

/**
 * UX 26.11 (#168): главные вопросы FAQ для блока «Полезно знать» на главной.
 * Тексты вопросов дословно из content/faq.{lang}.md; ответы берутся оттуда же.
 */
export const HOME_FAQ_QUESTIONS: Record<Lang, string[]> = {
  ru: ['Для чего нужен Ja!sno?', 'Может ли Ja!sno ошибиться?', 'Ja!sno сам отправит ответ в ведомство?', 'Кто видит мои письма?'],
  uk: ['Для чого потрібен Ja!sno?', 'Чи може Ja!sno помилитися?', 'Ja!sno сам надішле відповідь до відомства?', 'Хто бачить мої листи?'],
  de: ['Wofür ist Ja!sno da?', 'Kann Ja!sno sich irren?', 'Schickt Ja!sno die Antwort selbst an das Amt?', 'Wer sieht meine Briefe?'],
};

export function homeFaq(sections: FaqSection[], questions: string[]): FaqItem[] {
  const all = sections.flatMap((s) => s.items);
  return questions.map((q) => all.find((i) => i.question === q)).filter((i): i is FaqItem => i !== undefined);
}

export const HOME_FAQ: FaqItem[] = homeFaq(FAQ, HOME_FAQ_QUESTIONS[LANG] ?? HOME_FAQ_QUESTIONS.ru);

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

/** L05 (#81): термин справочника content/glossary.json. Тексты пишут и проверяют люди. */
export interface GlossaryTerm {
  id: string;
  term: string;
  text: string;
  checkedAt: string;
  /** Черновик: ещё не проверен командой */
  draft: boolean;
}

/**
 * Термины на языке сайта, по алфавиту. Черновики видны только в разработке (pnpm dev, e2e) с пометкой;
 * на опубликованном сайте (pnpm build) их нет, пока команда не снимет draft.
 */
export function glossaryTerms(showDrafts: boolean = import.meta.env.DEV): GlossaryTerm[] {
  return (glossaryData.terms as { id: string; term: string; text: Record<string, string>; checkedAt: string; draft?: boolean }[])
    .filter((g) => showDrafts || !g.draft)
    .map((g) => ({ id: g.id, term: g.term, text: g.text[LANG] || g.text.ru, checkedAt: g.checkedAt, draft: Boolean(g.draft) }))
    .sort((a, b) => a.term.localeCompare(b.term, 'de'));
}
