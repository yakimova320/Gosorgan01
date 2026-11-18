# syntax=docker/dockerfile:1
# B13: один контейнер Ja!sno — API отдаёт API и собранный сайт. База — отдельный сервис (docker-compose.yml).
# Оба этапа на одной базе (Debian bookworm, Node 24): движки Prisma и нативные модули совместимы.

FROM node:24-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /src

# --- Сборка: shared, api, web ------------------------------------------------
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# сайт обращается к API по тому же адресу (пустой VITE_API_URL), данные с сервера
ENV VITE_API_URL=
ENV VITE_DATA_MODE=api
RUN pnpm build
# зависимости API для работы (вместе с @jasno/shared, Prisma Client и Prisma CLI для migrate deploy)
RUN pnpm --filter jasno-api deploy --prod --legacy /deploy

# --- Работа ------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000 \
  STORAGE_DIR=/data/storage \
  WEB_DIST_DIR=/app/web/dist
WORKDIR /app
COPY --from=build /deploy /app/api
COPY --from=build /src/api/dist /app/api/dist
COPY --from=build /src/web/dist /app/web/dist
# синтетические письма для LLM_MODE=demo (адаптер demo ищет их от api/dist)
COPY --from=build /src/fixtures/letters /app/fixtures/letters
COPY docker/entrypoint.sh /usr/local/bin/jasno-entrypoint
COPY docker/jasno.sh /usr/local/bin/jasno
RUN chmod 0755 /usr/local/bin/jasno-entrypoint /usr/local/bin/jasno \
  && mkdir -p /data/storage \
  && chown -R node:node /data
WORKDIR /app/api
VOLUME ["/data/storage"]
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# стартует от root только чтобы поправить права тома, затем работает как node
ENTRYPOINT ["jasno-entrypoint"]
