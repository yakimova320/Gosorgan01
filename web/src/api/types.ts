/*
 * Типы данных, которые сайт получает от API.
 * Повторяют ТЗ v2 раздел 7–8 и ТЗ v4 раздел 8–9. Если сервер меняет ответ, меняется и этот файл.
 */

export type LlmMode = 'demo' | 'openai';

export interface Health {
  ok: true;
  llmMode: LlmMode;
  version: string;
}

export interface Profile {
  firstName?: string;
  lastName?: string;
  address?: string;
  /** Поправка 6: адрес по частям; address сервер собирает из них */
  street?: string;
  postalCode?: string;
  city?: string;
  numbers?: { label: string; value: string }[];
}

/** K12: GET /cabinet/calendar. feedPath: /calendar/<токен>.ics или null. */
export interface CalendarSettings {
  feedPath: string | null;
  reminderEmail: boolean;
}

export interface Cabinet {
  email: string;
  language: string;
  profile: Profile | null;
  counts: { openTasks: number; activeCases: number; inboxLetters: number };
  nextDeadline: { date: string; caseId: string; title: string } | null;
  /** K11 (#134): согласие на анализ письма ИИ (на текущую версию текста) */
  aiConsent: { given: boolean; at: string | null; version: number };
}

export type ClaimKind = 'AUTHORITY' | 'CASE_NUMBER' | 'LETTER_DATE' | 'REQUIREMENT' | 'DEADLINE' | 'AMOUNT' | 'OTHER';
export type ClaimStatus = 'UNCONFIRMED' | 'CONFIRMED' | 'REJECTED' | 'SUPERSEDED';
export type ClaimBasis = 'DOCUMENT' | 'USER';

export interface Claim {
  id: string;
  kind: ClaimKind;
  value: string;
  text: string;
  quote: string | null;
  page: number | null;
  basis: ClaimBasis;
  status: ClaimStatus;
}

export type DeadlineKind = 'REPLY' | 'DOCUMENTS' | 'OBJECTION' | 'FOLLOW_UP';

export interface Deadline {
  id: string;
  claimId: string;
  date: string; // ГГГГ-ММ-ДД, календарная дата
  kind: DeadlineKind;
  doneAt: string | null;
}

export interface Explanation {
  about: string;
  actions: { text: string; claimIds: string[] }[];
  deadline: { date: string; claimId: string } | null;
  unconfirmed: boolean;
}

export interface Letter {
  id: string;
  caseId: string | null;
  sourceType: 'PDF_TEXT' | 'IMAGE' | 'PDF_SCAN';
  rawText: string;
  pages: { n: number; readable: boolean; chars: number }[];
  createdAt: string;
  claims: Claim[];
  deadlines: Deadline[];
  explanation: Explanation | null;
}

export interface CaseSuggestion {
  caseId: string;
  title: string;
  reason: string;
}

export interface UploadResult {
  letter: Letter;
  claims: Claim[];
  deadlines: Deadline[];
  suggestions: CaseSuggestion[];
}

/** Статус дела, который считает сервер (ТЗ v4 раздел 8). */
export type CaseStage = 'CLOSED' | 'OVERDUE' | 'DOCUMENTS' | 'REPLY' | 'NEEDS_CHECK' | 'WAITING' | 'OPEN';

export interface CaseSummary {
  id: string;
  title: string;
  authority: string | null;
  caseNumber: string | null;
  origin: 'INCOMING' | 'OUTGOING';
  stage: CaseStage;
  nextDeadline: string | null;
  counts: { letters: number; unconfirmed: number };
  /** Поправка 14 (23.11): шаги дела, считает сервер. Нет (примерные данные): полоска по статусу. */
  progress?: CaseProgress;
  updatedAt: string;
}

export interface CaseProgress {
  done: number;
  total: number;
  percent: number;
  steps: { key: 'CHECK' | 'DEADLINES' | 'REPLY'; label: string; done: boolean }[];
}

export type DraftKind = 'CLARIFICATION' | 'DOCUMENTS' | 'EXTENSION' | 'STATUS_REQUEST';

