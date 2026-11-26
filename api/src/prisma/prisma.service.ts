import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { resolve } from 'node:path';
import { PrismaClient } from '../generated/prisma/client.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';
import { parseDatabaseUrl } from './database-url.js';

/**
 * Доступ к базе для всех модулей: @Inject(PrismaService) private readonly db: PrismaService.
 * База только PostgreSQL. Соединение открывается при первом запросе.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  /** Схема таблиц (параметр schema в DATABASE_URL). Нужна сырому SQL: L05, archive.repository.ts. */
  readonly dbSchema: string;

  constructor(@Inject(APP_CONFIG) config: Pick<Env, 'DATABASE_URL'>) {
    // относительный sslcert — от папки api, как у Prisma CLI (проверено 23.11 с Supabase)
    const { connectionString, schema, ssl, max } = parseDatabaseUrl(
      config.DATABASE_URL,
      resolve(import.meta.dirname, '..', '..'),
    );
    super({
      adapter: new PrismaPg(
        { connectionString, ...(ssl ? { ssl } : {}), ...(max ? { max } : {}) },
        { schema },
      ),
    });
    this.dbSchema = schema ?? 'public';
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
