import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/*
 * B13: в контейнере API отдаёт и собранный сайт (web/dist). Включается только WEB_DIST_DIR;
 * при pnpm dev сайт по-прежнему отдаёт Vite.
 *
 * Два отдельных шага:
 * 1. Файлы сборки (index.html не по адресу /, assets/*). Нет файла — дальше, к Nest: 404 JSON.
 * 2. SPA fallback: index.html только для адресов страниц сайта (список ниже, как в web/src/app/App.tsx).
 *    Неизвестные адреса API, отсутствующие ресурсы и адреса с точкой получают 404, не HTML.
 */

/** Адреса страниц сайта. Пути API (/auth, /cases, /letters, ...) сюда не попадают. */
const WEB_PAGES: readonly RegExp[] = [
  /^\/$/,
  /^\/(login|register|forgot|reset|faq|wissen|beratung)\/?$/,
  /^\/app(\/[^.]*)?$/,
];

export function isWebPage(path: string): boolean {
  return WEB_PAGES.some((re) => re.test(path));
}

export function serveWeb(app: NestExpressApplication, webDistDir: string): void {
  const dir = resolve(webDistDir);
  const index = join(dir, 'index.html');
  if (!existsSync(index))
    throw new Error(`WEB_DIST_DIR: нет ${index}. Соберите сайт (pnpm build:web) или уберите WEB_DIST_DIR.`);

  const assets = join(dir, 'assets');
  app.useStaticAssets(dir, {
    index: false,
    redirect: false,
    fallthrough: true,
    setHeaders: (res, path) => {
      // имена в assets/ содержат хэш: можно кэшировать надолго
      res.setHeader(
        'Cache-Control',
        path.startsWith(assets) ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !isWebPage(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}
