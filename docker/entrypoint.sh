#!/bin/sh
# B13: запуск контейнера Ja!sno.
# 1. (root) права тома хранилища для пользователя node — и для нового, и для уже существующего тома.
# 2. (node) миграции базы; ошибка миграции останавливает запуск, сервер не стартует.
# 3. (node) сервер.
set -eu

STORAGE="${STORAGE_DIR:-/data/storage}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$STORAGE"
  # чинить только если есть чужие файлы: большой том не обходится при каждом запуске
  if [ -n "$(find "$STORAGE" ! -user node -print -quit)" ]; then
    echo "Ja!sno: права тома $STORAGE передаются пользователю node"
    chown -R node:node "$STORAGE"
  fi
  exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

if [ ! -w "$STORAGE" ]; then
  echo "Ja!sno: нет прав на запись в $STORAGE (пользователь $(id -un))" >&2
  exit 1
fi

cd /app/api
echo "Ja!sno: миграции базы (prisma migrate deploy)"
if ! node_modules/.bin/prisma migrate deploy; then
  echo "Ja!sno: миграции не применены — сервер не запущен. Подробности выше." >&2
  exit 1
fi

exec node dist/main.js "$@"
