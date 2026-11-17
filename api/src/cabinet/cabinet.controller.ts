import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ZodPipe } from '../common/zod.pipe.js';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth } from '../auth/session.guard.js';
import {
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
}
