# ТЗ v2: Ja!sno, разработка с нуля

Версия 2.0 от 13.11.2026. Заменяет ТЗ 03 (`workflow/alt/261111/03_TechBriefing_Codex-Backend.md`) и ТЗ 05 (`workflow/alt/05_TechBriefing_Backend_pod_UI_RU.md`). Старые документы остаются в `workflow/alt` только для справки.

Исходная точка: Есть синтетические письма (`fixtures/letters`), файлы настроек в корне репозитория, макеты интерфейса и концепт (`08_Konzept_Stand_RU.md`). Бэкенд и интерфейс пишутся по этому документу. Задачи для GitHub: `10_Issues_GitHub_RU.md`.

Документ читают и люди, и ИИ-помощник (Claude Code). Части 1–3 для всех, части 4–14 в первую очередь для Claude Code.

## 1. Что строим

Ja!sno помогает русскоязычным людям в Германии понять письмо ведомства и ответить на него. Сайт открывается в браузере телефона.

Демо 25.11 показывает такой путь:

1. Регистрация с e-mail и паролем, вход.
2. Загрузка письма: PDF с текстом или фото (JPG, PNG).
3. Ja!sno показывает факты с цитатами: ведомство, номер дела, дата письма, требования, сроки. Человек отмечает «верно» или «неверно».
4. Человек кладёт письмо в существующее дело, создаёт новое или не сохраняет.
5. Объяснение по-русски: о чём письмо, что сделать, до какого числа.
6. Черновик ответа «запрос уточнения» на немецком с переводом на русский, собранный только из подтверждённых фактов.

После демо, до 03.12: вопросы по делу, письма из нескольких фото, другие виды ответа, «Я отправил(а)», публикация в Docker, оценка качества на 15 письмах.

## 2. Решения команды

1. Факты подтверждает человек. ИИ только предлагает.
2. Письмо сначала попадает во «входящие», дело выбирает человек.
3. Ответ в ведомство собирается по шаблону из подтверждённых фактов, а не пишется ИИ свободно.
4. Классическая регистрация: e-mail и пароль. Без подтверждения e-mail и без восстановления пароля до защиты.
5. Возражение (Widerspruch) и юридические вопросы Ja!sno не пишет, а называет, где получить консультацию.
6. Интерфейс и объяснения только на русском. Параметр `lang` закладывается сразу.
7. До «шлюза пилота» только синтетические письма. Шлюз: хостинг в ЕС, договоры обработки данных (AVV) с провайдерами, проверенные Impressum и Datenschutz, восстановление пароля.
8. Решения по проекту принимают Александра и Настя вместе.

## 3. Правила (нарушение = PR не принимается)

1. Одна задача = одна ветка = один PR. В PR только то, что просит задача.
2. Любой вызов языковой модели только через `LlmService`. Ответ проверяется схемой Zod, каждый вызов (и удачный, и неудачный) пишется в таблицу `LlmCall`. Импорт SDK провайдера вне папки `api/src/llm` запрещён правилом ESLint.
3. Ничего не выдумывать. Если поля нет в письме, значение `null`. Каждая цитата обязана быть в тексте письма, это проверяет код.
4. Черновик строится только из подтверждённых фактов. Функция сборки черновика принимает тип `ConfirmedClaim[]`, который можно получить только из `ClaimsService.getConfirmed()`.
5. Сказанное пользователем не факт. Утверждение пользователя сохраняется с `basis = USER` и `status = UNCONFIRMED`.
6. Промпты лежат файлами `api/src/llm/prompts/<имя>.v<N>.md`. Старые версии не меняются, добавляется новая.
7. В репозитории нет секретов (`.env`) и настоящих данных людей.
8. Перед PR зелёные: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`.
9. Каждая задача бэкенда добавляет в коллекцию Postman папку с запросами и проверками для своих эндпоинтов.
10. Временная заглушка помечается комментарием `// STUB:` и записывается в README.

## 4. Стек

