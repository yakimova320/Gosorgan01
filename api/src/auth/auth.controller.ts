import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiAcceptedResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ZodPipe } from '../common/zod.pipe.js';
import {
  ChangePasswordSchema,
  ForgotPasswordSchema,
  LoginSchema,
  RegisterSchema,
  ResetPasswordSchema,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type ResetPasswordInput,
  type LoginInput,
  type RegisterInput,
} from './auth.schemas.js';
import { AuthService, type AuthContext } from './auth.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { CurrentAuth, Public } from './session.guard.js';

const err = (code: string, message: string) => ({
  schema: { example: { code, message } },
});
const TOKEN_EXAMPLE = {
  schema: { example: { sessionToken: 'Q2xhdWRl...43 знака base64url' } },
};

@ApiTags('Регистрация и вход')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PasswordResetService) private readonly reset: PasswordResetService,
  ) {}

  @Public()
  @Post('register')
  @ApiBody({
    schema: {
      example: {
        email: 'anna@example.org',
        password: 'mein-langes-Passwort',
        firstName: 'Anna',
        lastName: 'Muster',
        address: 'Musterstr. 1, 10115 Berlin',
        consent: true,
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Кабинет создан, пользователь сразу вошёл',
    ...TOKEN_EXAMPLE,
  })
  @ApiBadRequestResponse({
    description:
      'CONSENT_REQUIRED, PASSWORD_TOO_LONG (больше 72 байт) или VALIDATION_FAILED',
    ...err('CONSENT_REQUIRED', 'Нужно согласие на обработку данных'),
  })
  @ApiConflictResponse(err('EMAIL_TAKEN', 'Этот e-mail уже зарегистрирован'))
  register(@Body(new ZodPipe(RegisterSchema)) body: RegisterInput) {
    return this.auth.register(body);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiBody({
    schema: {
      example: { email: 'anna@example.org', password: 'mein-langes-Passwort' },
    },
  })
  @ApiOkResponse(TOKEN_EXAMPLE)
  @ApiUnauthorizedResponse({
    description: 'Неверный пароль и неизвестный e-mail дают одинаковый ответ',
    ...err('INVALID_CREDENTIALS', 'Неверный e-mail или пароль'),
  })
  @ApiTooManyRequestsResponse({
    description: 'После 4 неудачных попыток на один e-mail за 15 минут',
    ...err('RATE_LIMITED', 'Слишком много попыток. Подождите немного'),
  })
  login(@Body(new ZodPipe(LoginSchema)) body: LoginInput) {
    return this.auth.login(body);
  }

  @Post('password/change')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiBody({
    schema: {
      example: {
        oldPassword: 'mein-langes-Passwort',
        newPassword: 'ein-neues-Passwort',
      },
    },
  })
  @ApiNoContentResponse({
    description:
      'Пароль изменён. Текущая сессия остаётся, другие сессии и ссылки восстановления пароля аннулированы',
  })
  @ApiBadRequestResponse({
    description: 'PASSWORD_TOO_LONG (больше 72 байт) или VALIDATION_FAILED',
    ...err('PASSWORD_TOO_LONG', 'Пароль слишком длинный'),
  })
  @ApiUnauthorizedResponse({
    description:
      'INVALID_CREDENTIALS: неверный текущий пароль (details.fields.oldPassword), сессия не завершается. ' +
      'UNAUTHORIZED: сессии нет или её завершила другая смена пароля',
    ...err('INVALID_CREDENTIALS', 'Неверный пароль'),
  })
  @ApiConflictResponse({
    description: 'Идёт удаление аккаунта',
    ...err(
      'ACCOUNT_DELETING',
      'Удаление аккаунта продолжается. Повторять запрос не нужно',
    ),
  })
  @ApiTooManyRequestsResponse({
    description: 'После 4 неверных текущих паролей за 15 минут',
    ...err('RATE_LIMITED', 'Слишком много попыток. Подождите немного'),
  })
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(ChangePasswordSchema)) body: ChangePasswordInput,
  ): Promise<void> {
    await this.auth.changePassword(auth, body);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiNoContentResponse({ description: 'Сессия завершена' })
  @ApiUnauthorizedResponse(err('UNAUTHORIZED', 'Войдите, чтобы продолжить'))
  async logout(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.auth.logout(auth);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(202)
  @UseGuards(ThrottlerGuard)
  @ApiBody({ schema: { example: { email: 'anna@example.org' } } })
  @ApiAcceptedResponse({
    description:
      'Всегда один ответ, есть адрес или нет. Письмо уходит в фоне; не больше 3 писем в час на адрес (сверх лимита ответ тот же, письма нет)',
    schema: {
      example: {
        message: 'Если такой адрес есть, мы отправили письмо',
      },
    },
  })
  @ApiBadRequestResponse(err('VALIDATION_FAILED', 'Проверьте введённые данные'))
  @ApiTooManyRequestsResponse({
    description: 'Больше 10 запросов в час с одного IP',
    ...err('RATE_LIMITED', 'Слишком много попыток. Подождите немного'),
  })
  async forgot(
    @Body(new ZodPipe(ForgotPasswordSchema)) body: ForgotPasswordInput,
  ): Promise<{ message: string }> {
    await this.reset.forgot(body.email);
    return { message: 'Если такой адрес есть, мы отправили письмо' };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(204)
  @ApiBody({
    schema: {
      example: { token: 'Q2xhdWRl...43 знака base64url', newPassword: 'ein-neues-Passwort' },
    },
  })
  @ApiNoContentResponse({
    description:
      'Пароль изменён. Все сессии завершены, все ссылки восстановления удалены, ожидающие письма отменены',
  })
  @ApiBadRequestResponse({
    description:
      'RESET_TOKEN_INVALID: неверная, просроченная или уже использованная ссылка (один ответ на все случаи); PASSWORD_TOO_LONG; VALIDATION_FAILED',
    ...err(
      'RESET_TOKEN_INVALID',
      'Ссылка недействительна или устарела. Запросите новое письмо',
    ),
  })
  async resetPassword(
    @Body(new ZodPipe(ResetPasswordSchema)) body: ResetPasswordInput,
  ): Promise<void> {
    await this.reset.reset(body.token, body.newPassword);
  }
}
