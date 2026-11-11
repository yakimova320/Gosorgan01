import { z } from 'zod';
const date = z.iso.date();
const field = <T extends z.ZodType>(v: T) =>
  z.object({
    value: v.nullable(),
    quote: z.string().min(1).nullable(),
    page: z.number().int().positive().nullable(),
    confidence: z.number().min(0).max(1),
  });
export const ExtractedLetterSchema = z.object({
  authority: field(z.string().min(1)),
  caseNumber: field(z.string().min(1)),
  letterDate: field(date),
  requirements: z.array(field(z.string().min(1))).max(30),
  deadlines: z
    .array(
      z.object({
        date,
        kind: z.enum(['REPLY', 'DOCUMENTS']),
        quote: z.string().min(1),
        page: z.number().int().positive().nullable(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(30),
});
export type ExtractedLetter = z.infer<typeof ExtractedLetterSchema>;
export const ClaimSchema = z.object({
  text: z.string().min(1),
  topic: z.string().min(1),
  basis: z.enum(['DOCUMENT', 'USER', 'ASSUMPTION']),
  status: z.enum(['CONFIRMED', 'UNCONFIRMED', 'SUPERSEDED']),
});
