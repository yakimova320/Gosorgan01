# Ja!sno в Docker и публикация

Этот документ для команды. Публикацию на сервер делает человек, не Claude.

> **Статус.** Локальный запуск в Docker проверен 18.11.2026 на Mac (Docker Desktop): `docker compose up`, основной путь в браузере, перезапуск, восстановление пароля в режиме `file`, резервная копия и восстановление. **Публикация на сервер и режим `NODE_ENV=production` не проверены.**

## Как устроено

| Сервис | Что внутри | Том |
|---|---|---|
| `db` | PostgreSQL 17 | `gosorgan01_jasno-db` — база |
| `app` | API (NestJS) и собранный сайт в одном контейнере. При запуске: права тома → `prisma migrate deploy` → сервер | `gosorgan01_jasno-storage` — файлы писем, письма восстановления (`mail-outbox`) |

- Сайт и API на одном адресе: `http://localhost:8080`. Страницы сайта (`/`, `/login`, `/app/...`) отдают `index.html`; адреса API (`/auth`, `/cases`, `/letters`, ...) работают как раньше; неизвестный адрес или отсутствующий файл — 404, не страница сайта.
- Сервер в контейнере работает от пользователя `node`, не от root. Права тома исправляются при запуске (и для старого тома).
- Ошибка миграции останавливает запуск: сервер не стартует, причина в `docker compose logs app`.
- Порты открыты только на `127.0.0.1` этого компьютера.
- Имя проекта (`gosorgan01`) и имена томов закреплены в `docker-compose.yml`: запуск из другой папки использует ту же базу, а не создаёт новую пустую.

## 1. Локальный запуск

Нужен Docker Desktop.

```bash
docker compose up -d --build
```

Открыть `http://localhost:8080`. В углу должно быть «сервер», жёлтой плашки «Примерные данные» нет.

```bash
docker compose ps
```

Оба сервиса `healthy`. Логи: `docker compose logs -f app`. Остановить: `docker compose down` (данные остаются в томах). **Не** добавлять `-v`: `docker compose down -v` удаляет тома, то есть базу и файлы.

По умолчанию:

| Что | Значение | Как изменить |
|---|---|---|
| Модель | `LLM_MODE=demo`, даже если в `api/.env` есть ключ | `JASNO_LLM_MODE=openai docker compose up -d` (ключ и модель из `api/.env`) |
| Письма восстановления | `MAIL_MODE=file`: файл в томе, `mail-outbox/<кабинет>/` | `JASNO_MAIL_MODE=smtp` и SMTP в `api/.env` |
| Режим | `NODE_ENV=development` | `JASNO_NODE_ENV=production` |
| Адрес сайта | `http://localhost:8080` (ссылка в письме восстановления) | `JASNO_PUBLIC_URL`, порт — `JASNO_PORT` |

Переменные `JASNO_*` можно задать в терминале перед командой или в файле `.env` в корне проекта (в git не попадает). Остальные настройки (`SMTP_*`, `LLM_*`, `DEMO_PASSWORD`) контейнер берёт из `api/.env`, если файл есть; адрес базы, хост, хранилище задаёт `docker-compose.yml`.

Письмо восстановления в режиме `file` прочитать так (ссылка с секретом, никому не пересылать):

```bash
docker compose exec app sh -c 'cat /data/storage/mail-outbox/*/*.eml'
```

Демо-кабинет внутри контейнера (пароль из `DEMO_PASSWORD` в `api/.env`):

```bash
docker compose exec app jasno seed
```

Служебные команды в контейнере запускать только через `jasno` (`jasno seed`, `jasno migrate`): она работает от пользователя `node`. Команды вида `docker compose exec app node ...` идут от root, и созданные ими файлы сервер потом не сможет удалить (удаление аккаунта откатится с ошибкой; поможет `docker compose restart app` — права тома исправятся при запуске).

