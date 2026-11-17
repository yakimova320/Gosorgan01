import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
  LoginSchema,
  RegisterSchema,
  type LoginInput,
  type RegisterInput,
} from './auth.schemas.js';
import { AuthService, type AuthContext } from './auth.service.js';
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
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

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

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiNoContentResponse({ description: 'Сессия завершена' })
  @ApiUnauthorizedResponse(err('UNAUTHORIZED', 'Войдите, чтобы продолжить'))
  async logout(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.auth.logout(auth);
  }
}
