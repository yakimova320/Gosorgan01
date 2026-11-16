import { Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Проверка входных данных схемой Zod.
 * Пример: @Body(new ZodPipe(RegisterSchema)) body: z.infer<typeof RegisterSchema>
 * Ошибка уходит в ApiErrorFilter и превращается в 400 VALIDATION_FAILED.
 */
@Injectable()
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    return this.schema.parse(value);
  }
}