**Порт 5432 занят.** `pnpm db:up` и `docker compose up` используют один и тот же сервис `db` — второй PostgreSQL не нужен. Если 5432 занят другим PostgreSQL на Mac, остановить его.

## 2. Публикация на сервер (делает команда)

Не проверено. Шаги — план для команды.

1. **Сервер.** Linux с Docker Engine и Docker Compose v2, домен, открыты только 80 и 443. Наружу публикуется только прокси (Caddy или nginx) с HTTPS; порты 8080 и 5432 остаются на `127.0.0.1`.
2. **Код.** `git clone` репозитория, ветка `master`.
3. **Настройки.** На сервере создать `.env` в корне (права `600`, в git не попадает):

   ```
   POSTGRES_PASSWORD=<длинный случайный пароль>
   JASNO_NODE_ENV=production
   JASNO_PUBLIC_URL=https://<домен>
   JASNO_MAIL_MODE=smtp
   JASNO_TRUST_PROXY=uniquelocal
   ```

   и `api/.env` (права `600`): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` с подтверждённого в почтовом сервисе домена; при настоящей модели `JASNO_LLM_MODE=openai` в корневом `.env` и `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_DAILY_TOKEN_BUDGET` в `api/.env`.
   - `NODE_ENV=production` запрещает `MAIL_MODE=file` и выключение лимитов по IP: сервер не стартует с такими настройками.
   - `POSTGRES_PASSWORD` действует только при **первом** создании тома базы. Чтобы сменить пароль у существующей базы: `docker compose exec db psql -U jasno -c "ALTER USER jasno PASSWORD '<новый>'"`, затем то же значение в `.env` и `docker compose up -d`.
   - `TRUST_PROXY`: прокси на том же сервере обращается к контейнеру из сети Docker, поэтому `uniquelocal`. Без него все пользователи для лимитов по IP — один адрес прокси. `true` и число шагов сервер не принимает.
4. **Прокси.** Пример Caddy (`/etc/caddy/Caddyfile`):

   ```
   <домен> {
     reverse_proxy 127.0.0.1:8080
   }
   ```

5. **Запуск.**

   ```bash
   docker compose up -d --build
   ```

   Проверить: `docker compose ps` (оба `healthy`), `https://<домен>/health`, регистрация тестового аккаунта, загрузка синтетического письма, письмо восстановления пришло и ссылка ведёт на `https://<домен>/reset`. Тестовый аккаунт удалить.
6. **Обновление версии.** Сначала резервная копия (раздел 3), затем:

   ```bash
   git pull
   docker compose up -d --build
   ```

   Миграции применяются при запуске. Если миграция не прошла — сервер не стартует; смотреть `docker compose logs app`, при необходимости вернуть предыдущий коммит и восстановить базу из копии.

## 3. Резервная копия и восстановление

Копировать **две** вещи: базу и файлы. Простое копирование папки или тома работающего PostgreSQL **не считается** резервной копией: файлы базы могут оказаться несогласованными. Для базы — только `pg_dump`.

Проверено 18.11.2026 локально: копия базы восстановлена в отдельную базу (те же числа кабинетов, писем, миграций), архив файлов распакован в отдельный том.

### Сделать копию

В папке проекта, сервисы запущены. `backup/` — папка вне репозитория или в нём, но не в git (`backup/` не коммитить: там личные данные).

```bash
mkdir -p backup
```

```bash
docker compose exec -T db pg_dump -U jasno -d jasno -Fc > backup/jasno-db-$(date +%F).dump
```

```bash
docker run --rm -v gosorgan01_jasno-storage:/data/storage:ro -v "$PWD/backup":/backup alpine tar czf /backup/jasno-storage-$(date +%F).tgz -C /data/storage .
```

Копию базы и архив файлов делать **сразу друг за другом** и хранить вместе: письма в базе ссылаются на файлы. Копии содержат личные данные пользователей: хранить зашифрованно, с ограниченным доступом, старые удалять (срок хранения — как у кабинетов, `CABINET_TTL_DAYS`).

