import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { resolve } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';
import { resolveSqliteUrl } from './database-url.js';

/** Папка api: и из src/prisma, и из dist/prisma на два уровня выше. */
const API_DIR = resolve(import.meta.dirname, '..', '..');

/**
 * Доступ к базе для всех модулей: @Inject(PrismaService) private readonly db: PrismaService.
 * Соединение открывается при первом запросе. Сейчас поддерживается SQLite;
 * адаптер PostgreSQL подключается в задаче публикации (B13).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: Pick<Env, 'DATABASE_URL'>) {
    const url = resolveSqliteUrl(config.DATABASE_URL, API_DIR);
    if (!url.startsWith('file:')) {
      throw new Error(
        'DATABASE_URL: пока поддерживается только SQLite (file:...)',
      );
    }
    super({ adapter: new PrismaBetterSqlite3({ url }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
