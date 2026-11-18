#!/bin/sh
# B13: служебные команды в контейнере. Всегда от пользователя node: файлы в томе не должны
# принадлежать root, иначе сервер не сможет их удалить (docker compose exec по умолчанию — root).
#   docker compose exec app jasno seed      демо-кабинет (DEMO_PASSWORD из api/.env)
#   docker compose exec app jasno migrate   миграции вручную (обычно они идут при запуске)
set -eu

if [ "$(id -u)" = "0" ]; then
  exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

cd /app/api
case "${1:-}" in
  seed) shift; exec node dist/scripts/seed.js "$@" ;;
  migrate) exec node_modules/.bin/prisma migrate deploy ;;
  *)
    echo "Использование: jasno seed | jasno migrate" >&2
    exit 2
    ;;
esac
