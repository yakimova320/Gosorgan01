import { z } from 'zod';
import { ProfileSchema } from '@jasno/shared';

/** Профиль общий с сайтом: packages/shared. */
export { ProfileSchema, type Profile } from '@jasno/shared';

export const UpdateCabinetSchema = z
  .object({
    language: z.enum(['ru']).optional(),
    /** null очищает профиль */
    profile: ProfileSchema.nullable().optional(),
  })
  .strict();
export type UpdateCabinetInput = z.infer<typeof UpdateCabinetSchema>;