export interface VerificationReport {
  passed: boolean;
  checks: { name: string; passed: boolean; details: string }[];
  checklist: { claimId: string; text: string; quote: string | null }[];
}

export interface Draft {
  id: string;
  kind: DraftKind;
  germanText: string;
  russianText: string;
  claimIds: string[];
  verification: VerificationReport;
  status: 'PREPARED' | 'SENT';
  sentAt: string | null;
  sentVia: string | null;
  stale: boolean;
  createdAt: string;
}

export type TimelineType =
  | 'LETTER_RECEIVED'
  | 'CASE_CREATED_FROM_LETTER'
  | 'CLAIM_CONFIRMED'
  | 'CLAIM_REJECTED'
  | 'QUESTION_ASKED'
  | 'USER_REPORTED_SENT'
  | 'DRAFT_PREPARED'
  | 'DRAFT_SENT'
  | 'DEADLINE_DONE';

export interface TimelineItem {
  type: TimelineType;
  at: string;
  title: string;
  subtitle?: string;
  letterId?: string;
  draftId?: string;
}

export interface CaseDetail extends CaseSummary {
  letters: Letter[];
  claims: Claim[];
  deadlines: Deadline[];
  drafts: Draft[];
  timeline: TimelineItem[];
}

export interface HistoryItem extends TimelineItem {
  caseId: string;
  caseTitle: string;
}

export interface AssistantAnswer {
  answer: string;
  links: { label: string; path: string }[];
  cardIds: string[];
  showRegister: boolean;
}

// ---------- Письмо из API (B05, B06): GET /letters/:id и POST /letters ----------

/** Факт письма как его отдаёт сервер. Статусы и «исправлено вами» решает сервер. */
export interface LetterClaim {
  id: string;
  kind: ClaimKind;
  value: string;
  text: string;
  quote: string | null;
  page: number | null;
  basis: ClaimBasis;
  status: 'UNCONFIRMED' | 'CONFIRMED' | 'REJECTED';
  supersedesId: string | null;
  /** срок без точной даты («innerhalb von zwei Wochen») */
  relativeDeadline: boolean;
}

/** Срок письма. active: факт срока подтверждён; иначе кандидат. */
export interface LetterDeadline {
  id: string;
  claimId: string;
  date: string; // ГГГГ-ММ-ДД
  kind: DeadlineKind;
  active: boolean;
  done: boolean;
}

export interface LetterDetail {
  letter: {
    id: string;
    caseId: string | null;
    sourceType: 'PDF_TEXT' | 'IMAGE' | 'PDF_SCAN';
    text: string;
    pages: { n: number; readable: boolean; chars: number }[];
    files: { n: number; mime: string; bytes: number }[];
    createdAt: string;
    /** Поправка 8: название письма (подсказка модели по цитате или от человека) */
    title?: string | null;
  };
  claims: LetterClaim[];
  deadlines: LetterDeadline[];
}

export interface UploadResponse extends LetterDetail {
  suggestions: CaseSuggestion[];
  /** сколько полей ответа модели не прошло проверку цитат и значений */
  extraction: { dropped: number };
}

// ---------- Дела, объяснение, история из API (B07, B08) ----------

export interface ApiTimelineItem {
  id: string;
  type: string;
  at: string;
  title: string;
  subtitle?: string;
  letterId?: string;
  draftId?: string;
}

export interface ApiCaseDetail extends CaseSummary {
  status?: 'OPEN' | 'CLOSED';
  letters: {
    id: string;
    createdAt: string;
    sourceType: 'PDF_TEXT' | 'IMAGE' | 'PDF_SCAN';
    title?: string | null;
    authority: string | null;
    /** Поправка 24.11: дата письма (факт LETTER_DATE), не дата загрузки. Нет в примерных данных. */
    letterDate?: { date: string; confirmed: boolean } | null;
    unconfirmed: number;
  }[];
  claims: LetterClaim[];
  deadlines: LetterDeadline[];
  drafts: { id: string; kind: string; status: string; stale: boolean; createdAt: string }[];
  timeline: ApiTimelineItem[];
}

