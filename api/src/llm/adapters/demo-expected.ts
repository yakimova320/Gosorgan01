import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalize } from '../../letters/claim-check.js';
import { MaskingService } from '../masking.service.js';

/**
 * Демо-режим для писем 16–30 (#173): письмо узнаётся по тексту, факты берутся из эталона
 * (поле expected в fixtures/letters/NN_*.json). Цитата каждого факта — строка из текста письма,
 * дальше она проходит обычную проверку цитат (buildClaims). Нет надёжной цитаты: поле null.
 * Письма 01–15 и незнакомые письма сюда не попадают: для них остаются правила demoExtract.
 */

/** Папка с синтетическими письмами: из src/llm/adapters и dist/llm/adapters на четыре уровня выше. */
export const FIXTURES_DIR = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'letters',
);

/** Письма, для которых demo отдаёт эталон: номера 16–30. */
const EXPECTED_IDS = /^(1[6-9]|2\d|30)_/;

interface Expected {
  authority: string | null;
  caseNumber: string | null;
  letterDate: string | null;
  requirements: string[];
  deadlines: string[];
}

interface KnownLetter {
  id: string;
  /** текст эталона после той же маскировки, что видит модель */
  text: string;
  norm: string;
  expected: Expected;
}

let known: KnownLetter[] | null = null;

function loadKnown(): KnownLetter[] {
  const list: KnownLetter[] = [];
  if (!existsSync(FIXTURES_DIR)) return list;
  const masking = new MaskingService();
  for (const name of readdirSync(FIXTURES_DIR).filter(
    (f) => f.endsWith('.json') && EXPECTED_IDS.test(f),
  )) {
    try {
      const meta = JSON.parse(readFileSync(resolve(FIXTURES_DIR, name), 'utf8')) as {
        id?: string;
        text?: string;
        expected?: Expected;
      };
      if (!meta.text || !meta.expected) continue;
      const text = masking.mask(meta.text, new Map());
      list.push({ id: meta.id ?? name, text, norm: normalize(text), expected: meta.expected });
    } catch {
      // повреждённый эталон пропускаем: demo не должен падать из-за fixtures
    }
  }
  // длинный текст первым: при вложении побеждает более полное совпадение
  return list.sort((a, b) => b.norm.length - a.norm.length);
}

/**
 * Какое письмо 16–30 перед нами. Текст PDF содержит ещё водяной знак и подвал, строки
 * переносятся иначе: сравниваются нормализованные тексты (пробелы и переносы схлопнуты).
 */
export function findExpectedLetter(letterText: string): KnownLetter | null {
  known ??= loadKnown();
  const text = normalize(letterText);
  if (!text) return null;
  return known.find((k) => text.includes(k.norm)) ?? null;
}

type Field = { value: string | null; quote: string | null; page: number | null };
const empty: Field = { value: null, quote: null, page: null };
const field = (value: string | null, quote: string | undefined): Field =>
  value !== null && quote ? { value, quote, page: 1 } : empty;

const deDate = (iso: string) => iso.split('-').reverse().join('.');

/** Срок без даты (19): и «14 Kalendertagen». Только для писем с эталоном. */
const RELATIVE =
  /\b(?:innerhalb|binnen)\s+(?:von\s+)?(?:\d+|einer|eines|zwei|drei|vier|vierzehn)\s+(?:Kalender|Werk)?(?:tag|tagen|Tag|Tagen|Woche|Wochen|Monat|Monaten)\b/i;

/**
 * Ответ extract (форма ExtractV2) из эталона. amounts — из правил demo по тексту письма:
 * в эталоне сумм нет, а цитата суммы так же проверяется кодом.
 */
