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
    (variables: Record<string, string>) => unknown
  > = {
    extract: (v) => demoExtract(v.letterText ?? ''),
  };

  async complete(request: AdapterRequest): Promise<AdapterResponse> {
    const handler = this.handlers[request.promptName];
    if (!handler)
      throw new AdapterError(
        'BAD_REQUEST',
        `demo: нет правил для промпта ${request.promptName}`,
      );
    return { text: JSON.stringify(handler(request.variables)) };
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

  return {
    authority: field(authorityLine, authorityLine ?? null),
    caseNumber: field(caseLine, caseValue),
    letterDate: dateMatch ? field(dateLine, toIso(dateMatch)) : empty,
    requirements,
    deadlines,
    amounts,
  };
}
