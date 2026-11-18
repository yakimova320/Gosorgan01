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
