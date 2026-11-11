import type { Claim } from '@prisma/client';
import type { DraftService } from '../src/drafting/draft.service.js';
import type { ConfirmedClaim } from '../src/cases/types.js';
export function compilerContract(
  service: DraftService,
  ordinaryClaims: Claim[],
  unconfirmed: Claim & { status: 'UNCONFIRMED' },
) {
  // @ts-expect-error An ordinary database claim does not carry the private confirmed brand.
  void service.generate(ordinaryClaims, { caseId: 'test' });
  // @ts-expect-error Unconfirmed claims cannot be converted by setting status alone.
  const branded: ConfirmedClaim = { ...unconfirmed, status: 'CONFIRMED' };
  return branded;
}
