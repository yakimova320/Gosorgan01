import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const originalStatus =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const status = originalStatus === 413 ? 422 : originalStatus;
    const raw =
      exception instanceof HttpException ? exception.getResponse() : null;
    const body =
      typeof raw === 'object' && raw ? (raw as Record<string, unknown>) : {};
    const code =
      body.code ??
      (
        {
          400: 'INVALID_REQUEST',
          404: 'NOT_FOUND',
          409: 'CONFLICT',
          413: 'INVALID_FILE',
          422: 'UNPROCESSABLE',
          502: 'LLM_FAILED',
          503: 'SERVICE_UNAVAILABLE',
        } as Record<number, string>
      )[status] ??
      'INTERNAL_ERROR';
    if (status === 500)
      this.logger.error(
        exception instanceof Error ? exception.stack : 'Unknown internal error',
      );
    response
      .status(status)
      .json({
        code,
        message:
          body.message ??
          (typeof raw === 'string' ? raw : 'Внутренняя ошибка сервера'),
        ...(body.details ? { details: body.details } : {}),
      });
  }
}
