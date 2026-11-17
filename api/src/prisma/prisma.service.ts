import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
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
    const { connectionString, schema } = parseDatabaseUrl(config.DATABASE_URL);
    super({ adapter: new PrismaPg({ connectionString }, { schema }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
