import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { ApiError } from './api-error.js';
import { toErrorBody } from './error.filter.js';

describe('toErrorBody', () => {
  it('ApiError даёт свой код, статус и русский текст', () => {
    const { status, body } = toErrorBody(new ApiError('EMAIL_TAKEN'));
    expect(status).toBe(409);
    expect(body).toEqual({
      code: 'EMAIL_TAKEN',
      message: 'Этот e-mail уже зарегистрирован',
    });
  });

  it('ApiError передаёт details', () => {
    const { body } = toErrorBody(new ApiError('UNREADABLE', { pages: [1] }));
    expect(body.details).toEqual({ pages: [1] });
  });

  it('ZodError становится 400 VALIDATION_FAILED со списком полей', () => {
    const r = z.object({ email: z.email() }).safeParse({ email: 'x' });
    const { status, body } = toErrorBody(r.error);
    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details).toEqual({
      fields: { email: expect.any(String) },
    });
  });

  it('ошибка NestJS получает код по статусу', () => {
    const { status, body } = toErrorBody(new NotFoundException());
    expect(status).toBe(404);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('неизвестная ошибка не раскрывает текст', () => {
    const { status, body } = toErrorBody(new Error('password=hunter2'));
    expect(status).toBe(500);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});
