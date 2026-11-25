import { useSyncExternalStore } from 'react';
import de from './de.json';
import uk from './uk.json';

/*
 * L07 (#83): языки сайта. Ключ перевода — сам русский текст: t('Войти').
 * Русский — исходный язык, словаря для него нет. Украинский и простой немецкий — в uk.json и de.json.
 * Тест i18n.test.ts проверяет, что у каждого t('…') в коде есть оба перевода.
 * Язык хранится в localStorage (jasno.lang); после входа главный — язык кабинета (Cabinet.language).
 */

export const LANGS = ['ru', 'uk', 'de'] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_NAMES: Record<Lang, string> = {
  ru: 'Русский',
  uk: 'Українська',
  de: 'Deutsch (einfach)',
};

export const LANG_SHORT: Record<Lang, string> = { ru: 'RU', uk: 'UA', de: 'DE' };

/** Языки «скоро»: в переключателе видны, но выбрать нельзя. */
export const SOON_LANGS: { code: string; name: string }[] = [
  { code: 'tr', name: 'Türkçe' },
  { code: 'ar', name: 'العربية' },
  { code: 'es', name: 'Español' },
  { code: 'cs', name: 'Čeština' },
];

const DICTS: Record<Exclude<Lang, 'ru'>, Record<string, string>> = { uk, de };
const KEY = 'jasno.lang';

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}

/** Язык браузера: uk → украинский, de → немецкий, остальное → русский. */
export function browserLang(languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages ?? []): Lang {
  for (const l of languages) {
    const base = l.toLowerCase().split('-')[0];
    if (base === 'uk') return 'uk';
    if (base === 'de') return 'de';
    if (base === 'ru') return 'ru';
  }
  return 'ru';
}

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch {
    // нет доступа к localStorage: язык браузера
  }
  return browserLang();
}

let current: Lang = initial();
const listeners = new Set<() => void>();

function applyHtmlLang(lang: Lang) {
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}
applyHtmlLang(current);

export function getLang(): Lang {
  return current;
}

/** Сменить язык. reload: перезагрузить страницу, чтобы все тексты (и константы модулей) взяли новый язык. */
export function setLang(lang: Lang, options: { reload?: boolean } = { reload: true }): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // не запомнится, но работает до перезагрузки
  }
  applyHtmlLang(lang);
  listeners.forEach((l) => l());
  if (options.reload && typeof window !== 'undefined') window.location.reload();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Текущий язык; компонент перерисовывается при смене. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

type Vars = Record<string, string | number>;

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Перевод по русскому тексту. Нет перевода — русский текст (и предупреждение в разработке). */
export function t(ru: string, vars?: Vars, lang: Lang = current): string {
  if (lang === 'ru') return fill(ru, vars);
  const hit = DICTS[lang][ru];
  if (hit === undefined && import.meta.env?.DEV) console.warn(`[i18n] нет перевода ${lang}: ${ru}`);
  return fill(hit ?? ru, vars);
}

/**
 * Множественное число: forms — русские формы «1 | 2 | 5» через «|», например
 * tn('{n} день|{n} дня|{n} дней', n). Перевод — тоже строка с формами своего языка через «|».
 */
export function tn(forms: string, n: number, vars?: Vars, lang: Lang = current): string {
  const translated = lang === 'ru' ? forms : (DICTS[lang][forms] ?? forms);
  const parts = translated.split('|');
  const rule = new Intl.PluralRules(lang).select(n);
  // ru, uk: one | few | many; de: one | other
  const index = parts.length === 2 ? (rule === 'one' ? 0 : 1) : rule === 'one' ? 0 : rule === 'few' ? 1 : 2;
  return fill(parts[Math.min(index, parts.length - 1)], { n, ...vars });
}

/**
 * Текст проверки (Zod из packages/shared или ответ сервера) на языке сайта.
 * Тексты с числом переводятся по шаблону, остальные — как обычный ключ.
 */
const MSG_PATTERNS: [RegExp, string][] = [
  [/^Не больше (\d+) знаков$/, 'Не больше {n} знаков'],
  [/^Не больше (\d+) номеров$/, 'Не больше {n} номеров'],
  [/^Пароль: не меньше (\d+) знаков$/, 'Пароль: не меньше {n} знаков'],
  [/^Пожалуйста, объясните, из чего складывается сумма (.+) €\.$/, 'Пожалуйста, объясните, из чего складывается сумма {n} €.'],
];
/**
 * Тексты, которые сервер собирает кодом по-русски (факты, история, основания черновика):
 * «Ведомство: Jobcenter», «Срок: до 30.11.2026 (ответить)», «Фактов: 3». Значение остаётся как есть.
 */
const RULES: [RegExp, (m: RegExpExecArray, lang: Lang) => string | null][] = [
  [/^(.+) \(исправлено вами\)$/, (m, l) => `${tMsg(m[1], l)} (${t('исправлено вами', undefined, l)})`],
  [/^Срок: до (\S+) \((.+)\)$/, (m, l) => t('Срок: до {n} ({k})', { n: m[1], k: t(m[2], undefined, l) }, l)],
  [/^Срок: до (\S+)$/, (m, l) => t('Срок: до {n}', { n: m[1] }, l)],
  [/^Срок без точной даты: «(.+)»\. Точную дату нужно уточнить$/, (m, l) => t('Срок без точной даты: «{n}». Точную дату нужно уточнить', { n: m[1] }, l)],
  [/^Фактов: (\d+)$/, (m, l) => t('Фактов: {n}', { n: m[1] }, l)],
  [/^(Почтой|Онлайн|По e-mail|Лично|Другим способом) · (.+)$/, (m, l) => `${t(m[1], undefined, l)} · ${m[2]}`],
  // «Подпись: значение», если подпись есть в словаре
  [/^([^:]{2,60}): (.+)$/s, (m, l) => (DICTS[l as Exclude<Lang, 'ru'>][m[1]] ? `${DICTS[l as Exclude<Lang, 'ru'>][m[1]]}: ${m[2]}` : null)],
];

export function tMsg(message: string, lang: Lang = current): string {
  if (lang === 'ru') return message;
  const exact = DICTS[lang][message];
  if (exact !== undefined) return exact;
  for (const [re, key] of MSG_PATTERNS) {
    const m = re.exec(message);
    if (m) return t(key, { n: m[1] }, lang);
  }
  for (const [re, fn] of RULES) {
    const m = re.exec(message);
    if (m) {
      const r = fn(m, lang);
      if (r !== null) return r;
    }
  }
  return message;
}

/** Локаль для дат и чисел. */
export function locale(lang: Lang = current): string {
  return lang === 'uk' ? 'uk-UA' : lang === 'de' ? 'de-DE' : 'ru-RU';
}

/** Все ключи словаря (для проверки полноты в тестах). */
export const DICT_KEYS = { uk: Object.keys(uk), de: Object.keys(de) };