export function extractFromExpected(
  letter: KnownLetter,
  amounts: Field[],
) {
  const lines = letter.text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const has = (needle: string) => lines.find((l) => normalize(l).includes(normalize(needle)));
  const e = letter.expected;

  const dateLine = (iso: string, prefer: RegExp) => {
    const withDate = lines.filter((l) => l.includes(deDate(iso)));
    return withDate.find((l) => prefer.test(l)) ?? withDate[0];
  };

  const deadlines = e.deadlines.flatMap((iso) => {
    const line = dateLine(iso, /\b(bis|spätestens)\b/i);
    if (!line) return [];
    // цитата — предложение со сроком, если строка длинная
    const sentence = line.split(/(?<=\.)\s+(?=[A-ZÄÖÜ])/).find((s) => s.includes(deDate(iso))) ?? line;
    return [
      {
        ...field(iso, sentence),
        kind: /widerspruch/i.test(sentence)
          ? ('OBJECTION' as const)
          : /antwort|melden|mitteil|teilen .* mit|bestätig/i.test(sentence)
            ? ('REPLY' as const)
            : ('DOCUMENTS' as const),
      },
    ];
  });

  const relativeDeadlines = lines
    .map((l) => [l, RELATIVE.exec(l)?.[0]] as const)
    .filter((x): x is readonly [string, string] => !!x[1])
    .map(([l, phrase]) => field(phrase, l));

  return {
    relativeDeadlines,
    authority: e.authority ? field(e.authority, has(e.authority)) : empty,
    caseNumber: e.caseNumber ? field(e.caseNumber, has(e.caseNumber)) : empty,
    letterDate: e.letterDate
      ? field(e.letterDate, dateLine(e.letterDate, /^Datum\b/i))
      : empty,
    // требование в эталоне — дословный отрывок письма: он сам и есть цитата
    requirements: e.requirements.map((r) => field(r, has(r) ? r : undefined)),
    deadlines,
    amounts,
  };
}

/**
 * Перевод требований писем 16–30 для explain в demo: готовые фразы на RU, UK и простом DE.
 * Условия («если уже оплатили») и добровольность («по желанию») сохраняются.
 * Дат в переводе нет: срок показывается отдельным пунктом со ссылкой на свой факт (правило Q1).
 */
