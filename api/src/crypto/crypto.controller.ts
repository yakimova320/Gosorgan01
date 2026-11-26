import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { isWrappedMaster } from '@jasno/shared';
import { z } from 'zod';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth } from '../auth/session.guard.js';
import { ApiError } from '../common/api-error.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LegacyEncryptionService, type LegacyStep } from './legacy-encryption.service.js';

const CreateVaultSchema = z
  .object({
    wrappedMaster: z.string().refine(isWrappedMaster, { message: 'Неверная запись ключа' }),
  })
  .strict();

const WRAPPED_EXAMPLE =
  'jxm1.<соль 16 байт>.<IV 12 байт>.<мастер-ключ под ключом из секрета восстановления>';

/*
 * E01 (#163): ключ архива. Сервер хранит только зашифрованные записи ключей (jxm1, jxk1):
 * мастер-ключ создаёт браузер и шифрует секретом восстановления, который знает только человек.
 * По дампу базы и секретам сервера архив не открыть.
 */
@ApiTags('Шифрование')
@ApiBearerAuth()
@Controller('crypto')
export class CryptoController {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(LegacyEncryptionService) private readonly legacy: LegacyEncryptionService,
  ) {}

  @Get('vault')
  @ApiOperation({
    summary: 'Зашифрованный мастер-ключ кабинета (E01)',
    description:
      'Браузер открывает его секретом восстановления. wrappedMaster null: ключ архива ещё не создан. ' +
      'cabinetId входит в AAD шифротекста.',
  })
  @ApiOkResponse({
    schema: { example: { cabinetId: 'cm0cab…', wrappedMaster: WRAPPED_EXAMPLE, version: 1 } },
  })
  async vault(
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ cabinetId: string; wrappedMaster: string | null; version: number }> {
    const v = await this.db.keyVault.findUnique({ where: { cabinetId: auth.cabinetId } });
    return { cabinetId: auth.cabinetId, wrappedMaster: v?.wrappedMaster ?? null, version: v?.version ?? 1 };
  }

  @Post('vault')
  @ApiOperation({
    summary: 'Создать ключ архива (E01)',
    description:
      'Один раз на кабинет. Сброс пароля ключ не меняет. 409 VAULT_EXISTS: ключ уже есть, его не перезаписать.',
  })
  @ApiBody({ schema: { example: { wrappedMaster: WRAPPED_EXAMPLE } } })
  @ApiConflictResponse({ description: 'VAULT_EXISTS' })
  async createVault(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(CreateVaultSchema)) body: { wrappedMaster: string },
  ): Promise<{ cabinetId: string; wrappedMaster: string; version: number }> {
    const created = await this.db.keyVault.createMany({
      data: [{ cabinetId: auth.cabinetId, wrappedMaster: body.wrappedMaster }],
      skipDuplicates: true,
    });
    if (created.count !== 1) throw new ApiError('VAULT_EXISTS');
    return { cabinetId: auth.cabinetId, wrappedMaster: body.wrappedMaster, version: 1 };
  }

  @Get('keys')
  @ApiOperation({
    summary: 'Ключи документов кабинета под мастер-ключом (E01)',
    description:
      'Браузер открывает их мастер-ключом в памяти. legacy: сколько писем и дел загружено до шифрования.',
  })
  @ApiOkResponse({
    schema: {
      example: { keys: [{ keyId: '3f0c…-uuid', wrapped: 'jxk1.<IV>.<ключ>' }], legacy: 0 },
    },
  })
  async keys(
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ keys: { keyId: string; wrapped: string }[]; legacy: number }> {
    const rows = await this.db.documentKey.findMany({
      where: { cabinetId: auth.cabinetId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, wrapped: true },
    });
    return {
      keys: rows.map((r) => ({ keyId: r.id, wrapped: r.wrapped })),
      legacy: await this.legacy.remaining(auth.cabinetId),
    };
  }

  @Post('legacy')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Зашифровать одно письмо или дело, загруженное до шифрования (E01)',
    description:
      'Браузер присылает новый ключ (x-jasno-new-key) и повторяет запрос, пока remaining не станет 0. ' +
      'Шифруются текст, факты, объяснение, перевод, оригиналы, дело и черновики.',
  })
  @ApiOkResponse({ schema: { example: { done: { kind: 'letter', id: 'cm0…' }, remaining: 2 } } })
  encryptLegacy(@CurrentAuth() auth: AuthContext): Promise<LegacyStep> {
    return this.legacy.next(auth.cabinetId);
  }
}
