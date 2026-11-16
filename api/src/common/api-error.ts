import { HttpException } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode } from './error-codes.js';

/** Ошибка API с кодом из ERROR_CODES. Пример: throw new ApiError('EMAIL_TAKEN'). */
export class ApiError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    readonly details?: unknown,
    message?: string,
  ) {
    const def = ERROR_CODES[code];
    super({ code, message: message ?? def.message, details }, def.status);
  }
}
