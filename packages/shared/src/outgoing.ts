import { z } from 'zod';

/*
 * B16: собственные письма по шаблонам (ТЗ v3 раздел 6.6 и 9: GET /templates, POST /outgoing).
 * Шесть шаблонов без входящего письма. Каталог и проверка полей общие для api и web;
 * немецкие формулировки писем живут только на сервере (api/src/drafting/outgoing).
 * Поля, которые попадают в немецкий текст как есть, пишутся по-немецки: кириллица не допускается.
 */

export const OUTGOING_TEMPLATE_IDS = [
  'KUENDIGUNG',
  'AENDERUNG',
  'NEUES_KONTO',
  'BESCHWERDE',
  'SACHSTANDSANFRAGE',
  'FRISTVERLAENGERUNG',
] as const;
export type OutgoingTemplateId = (typeof OUTGOING_TEMPLATE_IDS)[number];

export type OutgoingFieldType = 'text' | 'reference' | 'date' | 'iban' | 'select';

export interface OutgoingField {
  key: string;
  type: OutgoingFieldType;
  labelRu: string;
  hintRu?: string;
  required: boolean;
  /** select: готовые варианты, немецкая фраза к каждому на сервере */
  options?: { id: string; ru: string }[];
}

export interface OutgoingTemplate {
  id: OutgoingTemplateId;
  titleRu: string;
  titleDe: string;
  descriptionRu: string;
  /** предупреждение на экране деталей (например, жалоба не заменяет Widerspruch) */
  noteRu?: string;
  fields: OutgoingField[];
}

const reference: OutgoingField = {
  key: 'reference',
  type: 'reference',
  labelRu: 'Номер дела или клиента',
  hintRu: 'Aktenzeichen, Kundennummer или BG-Nummer из прошлых писем. Можно оставить пустым',
  required: false,
};

export const EXTENSION_REASON_OPTIONS = [
  { id: 'DOCUMENTS_PENDING', ru: 'Мне нужно больше времени, чтобы собрать документы' },
  { id: 'ADVICE', ru: 'Я хочу сначала получить консультацию' },
  { id: 'NONE', ru: 'Без указания причины' },
];

