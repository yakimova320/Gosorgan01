/*
 * Общий текст срока для файла .ics (B12), ленты календаря и письма-напоминания (K12).
 * Только вид срока и ведомство: текста письма и личных номеров здесь нет.
 */

const KIND_RU: Record<string, string> = {
  REPLY: 'ответить',
  DOCUMENTS: 'прислать документы',
  OBJECTION: 'возражение',
  FOLLOW_UP: 'напоминание',
};

export function deadlineWhat(kind: string): string {
  return KIND_RU[kind] ?? 'срок';
}

/** «Срок: ответить — Jobcenter» */
export function deadlineSummary(kind: string, authority?: string | null): string {
  return `Срок: ${deadlineWhat(kind)}${authority ? ` — ${authority}` : ''}`;
}

export const DEADLINE_CHECK_NOTE =
  'Срок из письма, подтверждённый в Ja!sno. Проверьте дату по оригиналу письма.';

/** Ссылка на дело, а для письма во входящих — на письмо. */
export function deadlineLink(
  appUrl: string,
  d: { caseId: string | null; letterId: string },
): string {
  const base = appUrl.replace(/\/+$/, '');
  return d.caseId ? `${base}/app/cases/${d.caseId}` : `${base}/app/letters/${d.letterId}`;
}