| Часть | Что используем |
|---|---|
| Язык | TypeScript, `strict` |
| Пакеты | pnpm (workspace: `api` и `web`), Node.js 24 LTS |
| Бэкенд | NestJS (последняя версия, ESM), `@nestjs/swagger`, `@nestjs/config`, `@nestjs/throttler` |
| Проверка данных | Zod (`StandardSchemaValidationPipe` NestJS) |
| База | Prisma; SQLite для разработки, PostgreSQL для публикации |
| Пароли | `bcryptjs` (без сборки нативного кода) |
| PDF | `pdf-parse` для текстового слоя |
| Фото и сканы | мультимодальная языковая модель через тот же `LlmService` (промпт `transcribe`) |
| Языковая модель | адаптер к API, совместимому с OpenAI (сейчас Google Gemini, бесплатный ключ); адаптер `demo` без сети для тестов |
| Тесты | Vitest, e2e через `supertest`, коллекция Postman, newman |
| Интерфейс | React + Vite + TypeScript, React Router |
| Публикация | один Docker-контейнер: `api` отдаёт и API, и собранный `web` |

Tesseract и OCR на компьютере не используем: фото распознаёт модель. Это проще ставить и лучше читает фото с телефона.

Новые зависимости сверх таблицы добавляются только с объяснением в PR.

## 5. Структура репозитория

```
api/                     бэкенд NestJS
  src/
    main.ts, app.module.ts
    config/              переменные окружения, проверка Zod при старте
    common/              фильтр ошибок, коды ошибок, guard сессии, декоратор текущего кабинета
    prisma/              PrismaService
    auth/                регистрация, вход, выход, кабинет
    llm/                 LlmService, адаптеры, PromptRegistry, TraceService, MaskingService, prompts/
    documents/           приём файла, текст из PDF, расшифровка фото через LlmService
    letters/             входящие письма, извлечение фактов, проверка цитат, объяснение
    claims/              факты, подтверждение, тип ConfirmedClaim
    cases/               дела, статус дела (stage), история, сроки
    dialogue/            вопросы по делу (после демо)
    drafting/            шаблоны ответов, проверка черновика
    health/              GET /health
  prisma/schema.prisma           SQLite
  prisma/schema.postgres.prisma  PostgreSQL
  test/                  e2e
  postman/jasno.postman_collection.json
  postman/local.postman_environment.json
web/                     интерфейс React
fixtures/letters/        синтетические письма (уже есть)
docs/                    решения, команда, база, демо
workflow/                документы проекта
Dockerfile, docker-compose.yml   (задача B13)
AGENTS.md                правила для ИИ-помощника (текст в разделе 14)
README.md
```

Файлы настроек старого бэкенда в корне (`package.json`, `nest-cli.json`, `tsconfig*.json`, `eslint.config.mjs`, `.oxlintrc.json`, `vitest.config*.ts`, `pnpm-lock.yaml`) задача B01 заменяет: корневой `package.json` становится корнем workspace, настройки NestJS переезжают в `api/`.

## 6. Переменные окружения (`api/.env.example`)

| Переменная | Пример | Зачем |
|---|---|---|
| `PORT` | `3000` | порт сервера |
| `HOST` | `127.0.0.1` | в Docker `0.0.0.0` |
| `DATABASE_URL` | `file:./dev.db` | база |
| `CORS_ORIGIN` | `http://localhost:5173` | адрес интерфейса |
| `LLM_MODE` | `demo` | `demo` или `openai` |
| `LLM_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` | адрес API модели |
| `LLM_API_KEY` | | ключ, только в `.env` |
| `LLM_MODEL` | `gemini-3.1-flash-lite` | модель |
| `LLM_TIMEOUT_MS` | `60000` | тайм-аут вызова |
| `STORAGE_DIR` | `./storage` | оригиналы файлов (после демо) |
| `SESSION_TTL_DAYS` | `30` | срок сессии |
| `CABINET_TTL_DAYS` | `90` | автоудаление неактивных кабинетов |

`web/.env.example`: `VITE_API_URL=http://127.0.0.1:3000`.

## 7. Схема данных (Prisma)

