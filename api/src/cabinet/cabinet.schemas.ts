import { z } from 'zod';
import { LanguageSchema, ProfilePatchSchema } from '@jasno/shared';

export { DeleteAccountSchema, type DeleteAccountInput } from '@jasno/shared';

/** Профиль общий с сайтом: packages/shared. */
export { ProfilePatchSchema, ProfileSchema, type Profile } from '@jasno/shared';

export const UpdateCabinetSchema = z
  .object({
    // L07 (#83): язык кабинета: интерфейс, ответы ИИ, письма с сайта
    language: LanguageSchema.optional(),
    /** Можно прислать одно поле профиля; очистить имя, фамилию или адрес нельзя */
    profile: ProfilePatchSchema.optional(),
    /** K11 (#134): true — дать согласие на анализ письма ИИ, false — отозвать */
    aiConsent: z.boolean().optional(),
  })
  .strict();
export type UpdateCabinetInput = z.infer<typeof UpdateCabinetSchema>;