export interface ApiHistoryItem extends ApiTimelineItem {
  caseId: string;
  caseTitle: string;
}

export interface HistoryPageResult {
  items: ApiHistoryItem[];
  nextCursor: string | null;
}

/** Группы истории на сайте и типы событий API (GET /history?type=). */
export type HistoryGroup = 'letter' | 'case' | 'question' | 'draft';

export interface ExplanationStatement {
  text: string;
  claimIds: string[];
  unconfirmed: boolean;
}

/** Чат-помощник (24.11): GET /chat, POST /chat */
export interface ChatMessage {
  id: string;
  role: 'USER' | 'ASSISTANT';
  text: string;
  createdAt: string;
}
export interface ChatView {
  disclaimer: string;
  messages: ChatMessage[];
}
export interface ChatReply {
  disclaimer: string;
  question: ChatMessage;
  answer: ChatMessage;
}

/** Ответ POST /letters/:id/translate (поправка 7): машинный перевод, не официальный */
export interface ApiTranslation {
  lang: 'ru';
  text: string;
  machine: true;
  cached: boolean;
}

/** Ответ POST /letters/:id/explain */
export interface ApiExplanation {
  lang: 'ru';
  about: ExplanationStatement;
  actions: ExplanationStatement[];
  /** K08 (#133): что просит ведомство. de — из факта (как в письме), ru — перевод или null */
  requests: { claimId: string; ru: string | null; de: string; unconfirmed: boolean }[];
  deadlines: { date: string; claimId: string; kind: DeadlineKind; confirmed: boolean }[];
  unconfirmed: boolean;
  cached: boolean;
}

// ---------- Черновик из API (B10) ----------

export type QuestionId = 'WHICH_DOCUMENTS' | 'DEADLINE' | 'REASON' | 'FORMAT' | 'AMOUNT';

export type ExtensionReason = 'DOCUMENTS_PENDING' | 'ADVICE' | 'NONE';
export type SentVia = 'post' | 'online' | 'email' | 'in_person' | 'other';

export interface DraftQuestions {
  letterId: string;
  caseId: string;
  questions: { id: QuestionId; ru: string }[];
  amounts: { claimId: string; value: string }[];
  /** B12: виды ответа, доступные по подтверждённым фактам письма */
  kinds: DraftKind[];
  deadlines: { claimId: string; date: string }[];
  extensionReasons: { id: ExtensionReason; ru: string }[];
}

/** Запрос на сборку черновика: вид ответа и его параметры. */
export type CreateDraftArgs = { caseId: string; letterId: string } & (
  | { kind: 'CLARIFICATION'; questionId: QuestionId; amountClaimId?: string }
  | { kind: 'DOCUMENTS' }
  | { kind: 'STATUS_REQUEST' }
  | { kind: 'EXTENSION'; reason: ExtensionReason; deadlineClaimId?: string }
);

/** Черновик. verification.checklist — снимок оснований на момент сборки. */
export interface ApiDraft {
  id: string;
  caseId: string;
  letterId: string | null;
  questionId: QuestionId | null;
  /** TEMPLATE: своё письмо по шаблону (B16) */
  kind: DraftKind | 'TEMPLATE';
  /** B16: шаблон своего письма, иначе null */
  outgoingTemplateId: string | null;
  reason: ExtensionReason | null;
  deadlineClaimId: string | null;
  germanText: string;
  russianText: string;
  claimIds: string[];
  stale: boolean;
  /** B12: текст изменён человеком и проверен заново */
  edited: boolean;
  status: string;
  sentAt: string | null;
  sentVia: string | null;
  verification: {
    passed: boolean;
    checks: { name: string; passed: boolean; details: string | null }[];
    checklist: { claimId: string; text: string; quote: string | null }[];
    note?: string;
  };
  createdAt: string;
}

/** B16: своё письмо создано — дело OUTGOING и первый черновик. */
export interface OutgoingResult {
  caseId: string;
  draft: ApiDraft;
}