```prisma
enum CaseStatus   { OPEN CLOSED }
enum CaseOrigin   { INCOMING OUTGOING }
enum SourceType   { PDF_TEXT IMAGE }
enum ClaimKind    { AUTHORITY CASE_NUMBER LETTER_DATE REQUIREMENT DEADLINE AMOUNT OTHER }
enum ClaimBasis   { DOCUMENT USER }
enum ClaimStatus  { UNCONFIRMED CONFIRMED REJECTED SUPERSEDED }
enum DeadlineKind { REPLY DOCUMENTS OBJECTION FOLLOW_UP }
enum MessageKind  { QUESTION STATEMENT ANSWER }
enum DraftKind    { CLARIFICATION DOCUMENTS EXTENSION STATUS_REQUEST TEMPLATE FREE }
enum DraftStatus  { PREPARED SENT }
enum EventType    { LETTER_RECEIVED CASE_CREATED_FROM_LETTER CLAIM_CONFIRMED CLAIM_REJECTED
                    QUESTION_ASKED USER_REPORTED_SENT DRAFT_PREPARED DRAFT_SENT DEADLINE_DONE REVISION }

model Cabinet {
  id           String    @id @default(cuid())
  email        String    @unique          // в нижнем регистре
  passwordHash String
  language     String    @default("ru")
  profile      Json?                      // { firstName, lastName, address, numbers: [{label, value}] }
  consentAt    DateTime
  createdAt    DateTime  @default(now())
  lastSeenAt   DateTime  @default(now())
  sessions     Session[]
  cases        Case[]
  letters      Letter[]
}

model Session {
  id         String   @id @default(cuid())
  cabinetId  String
  cabinet    Cabinet  @relation(fields: [cabinetId], references: [id], onDelete: Cascade)
  tokenHash  String   @unique             // sha256 от токена
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  lastSeenAt DateTime @default(now())
}

model Case {
  id         String     @id @default(cuid())
  cabinetId  String
  cabinet    Cabinet    @relation(fields: [cabinetId], references: [id], onDelete: Cascade)
  title      String
  authority  String?
  caseNumber String?
  status     CaseStatus @default(OPEN)
  origin     CaseOrigin @default(INCOMING)
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt
  letters    Letter[]
  claims     Claim[]
  deadlines  Deadline[]
  events     Event[]
  messages   Message[]
  drafts     Draft[]
}

model Letter {
  id          String     @id @default(cuid())
  cabinetId   String
  cabinet     Cabinet    @relation(fields: [cabinetId], references: [id], onDelete: Cascade)
  caseId      String?                     // null = во входящих
  case        Case?      @relation(fields: [caseId], references: [id], onDelete: Cascade)
  sourceType  SourceType
  rawText     String                      // распознанный текст, исходный, без маскирования
  pages       Json                        // [{ n, readable, chars }]
  fileKey     String?                     // путь к оригиналу (после демо)
  fileMime    String?
  explanation Json?                       // кэш объяснения
  createdAt   DateTime   @default(now())
  claims      Claim[]
  deadlines   Deadline[]
}

model Claim {
  id        String      @id @default(cuid())
  letterId  String?
  letter    Letter?     @relation(fields: [letterId], references: [id], onDelete: Cascade)
  caseId    String?
  case      Case?       @relation(fields: [caseId], references: [id], onDelete: Cascade)
  kind      ClaimKind
  value     String                        // нормализованное значение, дата в ISO 8601
  text      String                        // формулировка для человека по-русски
  quote     String?                       // точная цитата из письма; у USER может не быть
  page      Int?
  basis     ClaimBasis
  status    ClaimStatus @default(UNCONFIRMED)
  reason    String?                       // почему SUPERSEDED или REJECTED
  createdAt DateTime    @default(now())
}

model Deadline {
  id               String       @id @default(cuid())
  letterId         String
  letter           Letter       @relation(fields: [letterId], references: [id], onDelete: Cascade)
  caseId           String?
  case             Case?        @relation(fields: [caseId], references: [id], onDelete: Cascade)
  claimId          String       @unique
  date             DateTime
  kind             DeadlineKind
  doneAt           DateTime?
  remindDaysBefore Int          @default(3)
}

model Event {
  id      String    @id @default(cuid())
  caseId  String
  case    Case      @relation(fields: [caseId], references: [id], onDelete: Cascade)
  type    EventType
  at      DateTime  @default(now())
  details Json
}

model Message {
  id        String      @id @default(cuid())
  caseId    String
  case      Case        @relation(fields: [caseId], references: [id], onDelete: Cascade)
  role      String                        // USER или ASSISTANT
  kind      MessageKind
  text      String
  createdAt DateTime    @default(now())
}

model Draft {
  id           String      @id @default(cuid())
  caseId       String
  case         Case        @relation(fields: [caseId], references: [id], onDelete: Cascade)
  kind         DraftKind
  templateId   String?
  germanText   String
  russianText  String
  claimIds     Json
  verification Json                       // отчёт проверки
  status       DraftStatus @default(PREPARED)
  sentAt       DateTime?
  sentVia      String?
  createdAt    DateTime    @default(now())
}

model LlmCall {
  id            String   @id @default(cuid())
  cabinetId     String?
  letterId      String?
  caseId        String?
  promptName    String
  promptVersion Int
  provider      String
  model         String
  input         String                    // уже замаскированный текст; для фото только описание «image, N KB»
  output        String?
  ok            Boolean
  error         String?
  attempts      Int
  durationMs    Int
  tokensIn      Int?
  tokensOut     Int?
  createdAt     DateTime @default(now())
}
```