const REQUESTS: [string, string, string, string][] = [
  ['Bitte reichen Sie die Lohnabrechnungen für September und Oktober 2026 sowie den Nachweis über Ihre aktuelle Miethöhe ein.',
    'Прислать: расчётные листки зарплаты за сентябрь и октябрь 2026 и подтверждение текущей суммы аренды.',
    'Надіслати: розрахункові листки зарплати за вересень і жовтень 2026 та підтвердження поточної суми оренди.',
    'Schicken: Lohnabrechnungen für September und Oktober 2026 und einen Nachweis über Ihre Miete.'],
  ['Bitte reichen Sie die Mietbescheinigung bis zum 03.12.2026 ein.',
    'Прислать: справку от арендодателя.',
    'Надіслати: довідку від орендодавця.',
    'Schicken: die Mietbescheinigung.'],
  ['Bitte reichen Sie den Einkommensnachweis Ihrer selbstständigen Tätigkeit bis zum 17.12.2026 ein.',
    'Прислать: подтверждение дохода от самостоятельной работы.',
    'Надіслати: підтвердження доходу від самостійної діяльності.',
    'Schicken: den Nachweis über Ihr Einkommen als Selbstständige oder Selbstständiger.'],
  ['Bitte bringen Sie Ihren Lebenslauf und Ihre vorhandenen Abschlusszeugnisse zum Termin mit.',
    'Взять на встречу: резюме и имеющиеся аттестаты и дипломы.',
    'Взяти на зустріч: резюме та наявні атестати й дипломи.',
    'Zum Termin mitbringen: Lebenslauf und Ihre Zeugnisse.'],
  ['Bitte bestätigen Sie Ihre Teilnahme bis zum 01.12.2026.',
    'Подтвердить участие во встрече.',
    'Підтвердити участь у зустрічі.',
    'Bestätigen, dass Sie zum Termin kommen.'],
  ['Bitte reichen Sie eine aktuelle Schulbescheinigung für Ihr Kind ein.',
    'Прислать: свежую справку из школы для ребёнка.',
    'Надіслати: свіжу довідку зі школи для дитини.',
    'Schicken: eine aktuelle Schulbescheinigung für Ihr Kind.'],
  ['Bitte teilen Sie uns den tatsächlichen Beschäftigungsbeginn mit und fügen Sie eine Bestätigung Ihres Arbeitgebers bei.',
    'Сообщить, когда на самом деле началась работа, и приложить подтверждение от работодателя.',
    'Повідомити, коли насправді почалася робота, і додати підтвердження від роботодавця.',
    'Mitteilen, wann Ihre Arbeit wirklich begonnen hat, und eine Bestätigung vom Arbeitgeber mitschicken.'],
  ['Bitte begleichen Sie den offenen Betrag bis zum 04.12.2026 unter Angabe des Aktenzeichens.',
    'Оплатить открытую сумму и указать номер дела.',
    'Сплатити відкриту суму і вказати номер справи.',
    'Den offenen Betrag bezahlen und das Aktenzeichen angeben.'],
  ['Falls Sie bereits gezahlt haben, senden Sie uns bitte stattdessen einen Zahlungsnachweis.',
    'Если уже оплатили: вместо оплаты прислать подтверждение платежа.',
    'Якщо вже сплатили: замість оплати надіслати підтвердження платежу.',
    'Wenn Sie schon bezahlt haben: statt zu zahlen einen Zahlungsnachweis schicken.'],
  ['Bitte bringen Sie Ihren Reisepass und ein aktuelles biometrisches Foto zum neuen Termin mit.',
    'Взять на новый приём: загранпаспорт и свежее биометрическое фото.',
    'Взяти на новий прийом: закордонний паспорт і свіже біометричне фото.',
    'Zum neuen Termin mitbringen: Reisepass und ein aktuelles biometrisches Foto.'],
  ['Bitte geben Sie die unterschriebene Einverständniserklärung bis zum 08.12.2026 im Sekretariat ab.',
    'Сдать подписанное согласие в секретариат школы.',
    'Здати підписану згоду до секретаріату школи.',
    'Die unterschriebene Einverständniserklärung im Sekretariat abgeben.'],
  ['Bitte teilen Sie uns auf dem Formular eine Telefonnummer für Rückfragen während des Ausflugs mit.',
    'Указать в бланке телефон для связи во время экскурсии.',
    'Вказати в бланку телефон для зв’язку під час екскурсії.',
    'Auf dem Formular eine Telefonnummer für Fragen während des Ausflugs angeben.'],
  ['Bitte ermöglichen Sie in diesem Zeitraum den Zugang zum Wasserzähler.',
    'В это время обеспечить доступ к счётчику воды.',
    'У цей час забезпечити доступ до лічильника води.',
    'In dieser Zeit den Zugang zum Wasserzähler möglich machen.'],
  ['Falls Sie verhindert sind, teilen Sie uns dies bitte bis zum 02.12.2026 mit, damit wir einen Ersatztermin vereinbaren können.',
    'Только если вы не сможете: сообщить об этом, чтобы назначить другое время.',
    'Лише якщо ви не зможете: повідомити про це, щоб призначити інший час.',
    'Nur wenn Sie keine Zeit haben: Bescheid geben, dann gibt es einen neuen Termin.'],
  ['Bitte reichen Sie die Einkommensbescheinigung spätestens bis zum 18.12.2026 ein.',
    'Прислать: справку о доходах.',
    'Надіслати: довідку про доходи.',
    'Schicken: die Einkommensbescheinigung.'],
  ['Sie können uns bis zum 16.12.2026 eine ergänzende Kursbeschreibung mit Stundenumfang zur erneuten Prüfung senden. Dies ist freiwillig.',
    'По желанию: можно прислать дополненное описание курса с количеством часов для повторной проверки.',
    'За бажанням: можна надіслати доповнений опис курсу з кількістю годин для повторної перевірки.',
    'Freiwillig: eine ergänzte Kursbeschreibung mit Stundenzahl schicken, dann wird neu geprüft.'],
  ['Bitte senden Sie eine vollständige und gut lesbare Kopie der Wohnungsgeberbestätigung.',
    'Прислать: полную и хорошо читаемую копию подтверждения от арендодателя о заселении (Wohnungsgeberbestätigung).',
    'Надіслати: повну й добре читабельну копію підтвердження від орендодавця про заселення (Wohnungsgeberbestätigung).',
    'Schicken: eine vollständige, gut lesbare Kopie der Wohnungsgeberbestätigung.'],
  ['Bitte teilen Sie uns bis zum 09.12.2026 mit, ob Sie am Vormittagskurs oder am Abendkurs teilnehmen möchten.',
    'Сообщить, какой курс вы выбираете: утренний или вечерний.',
    'Повідомити, який курс ви обираєте: ранковий чи вечірній.',
    'Mitteilen: Vormittagskurs oder Abendkurs.'],
  ['Nennen Sie in Ihrer Antwort Ihren Namen und das Datum Ihrer Anmeldung.',
    'В ответе указать своё имя и дату записи на курс.',
    'У відповіді вказати своє ім’я та дату запису на курс.',
    'In der Antwort Ihren Namen und das Datum Ihrer Anmeldung nennen.'],
];
const REQUEST_MAP = new Map(REQUESTS.map(([de, ...rest]) => [normalize(de), rest]));

/** Готовый перевод требования письма 16–30 или null (тогда работает общий словарь demo). */
export function expectedRequest(value: string, lang: 'ru' | 'uk' | 'de'): string | null {
  const t = REQUEST_MAP.get(normalize(value));
  return t ? t[lang === 'ru' ? 0 : lang === 'uk' ? 1 : 2] : null;
}
