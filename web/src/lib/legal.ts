import { t, type Lang } from '../i18n';
/**
 * Поправка 2 (23.11): данные ответственного для Impressum, Datenschutz и AGB.
 * Пока заглушки в квадратных скобках: настоящие данные вписывает команда, текст проверяет юрист.
 */
export function operator(lang?: Lang) {
  return {
    name: t('[Имя и фамилия]', undefined, lang),
    street: t('[Улица и дом]', undefined, lang),
    city: t('[Индекс и город]', undefined, lang),
    email: '[E-Mail]',
    phone: t('[Телефон]', undefined, lang),
  } as const;
}

export const OPERATOR = operator();
