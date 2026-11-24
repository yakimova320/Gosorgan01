import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth, Public } from '../auth/session.guard.js';
import { ApiError } from '../common/api-error.js';
import { IpLimit } from '../common/ip-limits.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { CalendarService, type CalendarView } from './calendar.service.js';

const PatchCalendarSchema = z.object({ reminderEmail: z.boolean() }).strict();

const VIEW_EXAMPLE = {
  feedPath: '/calendar/Xk3...43знака.ics',
  reminderEmail: true,
};

@ApiTags('Календарь')
@ApiBearerAuth()
@Controller('cabinet/calendar')
export class CalendarSettingsController {
  constructor(@Inject(CalendarService) private readonly calendar: CalendarService) {}

  @Get()
  @ApiOperation({
    summary: 'Ссылка на календарь сроков и напоминания по e-mail (K12)',
    description: 'feedPath: null, пока ссылка не создана. Полный адрес = адрес API + feedPath.',
  })
  @ApiOkResponse({ schema: { example: VIEW_EXAMPLE } })
  view(@CurrentAuth() auth: AuthContext): Promise<CalendarView> {
    return this.calendar.view(auth.cabinetId);
  }

  @Post('token')
  @ApiOperation({
    summary: 'Создать ссылку на календарь или заменить её новой (K12)',
    description: 'Старый адрес после замены отдаёт 404.',
  })
  @ApiOkResponse({ schema: { example: VIEW_EXAMPLE } })
  reset(@CurrentAuth() auth: AuthContext): Promise<CalendarView> {
    return this.calendar.resetToken(auth.cabinetId);
  }

  @Delete('token')
  @ApiOperation({ summary: 'Отключить ссылку на календарь (K12)' })
  @ApiOkResponse({ schema: { example: { feedPath: null, reminderEmail: true } } })
  remove(@CurrentAuth() auth: AuthContext): Promise<CalendarView> {
    return this.calendar.removeToken(auth.cabinetId);
  }

  @Patch()
  @ApiOperation({ summary: 'Включить или выключить напоминание по e-mail за 3 дня (K12)' })
  @ApiBody({ schema: { example: { reminderEmail: false } } })
  @ApiOkResponse({ schema: { example: { ...VIEW_EXAMPLE, reminderEmail: false } } })
  patch(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(PatchCalendarSchema)) body: { reminderEmail: boolean },
  ): Promise<CalendarView> {
    return this.calendar.setReminderEmail(auth.cabinetId, body.reminderEmail);
  }
}

/** Публичная лента: календарь телефона забирает её без входа, доступ по токену в адресе. */
@ApiTags('Календарь')
@Controller('calendar')
export class CalendarFeedController {
  constructor(@Inject(CalendarService) private readonly calendar: CalendarService) {}

  @Public()
  @Get(':file')
  @UseGuards(ThrottlerGuard)
  @IpLimit('calendarFeed')
  @Header('Cache-Control', 'private, max-age=300')
  @ApiOperation({
    summary: 'Лента календаря: все действующие сроки кабинета, text/calendar (K12)',
    description:
      'Адрес вида /calendar/<токен>.ics. Без входа. Неизвестный или сброшенный токен: 404. В событиях нет текста письма.',
  })
  @ApiOkResponse({ description: 'text/calendar; charset=utf-8' })
  @ApiNotFoundResponse({ schema: { example: { code: 'NOT_FOUND', message: 'Не найдено' } } })
  async feed(@Param('file') file: string): Promise<StreamableFile> {
    const m = /^(.+)\.ics$/.exec(file);
    if (!m) throw new ApiError('NOT_FOUND');
    const text = await this.calendar.feed(m[1]);
    return new StreamableFile(Buffer.from(text, 'utf8'), {
      type: 'text/calendar; charset=utf-8',
      disposition: 'inline; filename="jasno.ics"',
    });
  }
}
