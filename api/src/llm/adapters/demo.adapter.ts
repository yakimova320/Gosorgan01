import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderPdfPages } from '../../documents/pdf-text.js';
import {
  AdapterError,
  type AdapterRequest,
  type AdapterResponse,
  type LlmAdapter,
} from '../llm.types.js';
import { demoArchive, demoArchiveQuery } from './demo-archive.js';

/**
 * Режим без настоящей модели: простые правила, без сети.
 * Нужен для тестов, CI и офлайн-демо. GET /health показывает llmMode: demo.
 * Каждый промпт, который поддерживает demo, добавляет сюда свою функцию.
 */
export class DemoAdapter implements LlmAdapter {
  readonly provider = 'demo';
  readonly model = 'demo';

  private readonly handlers: Record<
    string,
    (variables: Record<string, string>, request: AdapterRequest) => unknown
  > = {
    extract: (v, request) => {
      const base = demoExtract(v.letterText ?? '');
      // extract.v3 (поправка 8): и название письма по строке Betreff; L07: на языке кабинета
      return (request.promptVersion ?? 0) >= 3
        ? { ...base, title: demoTitle(v.letterText ?? '', demoLang(v.lang)) }
        : base;
    },
    translate: (v) => demoTranslate(v.letterText ?? '', demoLang(v.lang)),
    chat: (v) => demoChat(v.question ?? '', v.faq ?? '', demoLang(v.lang)),
    archive: (v) => demoArchive(v.question ?? '', v.fragments ?? '', demoLang(v.lang)),
    'archive-query': (v) => demoArchiveQuery(v.question ?? ''),
    explain: (v) => demoExplain(v.facts ?? '[]', demoLang(v.lang)),
    transcribe: (_v, request) =>
      request.promptVersion === 2
        ? demoTranscribePages(request.images.map((i) => i.data))
        : demoTranscribe(request.images.map((i) => i.data)),
  };

  async complete(request: AdapterRequest): Promise<AdapterResponse> {
    const handler = this.handlers[request.promptName];
    if (!handler)
      throw new AdapterError(
        'BAD_REQUEST',
        `demo: нет правил для промпта ${request.promptName}`,
      );
    if (request.promptName === 'transcribe') await loadScanPages();
    return { text: JSON.stringify(handler(request.variables, request)) };
  }
}

type Field = {
  value: string | null;
  quote: string | null;
  page: number | null;
};
const empty: Field = { value: null, quote: null, page: null };
const AUTHORITY =
  /(Jobcenter|Familienkasse|Bürgeramt|Ausländerbehörde|Finanzamt|Krankenkasse|Agentur für Arbeit|Amt|Behörde|Kasse)/;
const DATE = /(\d{1,2})\.(\d{1,2})\.(\d{4})/;