### Проверить копию (без риска для рабочей базы)

```bash
docker compose exec -T db createdb -U jasno restore_check
docker compose exec -T db pg_restore -U jasno -d restore_check --no-owner < backup/jasno-db-<дата>.dump
docker compose exec -T db psql -U jasno -d restore_check -c 'select count(*) from "Cabinet"'
docker compose exec -T db dropdb -U jasno restore_check
```

### Восстановить

Восстановление **заменяет** текущие данные. Сначала сделать копию текущего состояния.

```bash
docker compose stop app
docker compose exec -T db dropdb -U jasno jasno
docker compose exec -T db createdb -U jasno jasno
docker compose exec -T db pg_restore -U jasno -d jasno --no-owner < backup/jasno-db-<дата>.dump
```

Файлы:

```bash
docker run --rm -v gosorgan01_jasno-storage:/data/storage alpine sh -c 'find /data/storage -mindepth 1 -delete'
docker run --rm -v gosorgan01_jasno-storage:/data/storage -v "$PWD/backup":/backup:ro alpine tar xzf /backup/jasno-storage-<дата>.tgz -C /data/storage
```

```bash
docker compose up -d
```

При запуске права тома снова передаются пользователю `node`, недостающие миграции применяются.

## 4. База в Supabase (DB01-S, Issue #139)

Supabase здесь — PostgreSQL в облаке и, по желанию, бакет для оригиналов писем (Supabase Storage, раздел 5). Prisma, миграции и код те же.

> **Статус.** 23.11.2026 на проекте Ja!sno в Supabase (eu-west-1, Session pooler, Data API выключен): миграции применены через Docker (шаг 5) — 8 миграций, 16 таблиц в схеме `jasno`, в `public` таблиц нет. Сервер на Mac подключается со строгой проверкой сертификата; основной путь через API в режиме demo (регистрация → письмо 01 → факты → дело → объяснение → черновик) прошёл за 5,6 с, удаление аккаунта убрало все строки кабинета. **Не проверены:** сайт в браузере с Supabase, приложение в Docker с Supabase.

### Бесплатный тариф: что важно

| Что | Значение | Что делать |
|---|---|---|
| Размер базы | 500 МБ на проект | хватает для демо; файлы писем в базе не лежат |
| Неактивность | проект **засыпает после недели** почти без запросов | за день до показа открыть сайт или панель; разбудить: Dashboard → проект → *Restore* |
| Резервные копии | автоматических нет | копия вручную, ниже |
| Подключение | прямое — только IPv6; **Session pooler** (порт 5432) — IPv4 | использовать Session pooler, не Transaction pooler (6543) |

Регион проекта Ja!sno: EU (`aws-0-eu-west-1`). Пока команда не решила иначе — только демо- и тестовые аккаунты, без настоящих писем.

### Шаги (делает человек)

1. **Пароль базы — секрет.** Не писать его в Issue, чат, коммит. Если он где-то опубликован: Dashboard → Project Settings → Database → *Reset database password*, старый перестаёт работать.
2. **Закрыть REST-доступ к таблицам.** Dashboard → Project Settings → Data API → выключить *Enable Data API*. Иначе таблицы в схеме `public` доступны через публичный ключ проекта. Ja!sno дополнительно хранит таблицы в своей схеме `jasno`, которой нет в списке *Exposed schemas*.
3. **Сертификат.** Project Settings → Database → SSL Configuration → *Download certificate*. Сохранить как `api/certs/supabase-ca.crt` (папка `api/certs/` в git не попадает).
4. **Адрес в `api/.env`** (Connect → Session pooler; пароль в адресе: спецзнаки кодируются, `$` → `%24`, `@` → `%40`, без квадратных скобок):

   ```
   DATABASE_URL=postgresql://postgres.<id проекта>:<пароль>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?schema=jasno&sslmode=require&sslcert=certs/supabase-ca.crt&sslaccept=strict&connection_limit=5
   TEST_DATABASE_URL=postgresql://jasno:jasno@localhost:5432/jasno
   ```

   - `schema=jasno` — своя схема, не `public`.
   - `sslcert` — путь от папки `api` (так считает Prisma CLI); сервер Ja!sno считает так же. Можно и полный путь. `sslaccept=strict` — сертификат сервера проверяется.
   - `connection_limit=5` — у бесплатного пулера мало соединений.
   - `TEST_DATABASE_URL` обязателен: тесты и `pnpm eval` создают и удаляют схемы и **отказываются работать** с нелокальной базой.