`LlmCall` не связан внешними ключами, чтобы журнал не мешал удалению. При удалении кабинета, дела или письма его строки удаляются кодом по `cabinetId`.

Статус дела для интерфейса не хранится, его считает функция `stage(case)` в `cases`:

1. `status = CLOSED` → «Завершено».
2. есть срок без `doneAt`, не в прошлом → «Нужны документы» (`DOCUMENTS`) или «Нужен ответ» (`REPLY`).
3. последний черновик `SENT` и открытых сроков нет → «Ждём ответа ведомства».
4. иначе «Нужна проверка», если есть неподтверждённые факты, или «Открыто».

Переходы факта: `UNCONFIRMED → CONFIRMED`, `UNCONFIRMED → REJECTED`, `UNCONFIRMED|CONFIRMED → SUPERSEDED`. Обратных переходов нет.

## 8. API

Все ответы JSON. Ошибка всегда `{ code, message, details? }`, `message` по-русски. Все эндпоинты, кроме `/health`, `/auth/register`, `/auth/login`, требуют `Authorization: Bearer <токен сессии>`. Чужой объект отвечает 404, не 403. Swagger на `/docs`.

Служебное:

0. `GET /health` → `{ ok: true, llmMode }`.

Регистрация и кабинет (B03):

1. `POST /auth/register` `{ email, password, consent: true }` → `201 { sessionToken }`. Пароль 10–128 знаков. Ошибки: 409 `EMAIL_TAKEN`, 400 `CONSENT_REQUIRED`, 400 `VALIDATION_FAILED`.
2. `POST /auth/login` `{ email, password }` → `200 { sessionToken }`. Неверный пароль и неизвестный e-mail: одинаковая 401 `INVALID_CREDENTIALS`. Пятая неудачная попытка на один e-mail за 15 минут и дальше: 429 `RATE_LIMITED`.
3. `POST /auth/logout` → `204`.
4. `GET /cabinet` → `{ email, language, profile, counts: { openTasks, activeCases, inboxLetters }, nextDeadline }`.
5. `PATCH /cabinet` `{ language?, profile? }`.
6. `DELETE /cabinet` `{ password }` → `204`. Удаляет всё: сессии, дела, письма, факты, сроки, черновики, файлы, `LlmCall`.

Письма (B05, B06, B08, B11):

7. `POST /letters` multipart, поле `files` (на демо один файл: PDF до 10 МБ и 20 страниц или JPG/PNG до 10 МБ). Ответ `201`: `{ letter, claims[], deadlines[], suggestions: [{ caseId, title, reason }] }`, письмо без дела. Нечитаемое письмо: 422 `UNREADABLE` с `details.pages`. PDF без текстового слоя на демо: 422 `SCAN_PDF_NOT_SUPPORTED` с советом загрузить фото страниц.
8. `GET /letters?inbox=true` → письма без дела.
9. `GET /letters/:id` → письмо, факты с цитатами, сроки, объяснение, если уже есть.
10. `POST /letters/:id/claims/confirm` `{ confirm: [claimId], reject: [claimId] }` → одна транзакция.
11. `POST /letters/:id/assign` `{ caseId }` или `{ newCase: { title? } }`. Переносит письмо, его факты и сроки. Название по умолчанию собирает код: «<ведомство>: <первое требование>».
12. `DELETE /letters/:id` → «Не сохранять».
13. `POST /letters/:id/explain?lang=ru` → объяснение (раздел 9), кэш в `Letter.explanation`.
14. `GET /letters/:id/file?page=n` → оригинал (B11).

