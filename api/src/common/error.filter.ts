import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { ApiError } from './api-error.js';
import { ERROR_CODES, codeForStatus } from './error-codes.js';

export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/** Переводит любую ошибку в JSON { code, message, details? } с русским текстом. */
export function toErrorBody(error: unknown): {
  status: number;
  body: ErrorBody;
} {
  if (error instanceof ApiError) {
    const body: ErrorBody = { code: error.code, message: error.message };
    if (error.details !== undefined) body.details = error.details;
    return { status: error.getStatus(), body };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        code: 'VALIDATION_FAILED',
        message: ERROR_CODES.VALIDATION_FAILED.message,
        details: error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
    };
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const code = codeForStatus(status);
    return { status, body: { code, message: ERROR_CODES[code].message } };
  }
  return {
    status: 500,
    body: {
      code: 'INTERNAL_ERROR',
      message: ERROR_CODES.INTERNAL_ERROR.message,
    },
  };
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiError');

  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = toErrorBody(error);
    if (status >= 500) {
      // Только имя и текст ошибки: без тела запроса, токенов и паролей.
      const reason =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
      this.logger.error(reason);
    }
    res.status(status).json(body);
  }
}
