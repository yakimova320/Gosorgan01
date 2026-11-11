import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service.js';
import { ConfigService } from '@nestjs/config';
import { ExtractedLetterSchema } from './schemas.js';
import type { ParsedDocument } from '../documents/types.js';
export const normalize = (s: string) =>
  s.normalize('NFKC').replace(/\s+/g, ' ').trim();
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[b.length];
}
export function quoteMatches(
  text: string,
  quote: string,
  ocr: boolean,
  threshold: number,
): boolean {
  if (!ocr) return text.includes(quote);
  const source = normalize(text),
    target = normalize(quote);
  if (source.includes(target)) return true;
  const tolerance = Math.floor(target.length * threshold);
  if (!tolerance || target.length > 1000) return false;
  // Word-aligned windows bound fuzzy matching cost; small OCR errors only.
  const words = source.split(' '),
    size = target.split(' ').length;
  for (let i = 0; i < words.length; i++)
    for (const n of [size - 1, size, size + 1]) {
      if (n < 1) continue;
      const candidate = words.slice(i, i + n).join(' ');
      if (
        Math.abs(candidate.length - target.length) <= tolerance &&
        editDistance(candidate, target) <= tolerance
      )
        return true;
    }
  return false;
}
@Injectable()
export class ExtractionService {
  constructor(
    @Inject(LlmService) private readonly llm: LlmService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}
  async extract(text: string, caseId?: string, document?: ParsedDocument) {
    const extracted = await this.llm.call({
      promptName: 'extract',
      variables: {
        text,
        pages: document?.pages.map((p, i) => ({ page: i + 1, text: p.text })),
      },
      schema: ExtractedLetterSchema,
      caseId,
    });
    const pages = document?.pages ?? [{ text, confidence: 100 }];
    const ocr = document?.source === 'OCR';
    const threshold = this.config.getOrThrow<number>('OCR_QUOTE_DISTANCE');
    const evidence = (quote: string | null, requested: number | null) => {
      if (!quote) return null;
      const index =
        requested === null
          ? pages.findIndex((p) => quoteMatches(p.text, quote, ocr, threshold))
          : requested - 1;
      const page = pages[index];
      return page && quoteMatches(page.text, quote, ocr, threshold)
        ? { page: index + 1, confidence: page.confidence / 100 }
        : null;
    };
    const grounded = (value: string, quote: string) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [year, month, day] = value.split('-');
        return (
          quote.includes(value) || quote.includes(`${day}.${month}.${year}`)
        );
      }
      return normalize(quote).includes(normalize(value));
    };
    for (const field of [
      extracted.authority,
      extracted.caseNumber,
      extracted.letterDate,
      ...extracted.requirements,
    ]) {
      const found = evidence(field.quote, field.page);
      if (
        !found ||
        !field.value ||
        !field.quote ||
        !grounded(field.value, field.quote)
      ) {
        field.value = null;
        field.quote = null;
        field.page = null;
        field.confidence = 0;
      } else {
        field.page = found.page;
        field.confidence = Math.min(field.confidence, found.confidence);
      }
    }
    extracted.deadlines = extracted.deadlines.filter((d) => {
      const found = evidence(d.quote, d.page);
      if (!found || !grounded(d.date, d.quote)) return false;
      d.page = found.page;
      d.confidence = Math.min(d.confidence, found.confidence);
      return true;
    });
    return extracted;
  }
}