Дела (B07):

15. `GET /cases?status=active|done|all&q=` → `[{ id, title, authority, caseNumber, origin, stage, nextDeadline, counts: { letters, unconfirmed }, updatedAt }]`.
16. `GET /cases/:id` → дело, письма, факты, сроки, черновики, `stage`, `timeline: [{ type, at, title, subtitle, letterId?, draftId? }]`.
17. `PATCH /cases/:id` `{ title?, status? }`.
18. `DELETE /cases/:id`.
19. `GET /history?type=letter|question|draft&cursor=` → события всех дел по дате, по 30.
20. `GET /cases/:id/trace` → вызовы модели по делу.

Черновик (B10, B12):

21. `POST /cases/:id/draft` `{ kind }`, по умолчанию `CLARIFICATION`. Нет подтверждённых фактов: 409 `NO_CONFIRMED_CLAIMS`. Проверка не пройдена: 422 `DRAFT_VERIFICATION_FAILED` с отчётом. `WIDERSPRUCH` или другой юридический вид: 422 `LEGAL_REFERRAL` со списком мест консультации.
22. `POST /cases/:id/sent` `{ draftId?, via: post|online|email|other, date, closeDeadlineId? }` (B12).
23. `PATCH /deadlines/:id` `{ done: true }` (B12).
24. `GET /deadlines/:id/ics` (B12).

Вопросы (B09):

25. `POST /cases/:id/messages` `{ text }` → `{ kind, answer?, questions[] }`.

Если останется время (B15, B16): `GET /drafts/:id/pdf`, `GET /templates`, `POST /outgoing`.

## 9. Слой ИИ

`LlmService.call<T>({ prompt, version?, variables, images?, schema, context: { cabinetId, letterId?, caseId? } }): Promise<T>`:

1. Берёт текст промпта из `PromptRegistry` и подставляет переменные `{{имя}}`.
2. Перед отправкой прогоняет все текстовые переменные через `MaskingService`: IBAN, BIC, Steuer-ID (11 цифр), номер социального страхования, телефон, e-mail заменяются метками `[IBAN_1]`, `[EMAIL_1]` и т. д. Таблица замен живёт только в памяти этого вызова. В ответе модели метки заменяются обратно.
3. Вызывает адаптер (`openai` или `demo`), просит JSON (`response_format: json_object`).
4. Разбирает JSON и проверяет схемой Zod. Ошибка: повтор, в повтор добавляется текст ошибки. Всего не больше 3 попыток.
5. Пишет `LlmCall` (замаскированный вход, выход, попытки, время, токены). Без успеха после 3 попыток бросает ошибку, API отвечает 502 `LLM_FAILED`.

Адаптер `demo` отвечает по простым правилам без сети: находит в тексте «Jobcenter», «Aktenzeichen», даты формата `dd.mm.yyyy` и т. п. Он нужен для тестов, CI и офлайн-демо и явно помечается в ответах `GET /health`.

Фото уходят в модель без маскирования: изображение замаскировать нельзя. До шлюза пилота это допустимо, потому что письма синтетические.

Промпты на демо:

| Файл | Вход | Выход (Zod) |
|---|---|---|
| `transcribe.v1` | изображение | `{ text: string, readable: boolean, reason: string \| null }` |
| `extract.v1` | текст письма | `{ authority, caseNumber, letterDate, requirements[], deadlines[], amounts[] }`, у каждого поля `{ value \| null, quote \| null, page \| null }`, у срока ещё `kind: REPLY \| DOCUMENTS \| OBJECTION` |
| `explain.v1` | подтверждённые и неподтверждённые факты с цитатами, язык | `{ about: string (до 400 знаков), actions: [{ text, claimIds[] }] (до 5), deadline: { date, claimId } \| null, unconfirmed: boolean }` |
| `dialogue.v1` (после демо) | вопрос, факты и текст писем дела | `{ kind: QUESTION \| STATEMENT, answer \| null, statement \| null, questions[] (до 3) }` |

Проверки кодом после модели:

1. Каждая `quote` из `extract` должна найтись в тексте письма. Сравнение после нормализации: нижний регистр, пробелы и переносы схлопнуты, дефис переноса убран. Для фото допускается расстояние Левенштейна до 3 % длины цитаты. Не нашлась: поле становится `null`.
2. Дата срока должна встречаться в цитате этого срока (в любом из форматов `dd.mm.yyyy`, `d. Monat yyyy`). Нет: срок отбрасывается.
3. В `explain` каждая дата и каждое число в тексте должны быть в цитатах фактов из `claimIds`. Нет: повтор вызова, после 3 попыток 502.
4. Перед вызовом `dialogue` код ищет юридические слова (`Widerspruch`, `Klage`, `Anwalt`, `Einspruch`, `rechtlich`, «возражение», «суд», «адвокат»). Есть: модель не вызывается, ответ с отсылкой к консультации.

## 10. Черновик ответа

Черновик собирается шаблоном в коде (`drafting/templates/*.ts`), без ИИ. Вход: `ConfirmedClaim[]`, профиль кабинета, вид ответа. Выход: немецкий текст письма и русский перевод по тому же шаблону.

На демо один шаблон: `CLARIFICATION` (запрос уточнения: «Sehr geehrte Damen und Herren, in Ihrem Schreiben vom … zum Aktenzeichen … bitten Sie um …»). После демо: `DOCUMENTS`, `EXTENSION`, `STATUS_REQUEST`.

`VerificationService.verify(draft, claims)` без ИИ:

1. Все даты, числа и номера дел в немецком тексте есть среди подтверждённых фактов.
2. Номер дела в тексте совпадает с номером дела.
3. Нет прошедших дат, поданных как будущий срок.
4. `claimIds` черновика входят в переданные факты.

Отчёт `{ passed, checks: [{ name, passed, details }], checklist: [{ claimId, text, quote }] }` сохраняется в `Draft.verification`. При `passed = false` черновик не сохраняется.

## 11. Безопасность и данные

1. Пароль хэшируется `bcryptjs` (cost 12). Пароль, хэш, токен сессии не пишутся в логи, `LlmCall` и ответы API.
2. Токен сессии: 32 случайных байта в base64url, в базе только sha256. Срок `SESSION_TTL_DAYS`.
3. Все запросы к делам, письмам, фактам и черновикам фильтруются по `cabinetId` текущей сессии.
4. Маскирование текста перед моделью (раздел 9).
5. E-mail кабинета не уходит в модель, в логах показывается как `a***@example.org`.
6. Удаление кабинета, дела или письма удаляет связанные строки, файлы и `LlmCall`.
7. Раз в сутки задача `@nestjs/schedule` удаляет кабинеты без активности дольше `CABINET_TTL_DAYS` и просроченные сессии (после демо, B12).
8. Ограничение частоты: вход (раздел 8), загрузка писем 20 в час на кабинет (`@nestjs/throttler`).
9. Файлы: проверка типа по содержимому, а не по расширению; PDF больше 20 страниц отклоняется.

## 12. Тестовые данные и качество

`fixtures/letters` содержит 15 синтетических писем: для каждого `.txt` (исходный текст), `.pdf`, у части `.jpg`/`.png`, и `.json` с ожидаемыми значениями. Их не менять без решения Александры и Насти.

Для демо основные письма: `01_jobcenter_request`, `04_buergeramt`, `06_multiple_deadlines`, фото `08_photo.jpg`.

Задача B14 (после демо): команда `pnpm --dir api eval` прогоняет все 15 писем через настоящий путь (загрузка → извлечение) и пишет `reports/eval-latest.json` и таблицу: точность по ведомству, номеру дела, сроку отдельно для PDF и фото; доля найденных цитат (цель 100 %); доля черновиков, прошедших проверку; среднее время вызова; токены.

## 13. Порядок работ