5. **Расширение pgvector (L05, вопросы к архиву).** Dashboard → Database → Extensions → `vector` → *Enable* (схема по умолчанию `extensions` подходит). Если не включить, миграция `20261126100000_archive_rag` сама включит расширение в схеме `public`. Без этой миграции «По моим письмам» отвечает ошибкой (таблицы `LetterChunk` нет).
6. **Таблицы из миграций.**

   **На Mac `pnpm --filter jasno-api db:deploy` с Supabase не работает** (как и `db:studio`, `db:migrate`): ошибка `P1011 ... The certificate was not trusted`. Причина — macOS: у сертификата пулера Supabase срок 5 лет и нет пометки «для сервера» (Extended Key Usage), а macOS такие сертификаты от собственных центров не принимает; Prisma CLI на Mac проверяет сертификат средствами macOS. Отключать проверку (`sslaccept=accept_invalid_certs`) не нужно: миграции запускаются в Linux-контейнере, там сертификат проверяется через OpenSSL и проходит.

   Из корня проекта, Docker Desktop запущен (пароль на экран не выводится):

   ```bash
   docker compose build app
   ```

   ```bash
   DATABASE_URL="$(grep '^DATABASE_URL=' api/.env | cut -d= -f2- | sed -E 's#sslcert=[^&]*#sslcert=/certs/supabase-ca.crt#')" docker run --rm -e DATABASE_URL -v "$PWD/api/certs":/certs:ro --entrypoint node_modules/.bin/prisma -w /app/api jasno-app:local migrate deploy
   ```

   Если корневой `.env` уже настроен для Docker с Supabase (`JASNO_DATABASE_URL`, раздел ниже), то же самое короче: `docker compose -f docker-compose.yml -f docker-compose.supabase.yml run --rm app jasno migrate`.

   На Linux (сервер, CI) достаточно `pnpm --filter jasno-api db:deploy`. Сервер Ja!sno и `pnpm db:seed` работают через драйвер pg (OpenSSL) и на Mac проверяют сертификат без этой проблемы.

   В выводе: все миграции применены. В Dashboard → Table Editor → схема `jasno` — таблицы `Cabinet`, `Case`, `Letter` и другие.
6. **Демо-кабинет** (по желанию, `DEMO_PASSWORD` в `api/.env`):

   ```bash
   pnpm db:seed
   ```

7. **Запуск:** `pnpm dev:api` и `pnpm dev:web` (`web/.env`: `VITE_DATA_MODE=api`). На сайте в углу «сервер», регистрация и загрузка письма работают; в Table Editor появляются строки.

### Docker с Supabase

В корневом `.env` (права `600`):

```
JASNO_DATABASE_URL=<тот же адрес, что в api/.env>
```

```bash
docker compose -f docker-compose.yml -f docker-compose.supabase.yml up -d --build app
```

Сервис `db` не нужен и не запускается. Сертификат из `api/certs/` виден в контейнере по тому же относительному пути. Миграции применяются при запуске, как обычно.

### Резервная копия базы Supabase

Нужен `pg_dump` версии 17 (через Docker). Адрес для `pg_dump` — в формате libpq, без параметров Prisma:

```bash
docker run --rm -v "$PWD/api/certs":/certs:ro -v "$PWD/backup":/backup postgres:17-alpine pg_dump "postgresql://postgres.<id>:<пароль>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/certs/supabase-ca.crt" -n jasno -Fc -f /backup/jasno-supabase-$(date +%F).dump
```

Чтобы пароль не остался в истории терминала, перед командой можно задать `export PGPASSWORD=...` и убрать пароль из адреса.

### Вернуться на локальную базу

В `api/.env` снова `DATABASE_URL=postgresql://jasno:jasno@localhost:5432/jasno`, `pnpm db:up`. Данные в Supabase остаются, локальная база своя.

## 5. Оригиналы писем в Supabase Storage (ST01)

По умолчанию (`STORAGE_MODE=local`) оригиналы писем (PDF и фото) лежат в `STORAGE_DIR/letters/<кабинет>/`. С `STORAGE_MODE=s3` они лежат в закрытом бакете Supabase Storage, ключи объектов те же: `letters/<кабинет>/<случайный ключ>.<pdf|jpg|png>`. Корзина удаления аккаунта — `trash/<задание>/letters/` в том же бакете.

- Бакет закрытый. Ссылок на бакет на сайте и в ответах API нет: оригинал отдаёт только API после проверки владельца (B11).
- Письма сброса пароля (`mail-outbox`) остаются в папке `STORAGE_DIR` на сервере.
- Тесты, e2e и `pnpm eval` всегда работают с папкой, даже если в `api/.env` стоит `s3`.
- Пока команда не решила иначе (шлюз пилота): только демо- и тестовые письма.

### Шаги (делает человек)

1. **Бакет.** Dashboard → Storage → *New bucket*, **Public выключен**.
2. **S3-ключи.** Dashboard → Storage → *S3 Configuration* (или Project Settings → Storage): включить *S3 protocol connection*, скопировать **Endpoint** и **Region**, нажать *New access key*. Секрет показывается один раз. Ключи дают полный доступ ко всем бакетам проекта: только в `api/.env`, не в Issue, чат, коммит. Если ключ где-то опубликован — удалить его там же и создать новый.
3. **Строки в `api/.env`:**

   ```
   STORAGE_MODE=s3
   S3_ENDPOINT=https://<id проекта>.storage.supabase.co/storage/v1/s3
   S3_REGION=eu-west-1
   S3_BUCKET=<имя бакета>
   S3_ACCESS_KEY_ID=<Access key ID>
   S3_SECRET_ACCESS_KEY=<Secret access key>
   ```

   Без любой из строк при `STORAGE_MODE=s3` сервер не стартует и пишет, какой строки нет.
4. **Перенести уже загруженные файлы** из папки в бакет (локальные файлы не удаляются, повторный запуск пропускает уже загруженные):

   ```bash
   pnpm --filter jasno-api storage:upload-local            # только показ: сколько файлов
   pnpm --filter jasno-api storage:upload-local --confirm  # загрузить
   ```

   Переносить нужно для той базы, в которой эти письма записаны: ключи файлов берутся из базы.
5. **Проверка:** `pnpm dev:api`, на сайте загрузить письмо 01 из `fixtures/letters` → в Dashboard → Storage → бакет → `letters/<кабинет>/` появился файл; оригинал открывается на сайте; «Удалить дело» и удаление аккаунта убирают файл из бакета.

### Docker с бакетом

Ключи `S3_*` контейнер берёт из `api/.env`. Режим включается явно, как модель: в корневом `.env` `JASNO_STORAGE_MODE=s3`, затем

```bash
docker compose -f docker-compose.yml -f docker-compose.supabase.yml up -d --build app
```

Том `gosorgan01_jasno-storage` остаётся нужен для писем сброса пароля.

### Вернуться на папку

`STORAGE_MODE=local` в `api/.env`. Файлы, загруженные в бакет за это время, в папке не появятся.