export const OUTGOING_TEMPLATES: OutgoingTemplate[] = [
  {
    id: 'KUENDIGUNG',
    titleRu: 'Расторжение договора',
    titleDe: 'Kündigung',
    descriptionRu: 'Расторгнуть договор или членство и попросить письменное подтверждение.',
    fields: [
      reference,
      {
        key: 'subject',
        type: 'text',
        labelRu: 'Что расторгаете (по-немецки)',
        hintRu: 'Например: Mitgliedschaft im Sportverein, Mobilfunkvertrag',
        required: true,
      },
      {
        key: 'endDate',
        type: 'date',
        labelRu: 'С какой даты',
        hintRu: 'Пусто: в ближайший возможный срок',
        required: false,
      },
    ],
  },
  {
    id: 'AENDERUNG',
    titleRu: 'Сообщение об изменениях',
    titleDe: 'Änderungsmitteilung',
    descriptionRu: 'Сообщить о переезде, новой работе, конце работы или изменениях в семье.',
    fields: [
      reference,
      {
        key: 'change',
        type: 'select',
        labelRu: 'Что изменилось',
        required: true,
        options: [
          { id: 'ADDRESS', ru: 'Я переехал(а): новый адрес из профиля' },
          { id: 'JOB_START', ru: 'Я начал(а) работать' },
          { id: 'JOB_END', ru: 'Моя работа закончилась' },
          { id: 'INCOME', ru: 'Изменился мой доход' },
          { id: 'HOUSEHOLD', ru: 'Изменился состав семьи' },
        ],
      },
      { key: 'date', type: 'date', labelRu: 'С какой даты', required: true },
      {
        key: 'details',
        type: 'text',
        labelRu: 'Подробности (по-немецки)',
        hintRu: 'Например: Arbeitgeber Muster GmbH. Можно оставить пустым',
        required: false,
      },
    ],
  },
  {
    id: 'NEUES_KONTO',
    titleRu: 'Новый банковский счёт',
    titleDe: 'Neue Bankverbindung',
    descriptionRu: 'Сообщить новый IBAN, чтобы деньги приходили на новый счёт.',
    fields: [
      reference,
      { key: 'iban', type: 'iban', labelRu: 'Новый IBAN', hintRu: 'Например: DE89 3704 0044 0532 0130 00', required: true },
      {
        key: 'holder',
        type: 'text',
        labelRu: 'Владелец счёта',
        hintRu: 'Пусто: ваше имя из профиля',
        required: false,
      },
      { key: 'validFrom', type: 'date', labelRu: 'С какой даты', hintRu: 'Можно оставить пустым', required: false },
    ],
  },
  {
    id: 'BESCHWERDE',
    titleRu: 'Жалоба',
    titleDe: 'Beschwerde',
    descriptionRu: 'Пожаловаться, что нет ответа, рассмотрение идёт долго или с вами плохо обошлись.',
    noteRu:
      'Жалоба не заменяет возражение (Widerspruch). Если вы не согласны с решением ведомства, обратитесь в консультацию.',
    fields: [
      reference,
      {
        key: 'reason',
        type: 'select',
        labelRu: 'На что жалуетесь',
        required: true,
        options: [
          { id: 'NO_REPLY', ru: 'Нет ответа на моё письмо или заявление' },
          { id: 'LONG_PROCESSING', ru: 'Рассмотрение идёт слишком долго' },
          { id: 'CONDUCT', ru: 'Со мной плохо обошлись сотрудники' },
        ],
      },
      {
        key: 'since',
        type: 'date',
        labelRu: 'Дата вашего письма, заявления или встречи',
        hintRu: 'Можно оставить пустым',
        required: false,
      },
      {
        key: 'details',
        type: 'text',
        labelRu: 'Подробности (по-немецки)',
        hintRu: 'Коротко, без оскорблений. Можно оставить пустым',
        required: false,
      },
    ],
  },
  {
    id: 'SACHSTANDSANFRAGE',
    titleRu: 'Запрос о ходе рассмотрения',
    titleDe: 'Sachstandsanfrage',
    descriptionRu: 'Спросить, как идёт рассмотрение вашего заявления.',
    fields: [
      reference,
      {
        key: 'subject',
        type: 'text',
        labelRu: 'Что вы подавали (по-немецки)',
        hintRu: 'Например: Antrag auf Wohngeld',
        required: true,
      },
      { key: 'submitted', type: 'date', labelRu: 'Когда подали', required: true },
    ],
  },
  {
    id: 'FRISTVERLAENGERUNG',
    titleRu: 'Продление срока',
    titleDe: 'Fristverlängerung',
    descriptionRu: 'Попросить больше времени на ответ или документы.',
    fields: [
      reference,
      {
        key: 'letterDate',
        type: 'date',
        labelRu: 'Дата письма ведомства',
        hintRu: 'Можно оставить пустым',
        required: false,
      },
      { key: 'deadline', type: 'date', labelRu: 'Текущий срок', required: true },
      {
        key: 'newDate',
        type: 'date',
        labelRu: 'До какой даты продлить',
        hintRu: 'Пусто: ведомство само назначит новый срок',
        required: false,
      },
      {
        key: 'reason',
        type: 'select',
        labelRu: 'Причина',
        required: true,
        options: EXTENSION_REASON_OPTIONS,
      },
    ],
  },
];

export function outgoingTemplate(id: string): OutgoingTemplate | undefined {
  return OUTGOING_TEMPLATES.find((t) => t.id === id);
}

const NO_CYRILLIC = /^[^\p{Script=Cyrillic}]*$/u;
/** Метки шаблона, угловые скобки и переводы строк в однострочном поле не допускаются. */
const NO_MARKERS = /^[^{}<>\n\r\t]*$/;

/** IBAN: две буквы страны, две цифры контроля, до 30 букв и цифр; контрольная сумма по ISO 13616. */
export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}
export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith('DE') && iban.length !== 22) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const n = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of n) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}
/** IBAN для письма: группы по четыре знака, как на банковских документах. */
export function formatIban(raw: string): string {
  return normalizeIban(raw).replace(/(.{4})(?=.)/g, '$1 ');
}