| Код | Что | Кто | Срок | Готово, когда |
|---|---|---|---|---|
| B01 | каркас `api`, workspace, health, ошибки, CORS, Swagger, CI, Postman «00» | Александра | 17.11 | `GET /health` 200, CI зелёный |
| B02 | схема базы, SQLite и PostgreSQL | Александра | 18.11 | `pnpm db:push` на обеих базах |
| B03 | регистрация, вход, кабинет, guard | Александра | 20.11 | изоляция двух кабинетов в e2e |
| B04 | слой ИИ: LlmService, адаптеры, промпты, журнал, маскирование | Настя | 20.11 | неверный JSON повторяется и пишется в журнал; IBAN не попадает в `LlmCall.input` |
| B05 | приём файла: текст PDF, расшифровка фото | Александра | 23.11 | текст есть для 01 (PDF) и 08 (фото), 11 даёт 422 |
| B06 | извлечение фактов, проверка цитат, сроки, входящие, подтверждение | Александра | 25.11 | 01, 04, 06 дают верные ведомство, номер, срок в режиме demo |
| B07 | дела: назначение письма, список, stage, история, удаление | Настя | 25.11 | 4 юнит-теста на stage, e2e «загрузка → новое дело» |
| B08 | объяснение письма | Настя | 25.11 | дата в объяснении не из письма → повтор |
| B10 | черновик «запрос уточнения» и проверка | Настя | 25.11 | неверная дата в черновике ловится проверкой |
| B09 | вопросы по делу | Александра | 01.12 | вопрос не создаёт факт |
| B11 | несколько фото в одном письме, PDF-скан, оригиналы | Александра | 02.12 | 3 фото = 1 письмо |
| B12 | виды ответа, Widerspruch, «Я отправил(а)», сроки, ICS, автоудаление | Александра | 02.12 | `WIDERSPRUCH` → 422 `LEGAL_REFERRAL` |
| B13 | Docker и публикация | Настя | 01.12 | `docker compose up` открывает сайт и API |
| B14 | оценка качества на 15 письмах | Настя | 02.12 | отчёт одной командой |
| B15 | PDF письма | если останется время | 03.12 | PDF открывается |
| B16 | собственные письма по шаблонам | если останется время | 03.12 | 6 шаблонов |

B04, B07, B08, B10 записаны на Настю, потому что у Александры до 25.11 около 18 часов, а B01, B02, B03, B05, B06 уже занимают около 17. Это предложение. Если Александра и Настя решат иначе, меняется только исполнитель в GitHub.

Интерфейс (Настя): F01 каркас и вход (20.11), F02 загрузка письма и проверка фактов (24.11), F03 кабинет, дела, письмо с объяснением (25.11), F04 черновик ответа (25.11), F05 вопросы, виды ответа, профиль (после демо).

## 14. Текст для AGENTS.md (заменяет старый целиком)

```markdown
# AGENTS.md

Проект Ja!sno: помощник для писем немецких ведомств. Команда новичков.
Главный документ: workflow/261113/09_TechBriefing_v2_RU.md. Задачи: GitHub Issues.

## Как работать
- Отвечай и объясняй по-русски, простыми словами. Код, имена и коммиты на английском.
- Перед изменением файлов покажи план и дождись «да».
- Делай только то, что просит Issue. Одна задача = одна ветка = один PR.
- Ветка от свежего master, имя из Issue. В PR: «Closes #<номер>», изменённые файлы, шаги ручной проверки.
- Перед PR: pnpm lint, pnpm typecheck, pnpm test, pnpm test:e2e. Всё зелёное.

## Правила кода (раздел 3 ТЗ v2)
- Модель вызывается только через api/src/llm/LlmService. Ответ проверяется Zod, вызов пишется в LlmCall.
- Цитата обязана быть в тексте письма. Нет данных: null, не догадка.
- Черновик только из ConfirmedClaim[] (ClaimsService.getConfirmed()).
- Сказанное пользователем: basis USER, status UNCONFIRMED.
- Промпты: api/src/llm/prompts/<имя>.v<N>.md, старые версии не трогать.
- Чужой объект: 404. Пароли, хэши и токены не логировать.
- Никаких секретов и настоящих данных в репозитории. Только fixtures/letters.
- Каждая задача бэкенда дополняет api/postman/jasno.postman_collection.json.

## NestJS
- Проект ESM: относительные импорты с .js, вместо __dirname import.meta.dirname, тесты на Vitest (vi.fn()).
- Проверка входных данных: Zod через StandardSchemaValidationPipe.
- Перед новой библиотекой проверь пакеты @nestjs/* (config, swagger, throttler, schedule). Документация: https://docs.nestjs.com/llms.txt
```
