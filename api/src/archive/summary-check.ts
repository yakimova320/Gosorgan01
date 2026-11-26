import { MaskingService } from '../llm/masking.service.js';

const masking = new MaskingService();

export interface LetterSummaryText {
  de: string;
  local: string;
}

/**
 * E01 (#163): резюме письма для поиска по архиву должно быть обезличенным. Его вектор лежит открыто.
 * Отклоняется резюме, в котором маскирование находит личные данные (IBAN, e-mail, телефон, номера),
 * есть метки [..._N], числа из 4 и больше цифр или имя, фамилия и улица из профиля (целыми словами).
 * Отклонено: null, письмо в поиск по архиву не попадает.
 */
export function checkSummary(
  summary: LetterSummaryText | null,
  profile: { firstName?: string | null; lastName?: string | null; address?: string | null } | null,
): LetterSummaryText | null {
  if (!summary) return null;
  const text = `${summary.de}\n${summary.local}`;
  const table = new Map<string, string>();
  masking.mask(text, table);
  if (table.size > 0) return null;
  if (/\[[A-Z]+_\d+\]/.test(text) || /\d{4,}/.test(text.replace(/\s/g, ''))) return null;
  // имя, фамилия и улица из профиля — целыми словами (город и индекс личность не выдают)
  const words = new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const street = (profile?.address ?? '').split(',')[0] ?? '';
  const personal = [profile?.firstName, profile?.lastName, ...street.split(/[\s.]+/)]
    .map((w) => w?.trim().toLowerCase() ?? '')
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !/^(str|straße|strasse|weg|platz|allee)$/.test(w));
  if (personal.some((w) => words.has(w))) return null;
  return summary;
}

/** Текст для вектора: немецкое резюме и резюме на языке кабинета (вопрос можно задать на любом). */
export const summaryForEmbedding = (s: LetterSummaryText) => `${s.de}\n${s.local}`;