const toIso = (m: RegExpExecArray) =>
  `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;

/** Правила для extract.v1 по строкам письма. Цитата всегда целая строка из текста. */
const RELATIVE =
  /\b(?:innerhalb|binnen)\s+(?:von\s+)?(?:\d+|einer|eines|zwei|drei|vier|vierzehn)\s+(?:Tag|Tagen|Woche|Wochen|Monat|Monaten)\b|\bumgehend\b|\bunverzüglich\b/i;

export function demoExtract(text: string) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const field = (line: string | undefined, value: string | null): Field =>
    line && value ? { value, quote: line, page: 1 } : empty;

  const authorityLine = lines.find(
    (l) => AUTHORITY.test(l) && !/^(An|Betreff)\b/.test(l),
  );
  const caseLine = lines.find((l) =>
    /Aktenzeichen|Az\.|Geschäftszeichen|Kundennummer/i.test(l),
  );
  const caseValue = caseLine
    ? (/[:\s]\s*([A-Z0-9][\w/-]{3,})\s*$/.exec(caseLine)?.[1] ?? null)
    : null;
  const dateLine = lines.find((l) => /^Datum\b/i.test(l) && DATE.test(l));
  const dateMatch = dateLine ? DATE.exec(dateLine) : null;

  const deadlines = lines
    .filter((l) => /\b(bis|spätestens)\b/i.test(l) && DATE.test(l))
    .map((l) => ({
      ...field(l, toIso(DATE.exec(l) as RegExpExecArray)),
      kind: /widerspruch/i.test(l)
        ? 'OBJECTION'
        : /antwort|melden|mitteil/i.test(l)
          ? 'REPLY'
          : 'DOCUMENTS',
    }));
  const requirements = lines
    .filter(
      (l) => /^Bitte\b/i.test(l) && !/\b(bis|spätestens|nennen)\b/i.test(l),
    )
    .map((l) => field(l, l));
  const amounts = lines
    .filter((l) => /\d+(?:\.\d{3})*,\d{2}\s*(?:€|EUR)/.test(l))
    .map((l) =>
      field(
        l,
        /(\d+(?:\.\d{3})*,\d{2})\s*(?:€|EUR)/
          .exec(l)?.[1]
          .replace(/\./g, '')
          .replace(',', '.') ?? null,
      ),
    );

  // Срок без даты: только фраза, без пересчёта (extract.v2).
  const relativeDeadlines = lines
    .filter((l) => !DATE.test(l))
    .map((l) => [l, RELATIVE.exec(l)?.[0]] as const)
    .filter((x): x is readonly [string, string] => !!x[1])
    .map(([l, phrase]) => field(l, phrase));

  return {
    relativeDeadlines,
    authority: field(authorityLine, authorityLine ?? null),
    caseNumber: field(caseLine, caseValue),
    letterDate: dateMatch ? field(dateLine, toIso(dateMatch)) : empty,
    requirements,
    deadlines,
    amounts,
  };
}

/** Папка с синтетическими письмами: из src/llm/adapters и dist/llm/adapters на четыре уровня выше. */
const FIXTURES_DIR = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'fixtures',
  'letters',
);

interface FixturePhoto {
  text: string;
  readable: boolean;
}
let fixturePhotos: Map<string, FixturePhoto> | null = null;

/** sha256 фото из fixtures/letters → текст и читаемость эталона. Без папки: пустой список. */
function loadFixturePhotos(): Map<string, FixturePhoto> {
  const map = new Map<string, FixturePhoto>();
  if (!existsSync(FIXTURES_DIR)) return map;
  for (const name of readdirSync(FIXTURES_DIR).filter((f) =>
    f.endsWith('.json'),
  )) {
    try {
      const meta = JSON.parse(
        readFileSync(resolve(FIXTURES_DIR, name), 'utf8'),
      ) as {
        file?: string;
        text?: string;
        readable?: boolean;
      };
      // Фото письма: поле file или файл с тем же именем (.jpg, .png), например 09_scan.png.
      const base = name.replace(/\.json$/, '');
      const candidates = [meta.file, `${base}.jpg`, `${base}.png`].filter(
        (f): f is string =>
          !!f &&
          /\.(jpe?g|png)$/i.test(f) &&
          existsSync(resolve(FIXTURES_DIR, f)),
      );
      for (const file of new Set(candidates)) {
        const image = readFileSync(resolve(FIXTURES_DIR, file));
        map.set(sha256(image), {
          text: meta.text ?? '',
          readable: meta.readable !== false,
        });
      }
    } catch {
      // повреждённый эталон пропускаем: demo не должен падать из-за fixtures
    }
  }
  return map;
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * transcribe в режиме demo: узнаёт только фото из fixtures/letters по хэшу.
 * Любое другое фото: честно «не прочитано» (DEMO_UNKNOWN), без придуманного текста.
 */
export function demoTranscribe(images: Buffer[]): {
  text: string;
  readable: boolean;
  reason: string | null;
} {
  return demoPage(images[0]);
}

function demoPage(image: Buffer | undefined): {
  text: string;
  readable: boolean;
  reason: string | null;
} {
  fixturePhotos ??= loadFixturePhotos();
  const known = image ? fixturePhotos.get(sha256(image)) : undefined;
  if (!known) return { text: '', readable: false, reason: 'DEMO_UNKNOWN' };
  if (!known.readable) return { text: '', readable: false, reason: 'BLURRY' };
  return { text: known.text, readable: true, reason: null };
}

/** transcribe.v2 в режиме demo (B11): каждая страница — как отдельное фото из fixtures. */
export function demoTranscribePages(images: Buffer[]) {
  return { pages: images.map((image) => demoPage(image)) };
}

let scanPagesLoaded: Promise<void> | null = null;

/**
 * B11: страницы PDF-сканов из fixtures (source OCR) после рендера тоже узнаются по хэшу.
 * Рендер детерминированный (тот же renderPdfPages, что при загрузке). Один раз на процесс.
 */
export function loadScanPages(): Promise<void> {
  scanPagesLoaded ??= (async () => {
    fixturePhotos ??= loadFixturePhotos();
    if (!existsSync(FIXTURES_DIR)) return;
    for (const name of readdirSync(FIXTURES_DIR).filter((f) =>
      f.endsWith('.json'),
    )) {
      try {
        const meta = JSON.parse(
          readFileSync(resolve(FIXTURES_DIR, name), 'utf8'),
        ) as { file?: string; text?: string; readable?: boolean; source?: string };
        if (meta.source !== 'OCR' || !meta.file?.endsWith('.pdf')) continue;
        const pdf = readFileSync(resolve(FIXTURES_DIR, meta.file));
        // письма в fixtures одностраничные: текст эталона = страница 1
        const [page] = await renderPdfPages(pdf, [1]);
        if (page)
          fixturePhotos.set(sha256(page.data), {
            text: meta.text ?? '',
            readable: meta.readable !== false,
          });
      } catch {
        // повреждённый эталон пропускаем
      }
    }
  })();
  return scanPagesLoaded;
}

/** explain в режиме demo: короткое объяснение из фактов, каждое утверждение со ссылкой на факты. */
export type DemoLang = 'ru' | 'uk' | 'de';
/** L07: код языка из переменной lang; старые версии промптов без неё — русский. */
export function demoLang(v: string | undefined): DemoLang {
  return v === 'uk' || v === 'de' ? v : 'ru';
}

const DEMO_EXPLAIN_TEXT: Record<DemoLang, { from: (a: string) => string; generic: string; asks: string; until: (d: string) => string }> = {
  ru: { from: (a) => `Письмо от ведомства ${a}.`, generic: 'Письмо из ведомства.', asks: 'Ведомство просит:', until: (d) => `Срок: до ${d}.` },
  uk: { from: (a) => `Лист від відомства ${a}.`, generic: 'Лист від відомства.', asks: 'Відомство просить:', until: (d) => `Строк: до ${d}.` },
  de: { from: (a) => `Brief vom Amt ${a}.`, generic: 'Brief vom Amt.', asks: 'Das Amt möchte:', until: (d) => `Frist: bis ${d}.` },
};

export function demoExplain(factsJson: string, lang: DemoLang = 'ru'): unknown {
  const L = DEMO_EXPLAIN_TEXT[lang];
  const facts = JSON.parse(factsJson) as {
    id: string;
    kind: string;
    value: string;
  }[];
  const de = (iso: string) => iso.split('-').reverse().join('.');
  const authority = facts.find((f) => f.kind === 'AUTHORITY');
  const about = authority
    ? {
        text: L.from(authority.value),
        claimIds: [authority.id],
      }
    : { text: L.generic, claimIds: [facts[0].id] };
  const actions = [
    ...facts
      .filter((f) => f.kind === 'REQUIREMENT')
      .map((f) => ({
        text: `${L.asks} ${demoRequestRu(f.value, lang) ?? f.value}`,
        claimIds: [f.id],
      })),
    ...facts
      .filter((f) => f.kind === 'DEADLINE')
      .map((f) => ({ text: L.until(de(f.value)), claimIds: [f.id] })),
  ].slice(0, 5);
  const requests = facts
    .filter((f) => f.kind === 'REQUIREMENT')
    .map((f) => ({ claimId: f.id, ru: demoRequestRu(f.value, lang) }))
    .filter((q): q is { claimId: string; ru: string } => q.ru !== null);
  return { about, actions, requests };
}

/** Словарь demo для синтетических писем (fixtures/letters): документ → по-русски. */
const DEMO_DOCUMENTS: [RegExp, string, string, string][] = [
  [/kontoauszüge/i, 'выписки с банковского счёта', 'виписки з банківського рахунку', 'Kontoauszüge'],
  [/einkommensnachweis/i, 'справки о доходах', 'довідки про доходи', 'Einkommensnachweise'],
  [/mietvertrag/i, 'договор аренды', 'договір оренди', 'den Mietvertrag'],
  [/mietbescheinigung/i, 'справку от арендодателя', 'довідку від орендодавця', 'die Mietbescheinigung'],
  [/reisepass/i, 'копию загранпаспорта', 'копію закордонного паспорта', 'eine Kopie vom Reisepass'],
  [/geburtsurkunde/i, 'свидетельство о рождении ребёнка', 'свідоцтво про народження дитини', 'die Geburtsurkunde vom Kind'],
  [/schulbescheinigung/i, 'справку из школы', 'довідку зі школи', 'die Schulbescheinigung'],
  [/anschrift/i, 'ваш адрес', 'вашу адресу', 'Ihre Adresse'],
];
const DEMO_VERBS: Record<DemoLang, { confirm: string; show: string; send: string; sept: string; again: string; and: string }> = {
  ru: { confirm: 'Подтвердить', show: 'Предъявить', send: 'Прислать', sept: ' за сентябрь', again: ' ещё раз', and: ' и ' },
  uk: { confirm: 'Підтвердити', show: 'Показати', send: 'Надіслати', sept: ' за вересень', again: ' ще раз', and: ' і ' },
  de: { confirm: 'Bestätigen', show: 'Zeigen', send: 'Schicken', sept: ' für September', again: ' noch einmal', and: ' und ' },
};

/**
 * explain.v2 в режиме demo: перевод требования по словарю. Неизвестное требование — null
 * (сайт покажет только немецкий текст).
 */
export function demoRequestRu(value: string, lang: DemoLang = 'ru'): string | null {
  const col = lang === 'uk' ? 2 : lang === 'de' ? 3 : 1;
  const docs = DEMO_DOCUMENTS.filter(([re]) => re.test(value)).map((d) => d[col]);
  if (docs.length === 0) return null;
  const V = DEMO_VERBS[lang];
  const verb = /bestätig/i.test(value)
    ? V.confirm
    : /vorlegen|legen .* vor/i.test(value)
      ? V.show
      : V.send;
  const month = /september/i.test(value) ? V.sept : '';
  const again = /erneut/i.test(value) ? V.again : '';
  return `${verb}${again}: ${docs.join(V.and)}${month}.`;
}

/**
 * Демо-перевод (поправка 7): без модели настоящего перевода нет. Частые фразы писем заменяются
 * по словарю, остальные строки остаются по-немецки. Первая строка честно говорит об этом.
 */
const DEMO_PHRASES: [RegExp, string][] = [
  [/^Sehr geehrte[rs]?\b.*,$/i, 'Уважаемый(ая) получатель,'],
  [/^Mit freundlichen Grüßen$/i, 'С уважением,'],
  [/^Ihre Sachbearbeitung$/i, 'Ваш отдел обработки'],
  [/^Betreff:\s*Unterlagen zu Ihrem Antrag$/i, 'Тема: документы к вашему заявлению'],
  [/^Datum:/i, 'Дата:'],
  [/^Aktenzeichen:/i, 'Номер дела (Aktenzeichen):'],
  [/^An:/i, 'Кому:'],
  [/^Bitte reichen Sie die Kontoauszüge für September ein\.$/i, 'Пожалуйста, пришлите выписки со счёта за сентябрь.'],
  [/^Bitte reichen Sie die Einkommensnachweise ein\.$/i, 'Пожалуйста, пришлите справки о доходах.'],
  [/^Bitte legen Sie den Mietvertrag vor\.$/i, 'Пожалуйста, предъявите договор аренды.'],
  [/^Bitte bestätigen Sie Ihre Anschrift\.$/i, 'Пожалуйста, подтвердите ваш адрес.'],
  [/^Bitte antworten Sie bis zum (\d{1,2}\.\d{1,2}\.\d{4})\.$/i, 'Пожалуйста, ответьте до $1.'],
  [/^Bei Rückfragen nennen Sie bitte das oben angegebene Aktenzeichen\.$/i, 'При вопросах называйте, пожалуйста, номер дела, указанный выше.'],
  [/^Diese Mitteilung betrifft ausschließlich die genannten Unterlagen\.$/i, 'Это сообщение касается только названных документов.'],
];

export const DEMO_TRANSLATE_NOTE =
  'Демо-режим: настоящего перевода нет. Переведены только частые фразы, остальное оставлено по-немецки.';

const DEMO_PHRASES_UK: Record<string, string> = {
  'Уважаемый(ая) получатель,': 'Шановний(а) отримувачу,',
  'С уважением,': 'З повагою,',
  'Ваш отдел обработки': 'Ваш відділ опрацювання',
  'Тема: документы к вашему заявлению': 'Тема: документи до вашої заяви',
  'Дата:': 'Дата:',
  'Номер дела (Aktenzeichen):': 'Номер справи (Aktenzeichen):',
  'Кому:': 'Кому:',
  'Пожалуйста, пришлите выписки со счёта за сентябрь.': 'Будь ласка, надішліть виписки з рахунку за вересень.',
  'Пожалуйста, пришлите справки о доходах.': 'Будь ласка, надішліть довідки про доходи.',
  'Пожалуйста, предъявите договор аренды.': 'Будь ласка, покажіть договір оренди.',
  'Пожалуйста, подтвердите ваш адрес.': 'Будь ласка, підтвердьте вашу адресу.',
  'Пожалуйста, ответьте до $1.': 'Будь ласка, відповідайте до $1.',
  'При вопросах называйте, пожалуйста, номер дела, указанный выше.': 'Якщо будуть питання, називайте, будь ласка, номер справи, зазначений вище.',
  'Это сообщение касается только названных документов.': 'Це повідомлення стосується лише названих документів.',
};
const DEMO_TRANSLATE_NOTES: Record<DemoLang, string> = {
  ru: 'Демо-режим: настоящего перевода нет. Переведены только частые фразы, остальное оставлено по-немецки.',
  uk: 'Демо-режим: справжнього перекладу немає. Перекладено лише часті фрази, решту залишено німецькою.',
  de: 'Demo-Modus: Es gibt keine echte Vereinfachung. Hier steht der Original-Text.',
};

export function demoTranslate(text: string, lang: DemoLang = 'ru'): { text: string } {
  if (lang === 'de') return { text: `${DEMO_TRANSLATE_NOTES.de}\n\n${text}` };
  const lines = text.split('\n').map((line) => {
    const t = line.trim();
    for (const [re, ruText] of DEMO_PHRASES) {
      const ru = lang === 'uk' ? (DEMO_PHRASES_UK[ruText] ?? ruText) : ruText;
      if (!re.test(t)) continue;
      // «Datum: 11.11.2026» → «Дата: 11.11.2026»: значение после двоеточия остаётся как в письме
      if (ru.endsWith(':')) return `${ru}${t.slice(t.indexOf(':') + 1)}`;
      return t.replace(re, ru);
    }
    return line;
  });
  return { text: `${lang === 'ru' ? DEMO_TRANSLATE_NOTE : DEMO_TRANSLATE_NOTES[lang]}\n\n${lines.join('\n')}` };
}

/** Название для extract.v3 в demo: ведомство и тема из строки Betreff, цитата — сама строка Betreff. */
export function demoTitle(
  text: string,
  lang: DemoLang = 'ru',
): { value: string; quote: string } | null {
  const lines = text.split('\n').map((l) => l.trim());
  const betreff = lines.find((l) => /^Betreff:/i.test(l));
  if (!betreff) return null;
  const authority = lines.find(
    (l) => AUTHORITY.test(l) && !/^(An|Betreff)\b/.test(l),
  );
  const subject = /Unterlagen zu Ihrem Antrag/i.test(betreff)
    ? { ru: 'документы к заявлению', uk: 'документи до заяви', de: 'Unterlagen zum Antrag' }[lang]
    : betreff.replace(/^Betreff:\s*/i, '');
  const short = authority?.split(/\s+/)[0];
  const value = (short ? `${short}: ${subject}` : subject).slice(0, 60);
  return { value, quote: betreff };
}

/**
 * Демо-чат (24.11): без модели Ja!sno ищет самый похожий вопрос в FAQ и отвечает его текстом.
 * Не нашёл — честно говорит, что в демо-режиме отвечает только по частым вопросам.
 */
export const DEMO_CHAT_FALLBACK =
  'В демо-режиме Ja!sno отвечает только по частым вопросам, а на этот вопрос в FAQ ответа нет. ' +
  'С настоящей моделью Ja!sno ответит подробнее. Если вопрос о вашем письме, откройте его в кабинете: ' +
  'там объяснение по фактам с цитатами и сроки.';

const STOP = new Set(
  'как что где когда если меня мне можно нужно надо есть это эти этот такое какие какой какая почему зачем сколько через чтобы ли или для при про над под без от до'.split(
    ' ',
  ),
);

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-zäöüßа-яёіїєґ]{3,}/gi) ?? [])
    .filter((w) => !STOP.has(w))
    .map((w) => w.slice(0, 5)); // грубая основа слова: «письма», «письмо» → «письм»
}

const DEMO_CHAT_TEXT: Record<DemoLang, { fallback: string; similar: string }> = {
  ru: { fallback: '', similar: 'Похожий вопрос есть в FAQ' },
  uk: {
    fallback:
      'У демо-режимі Ja!sno відповідає лише на часті запитання, а на це запитання у FAQ відповіді немає. ' +
      'Зі справжньою моделлю Ja!sno відповість докладніше. Якщо питання про ваш лист, відкрийте його в кабінеті: ' +
      'там пояснення за фактами з цитатами і строки.',
    similar: 'Схоже запитання є у FAQ',
  },
  de: {
    fallback:
      'Im Demo-Modus antwortet Ja!sno nur mit den häufigen Fragen. Zu dieser Frage gibt es im FAQ keine Antwort. ' +
      'Mit dem echten KI-Modell antwortet Ja!sno genauer. Geht es um Ihren Brief? Öffnen Sie ihn im Konto: ' +
      'Dort stehen die Erklärung mit Zitaten und die Fristen.',
    similar: 'Eine ähnliche Frage steht im FAQ',
  },
};

export function demoChat(question: string, faq: string, lang: DemoLang = 'ru'): { answer: string } {
  const fallback = lang === 'ru' ? DEMO_CHAT_FALLBACK : DEMO_CHAT_TEXT[lang].fallback;
  const entries = faq
    .split(/^### /m)
    .slice(1)
    .map((block) => {
      const [title, ...rest] = block.split('\n');
      const body = rest
        .join('\n')
        .split(/^## /m)[0]
        .replace(/<!--[\s\S]*?-->/g, '')
        .trim();
      return { title: title.trim(), body };
    })
    .filter((e) => e.body);
  const q = new Set(words(question));
  let best: { title: string; body: string } | null = null;
  let bestScore = 0;
  for (const e of entries) {
    const inTitle = words(e.title).filter((w) => q.has(w)).length;
    const inBody = new Set(words(e.body).filter((w) => q.has(w))).size;
    const score = inTitle * 3 + inBody;
    if (score > bestScore) {
      best = e;
      bestScore = score;
    }
  }
  if (!best || bestScore < 3) return { answer: fallback };
  return { answer: `${DEMO_CHAT_TEXT[lang].similar}: «${best.title}»\n\n${best.body}` };
}
