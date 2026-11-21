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
  constructor(@Inject(APP_CONFIG) config: Pick<Env, 'DATABASE_URL'>) {
    // относительный sslcert — от api/prisma, как у Prisma CLI (DB01-S)
    const { connectionString, schema, ssl, max } = parseDatabaseUrl(
      config.DATABASE_URL,
      resolve(import.meta.dirname, '..', '..', 'prisma'),
    );
    super({
      adapter: new PrismaPg(
        { connectionString, ...(ssl ? { ssl } : {}), ...(max ? { max } : {}) },
        { schema },
      ),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
