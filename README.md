# Ja!sno

Ja!sno помогает русскоязычным людям в Германии понять письмо от ведомства и ответить на него. Сайт открывается в браузере телефона, устанавливать ничего не нужно.

- Задание: `workflow/261116/11_TZ_ClaudeCode_v4_RU.md`
- Задачи: GitHub Issues, описание в `workflow/261116/12_Issues_GitHub_v4_RU.md`
- Решения: `docs/decisions.md`, команда: `docs/team.md`, готовность экранов и API: `docs/readiness.md`

## Из чего состоит

| Папка | Что это |
|---|---|
| `api/` | сервер (NestJS): хранит данные, говорит с языковой моделью, отвечает на запросы |
| `web/` | сайт (React + Vite) |
| `content/` | FAQ и карточки «Важно знать», их пишут люди |
| `fixtures/letters/` | 15 синтетических писем с ожидаемыми результатами |
| `docs/` | решения, команда, дизайн, готовность |

## Быстрый запуск

Нужно один раз: Node.js 24 и pnpm.

### Mac

1. Установить Node.js 24 LTS с сайта https://nodejs.org (файл `.pkg`, кнопка «LTS»).
2. Открыть «Терминал» и выполнить:

   ```bash
   corepack enable
   corepack prepare pnpm@latest --activate
   node -v
   pnpm -v
   ```

   `node -v` должен показать `v24...`.

### Windows

1. Установить Node.js 24 LTS с сайта https://nodejs.org (файл `.msi`, кнопка «LTS»). Галочки по умолчанию не менять.
2. Открыть «PowerShell» от имени администратора и выполнить:

   ```powershell
   corepack enable
   corepack prepare pnpm@latest --activate
   node -v
   pnpm -v
   ```

### Запуск проекта (Mac и Windows)

В терминале перейти в папку проекта (`cd` и путь к папке `Gosorgan01`) и выполнить:

```bash
pnpm install
```

Скопировать файл настроек сервера:

- Mac: `cp api/.env.example api/.env`
- Windows: `copy api\.env.example api\.env`

Без изменений файл работает в режиме `LLM_MODE=demo` (без настоящей модели). Для настоящей модели вписать в `api/.env` значения `LLM_MODE=openai`, `LLM_API_KEY` и `LLM_MODEL`. Ключ никому не отправлять и в git не добавлять.

Запустить сервер:

```bash
pnpm dev:api
```

Проверить в браузере:

- http://127.0.0.1:3000/health показывает `{"ok":true,...}`
- http://127.0.0.1:3000/docs открывает Swagger

Остановить сервер: `Ctrl + C` в терминале.

### Сайт

Во втором окне терминала:

- Mac: `cp web/.env.example web/.env`
- Windows: `copy web\.env.example web\.env`

```bash
pnpm dev:web
```

Открыть http://localhost:5173. На телефоне в той же сети Wi-Fi: `pnpm dev:web -- --host`, затем адрес, который покажет терминал (Network).

В `web/.env` переменная `VITE_DATA_MODE=mock` включает примерные данные: сайт работает без сервера, в углу видна подпись «примерные данные». `VITE_DATA_MODE=api` берёт данные с сервера; экраны, для которых на сервере ещё нет функции, честно пишут «ещё не подключена».

Иллюстрации кладутся в `web/public/illustrations/` (список в `docs/design/README.md`).

## Проверки перед Pull Request

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

Все команды должны закончиться без ошибок. Те же проверки запускает GitHub Actions в каждом PR (`.github/workflows/ci.yml`).

## Postman

Коллекция: `api/postman/jasno.postman_collection.json`, окружение: `api/postman/local.postman_environment.json`. В Postman: «Import», выбрать оба файла, вверху справа выбрать окружение «Ja!sno local», потом «Run collection».

## Заглушки

Временные решения в коде помечены `// STUB:` и перечислены здесь.

- пока нет
