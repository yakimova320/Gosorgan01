import type { Claim } from '@prisma/client';
declare const confirmedBrand: unique symbol;
export type ConfirmedClaim = Claim & {
  status: 'CONFIRMED';
  readonly [confirmedBrand]: true;
};
export interface NewClaim {
  text: string;
  topic: string;
  quote?: string | null;
  page?: number | null;
  confidence?: number | null;
}
