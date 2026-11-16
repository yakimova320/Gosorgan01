import { Injectable } from '@nestjs/common';

/** Таблица замен одного вызова: метка → исходное значение. Живёт только в памяти. */
export type MaskTable = Map<string, string>;

interface Rule {
  label: string;
  pattern: RegExp;
  /** Номер группы со значением (если вокруг значения есть подпись, например «BIC:»). */
  group?: number;
  accept?: (value: string) => boolean;
}

const digits = (s: string) => s.replace(/\D/g, '').length;

/**
 * Порядок важен: сначала длинные и точные шаблоны (e-mail, IBAN), потом номера.
 * BIC ищется только рядом со словом BIC/SWIFT: иначе под шаблон попадают слова из заглавных букв.
 */
const RULES: Rule[] = [
  {
    label: 'EMAIL',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    label: 'IBAN',
    pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g,
  },
  {
    label: 'BIC',
    pattern:
      /\b(?:BIC|SWIFT)(?:-Code)?[:\s]+([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/g,
    group: 1,
  },
  // Номер социального страхования: 12 345678 A 123
  { label: 'SVNR', pattern: /\b\d{2} ?\d{6} ?[A-Z] ?\d{3}\b/g },
  // Steuer-ID: 11 цифр, можно с пробелами (12 345 678 901)
  {
    label: 'TAXID',
    pattern: /\b\d{2} ?\d{3} ?\d{3} ?\d{3}\b/g,
    accept: (v) => digits(v) === 11,
  },
  {
    label: 'PHONE',
    pattern: /(?:\+49|\b0049|\b0)[\d /()-]{5,}\d/g,
    accept: (v) => digits(v) >= 7 && digits(v) <= 15,
  },
];

@Injectable()
export class MaskingService {
  /** Маскирует строку. Одинаковые значения получают одинаковую метку. */
  mask(text: string, table: MaskTable): string {
    let out = text;
    for (const rule of RULES) {
      out = out.replace(rule.pattern, (...args: unknown[]) => {
        const whole = args[0] as string;
        const value = rule.group ? (args[rule.group] as string) : whole;
        if (rule.accept && !rule.accept(value)) return whole;
        const label = this.labelFor(rule.label, value, table);
        return rule.group ? whole.replace(value, label) : label;
      });
    }
    return out;
  }

  /** Возвращает исходные значения во все строки ответа модели (объекты и массивы обходятся целиком). */
  unmask<T>(value: T, table: MaskTable): T {
    if (table.size === 0) return value;
    if (typeof value === 'string') {
      return value.replace(
        /\[[A-Z]+_\d+\]/g,
        (label) => table.get(label) ?? label,
      ) as T;
    }
    if (Array.isArray(value))
      return value.map((v: unknown) => this.unmask(v, table)) as T;
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [
          k,
          this.unmask(v, table),
        ]),
      ) as T;
    }
    return value;
  }

  private labelFor(kind: string, value: string, table: MaskTable): string {
    for (const [label, original] of table) {
      if (original === value && label.startsWith(`[${kind}_`)) return label;
    }
    const n =
      [...table.keys()].filter((l) => l.startsWith(`[${kind}_`)).length + 1;
    const label = `[${kind}_${n}]`;
    table.set(label, value);
    return label;
  }
}
