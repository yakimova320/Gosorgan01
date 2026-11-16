import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);

export const ProfileSchema = z
  .object({
    firstName: text(100).optional(),
    lastName: text(100).optional(),
    address: text(300).optional(),
    numbers: z
      .array(
        z.object({ label: text(80).min(1), value: text(80).min(1) }).strict(),
      )
      .max(10)
      .optional(),
  })
  .strict();

export const UpdateCabinetSchema = z
  .object({
    language: z.enum(['ru']).optional(),
    /** null очищает профиль */
    profile: ProfileSchema.nullable().optional(),
  })
  .strict();
export type UpdateCabinetInput = z.infer<typeof UpdateCabinetSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
