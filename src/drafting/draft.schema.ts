import { z } from 'zod';
export const DraftSchema = z.object({
  germanText: z.string().min(1).max(30000),
  russianExplanation: z.string().min(1).max(10000),
  usedClaimIds: z.array(z.string()).min(1).max(100),
});
export type GeneratedDraft = z.infer<typeof DraftSchema>;