const germanLine = (max: number, latinMessage: string) =>
  z
    .string()
    .trim()
    .max(max, { message: `Не больше ${max} знаков` })
    .regex(NO_CYRILLIC, { message: latinMessage })
    .regex(NO_MARKERS, { message: 'Без фигурных и угловых скобок, в одну строку' })
    .refine((v) => !/…|\.\.\./.test(v), { message: 'Без многоточия: напишите полностью' });

export const OutgoingRecipientSchema = z
  .object({
    name: germanLine(120, 'Название ведомства латиницей, как в его письмах').min(2, {
      message: 'Введите название ведомства',
    }),
    address: z
      .string()
      .trim()
      .min(5, { message: 'Введите адрес ведомства' })
      .max(300, { message: 'Не больше 300 знаков' })
      .regex(NO_CYRILLIC, { message: 'Адрес латиницей, как в письмах ведомства' })
      .regex(/^[^{}<>]*$/, { message: 'Без фигурных и угловых скобок' })
      .refine((v) => !/…|\.\.\./.test(v), { message: 'Без многоточия: напишите полностью' }),
  })
  .strict();
export type OutgoingRecipient = z.infer<typeof OutgoingRecipientSchema>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isRealDate(v: string): boolean {
  if (!ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Ошибка одного поля шаблона (null: всё в порядке). Пустое значение необязательного поля допустимо. */
export function outgoingFieldError(field: OutgoingField, raw: string | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return field.required ? (field.type === 'select' ? 'Выберите вариант' : 'Заполните поле') : null;
  switch (field.type) {
    case 'text': {
      const r = germanLine(200, 'По-немецки, латинскими буквами').safeParse(v);
      return r.success ? null : r.error.issues[0].message;
    }
    case 'reference': {
      const r = germanLine(80, 'Номер латинскими буквами и цифрами').safeParse(v);
      return r.success ? null : r.error.issues[0].message;
    }
    case 'date':
      return isRealDate(v) ? null : 'Дата в формате ГГГГ-ММ-ДД';
    case 'iban':
      return isValidIban(v) ? null : 'Проверьте IBAN: в нём ошибка';
    case 'select':
      return field.options?.some((o) => o.id === v) ? null : 'Выберите вариант';
  }
}

/** Проверки, где поля зависят друг от друга. Сравнение с «сегодня» делает только сервер. */
function crossFieldErrors(templateId: OutgoingTemplateId, f: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (templateId === 'FRISTVERLAENGERUNG') {
    if (f.newDate && f.deadline && f.newDate <= f.deadline)
      out.newDate = 'Новая дата должна быть позже текущего срока';
    if (f.letterDate && f.deadline && f.letterDate > f.deadline)
      out.letterDate = 'Дата письма не может быть позже срока';
  }
  return out;
}

/**
 * POST /outgoing: шаблон, адресат и поля. Неизвестные поля отклоняются.
 * Ошибки полей по пути fields.<key> (как у остальных форм, TechBriefing v5 5.2).
 */
export const OutgoingSchema = z
  .object({
    templateId: z.enum(OUTGOING_TEMPLATE_IDS, { message: 'Выберите шаблон' }),
    recipient: OutgoingRecipientSchema,
    fields: z.record(z.string(), z.string().max(400, { message: 'Слишком длинное значение' })),
  })
  .strict()
  .superRefine((input, ctx) => {
    const template = outgoingTemplate(input.templateId)!;
    const known = new Set(template.fields.map((f) => f.key));
    for (const key of Object.keys(input.fields))
      if (!known.has(key))
        ctx.addIssue({ code: 'custom', path: ['fields', key], message: 'Такого поля нет в шаблоне' });
    for (const field of template.fields) {
      const message = outgoingFieldError(field, input.fields[field.key]);
      if (message) ctx.addIssue({ code: 'custom', path: ['fields', field.key], message });
    }
    const trimmed = Object.fromEntries(Object.entries(input.fields).map(([k, v]) => [k, v.trim()]));
    for (const [key, message] of Object.entries(crossFieldErrors(input.templateId, trimmed)))
      ctx.addIssue({ code: 'custom', path: ['fields', key], message });
  });
export type OutgoingInput = z.infer<typeof OutgoingSchema>;
