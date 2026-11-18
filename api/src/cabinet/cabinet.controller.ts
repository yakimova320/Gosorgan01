import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Patch,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiAcceptedResponse,
  ApiBody,
  ApiConflictResponse,
  ApiInternalServerErrorResponse,
  ApiNoContentResponse,
  ApiTooManyRequestsResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ZodPipe } from '../common/zod.pipe.js';
import type { AuthContext } from '../auth/auth.service.js';
import { AllowWhileDeleting, CurrentAuth } from '../auth/session.guard.js';
import {
  DeleteAccountSchema,
  type DeleteAccountInput,
  UpdateCabinetSchema,
  type UpdateCabinetInput,
} from './cabinet.schemas.js';
import { CabinetService, type CabinetView } from './cabinet.service.js';

const CABINET_EXAMPLE: CabinetView = {
  email: 'anna@example.org',
  language: 'ru',
  profile: {
    firstName: 'Anna',
    lastName: 'Muster',
    address: 'Musterstr. 1, 10115 Berlin',
    numbers: [{ label: 'Kundennummer', value: '123A456' }],
  },
  counts: { openTasks: 1, activeCases: 2, inboxLetters: 0 },
  nextDeadline: {
    date: '2026-12-01',
    caseId: 'cm0abc123',
    title: 'Jobcenter: выписки со счёта',
  },
};
const UNAUTHORIZED = {
  schema: {
    example: { code: 'UNAUTHORIZED', message: 'Войдите, чтобы продолжить' },
  },
};

@ApiTags('Кабинет')
@ApiBearerAuth()
@Controller('cabinet')
export class CabinetController {
  constructor(
    @Inject(CabinetService) private readonly cabinet: CabinetService,
  ) {}

  @Get()
  @ApiOkResponse({
    description: 'Кабинет. profile и nextDeadline могут быть null.',
    schema: { example: CABINET_EXAMPLE },
  })
  @ApiUnauthorizedResponse({
    description: 'Нет сессии или она истекла',
    ...UNAUTHORIZED,
  })
  get(@CurrentAuth() auth: AuthContext): Promise<CabinetView> {
    return this.cabinet.get(auth.cabinetId);
  }

  @Patch()
  @ApiOperation({
    summary: 'Изменить язык или профиль',
    description:
      'Профиль можно менять по одному полю. Итог проверяется целиком: имя, фамилию и адрес очистить нельзя. ' +
      'Имя и фамилия: латинские буквы, пробел, дефис, апостроф.',
  })
  @ApiBody({
    schema: {
      example: { profile: { address: 'Neue Str. 2, 10115 Berlin' } },
    },
  })
  @ApiOkResponse({
    description: 'Обновлённый кабинет',
    schema: { example: CABINET_EXAMPLE },
  })
  @ApiBadRequestResponse({
    schema: {
      example: {
        code: 'VALIDATION_FAILED',
        message: 'Проверьте введённые данные',
        details: {
          fields: { 'profile.firstName': 'Введите имя латинскими буквами' },
        },
      },
    },
  })
  @ApiUnauthorizedResponse(UNAUTHORIZED)
  update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(UpdateCabinetSchema)) body: UpdateCabinetInput,
  ): Promise<CabinetView> {
    return this.cabinet.update(auth.cabinetId, body);
  }

  @Delete()
  @AllowWhileDeleting()
  @ApiOperation({
    summary: 'Удалить аккаунт полностью (A01)',
    description:
      'Нужен текущий пароль. Кабинет берётся только из сессии. Удаляются все строки кабинета ' +
      '(сессии, токены, дела, письма, факты, сроки, события, черновики), журнал LlmCall и файлы писем. ' +
      '204: удалено всё. 202 DELETION_PENDING: база уже удалена, файлы дочищаются в фоне, повторять не нужно. ' +
      'Пока удаление идёт, остальные запросы этой сессии получают 409 ACCOUNT_DELETING. ' +
      'Повторный DELETE продолжает то же задание.',
  })
  @ApiBody({ schema: { example: { password: 'mein-langes-Passwort' } } })
  @ApiNoContentResponse({ description: 'Аккаунт и все данные удалены' })
  @ApiAcceptedResponse({
    description: 'База удалена, очистка файлов продолжается',
    schema: {
      example: {
        code: 'DELETION_PENDING',
        message: 'Удаление аккаунта продолжается. Повторять запрос не нужно',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description:
      'INVALID_CREDENTIALS: неверный пароль, сессия остаётся. UNAUTHORIZED: нет сессии',
    schema: {
      example: {
        code: 'INVALID_CREDENTIALS',
        message: 'Неверный e-mail или пароль',
      },
    },
  })
  @ApiTooManyRequestsResponse({
    description: 'RATE_LIMITED: 4 неверных пароля за 15 минут',
  })
  @ApiConflictResponse({ description: 'ACCOUNT_DELETING (у других запросов)' })
  @ApiInternalServerErrorResponse({
    description:
      'ERASURE_FAILED: удалить не получилось, данные возвращены или возвращаются',
  })
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(DeleteAccountSchema)) body: DeleteAccountInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ code: 'DELETION_PENDING'; message: string } | undefined> {
    const outcome = await this.cabinet.deleteAccount(
      auth.cabinetId,
      body.password,
    );
    if (outcome === 'DONE') {
      res.status(204);
      return undefined;
    }
    res.status(202);
    return {
      code: 'DELETION_PENDING',
      message: 'Удаление аккаунта продолжается. Повторять запрос не нужно',
    };
  }
}
