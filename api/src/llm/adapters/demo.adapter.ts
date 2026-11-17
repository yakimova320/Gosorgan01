import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AdapterError,
  type AdapterRequest,
  type AdapterResponse,
  type LlmAdapter,
} from '../llm.types.js';

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
    extract: (v) => demoExtract(v.letterText ?? ''),
    explain: (v) => demoExplain(v.facts ?? '[]'),
    transcribe: (_v, request) =>
      demoTranscribe(request.images.map((i) => i.data)),
  };

  async complete(request: AdapterRequest): Promise<AdapterResponse> {
    const handler = this.handlers[request.promptName];
    if (!handler)
      throw new AdapterError(
        'BAD_REQUEST',
        `demo: нет правил для промпта ${request.promptName}`,
      );
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
  fixturePhotos ??= loadFixturePhotos();
  const known = images[0] ? fixturePhotos.get(sha256(images[0])) : undefined;
  if (!known) return { text: '', readable: false, reason: 'DEMO_UNKNOWN' };
  if (!known.readable) return { text: '', readable: false, reason: 'BLURRY' };
  return { text: known.text, readable: true, reason: null };
}

/** explain в режиме demo: короткое объяснение из фактов, каждое утверждение со ссылкой на факты. */
export function demoExplain(factsJson: string): unknown {
  const facts = JSON.parse(factsJson) as {
    id: string;
    kind: string;
    value: string;
  }[];
  const de = (iso: string) => iso.split('-').reverse().join('.');
  const authority = facts.find((f) => f.kind === 'AUTHORITY');
  const about = authority
    ? {
        text: `Письмо от ведомства ${authority.value}.`,
        claimIds: [authority.id],
      }
    : { text: 'Письмо из ведомства.', claimIds: [facts[0].id] };
  const actions = [
    ...facts
      .filter((f) => f.kind === 'REQUIREMENT')
      .map((f) => ({ text: `Ведомство просит: ${f.value}`, claimIds: [f.id] })),
    ...facts
      .filter((f) => f.kind === 'DEADLINE')
      .map((f) => ({ text: `Срок: до ${de(f.value)}.`, claimIds: [f.id] })),
  ].slice(0, 5);
  return { about, actions };
}
