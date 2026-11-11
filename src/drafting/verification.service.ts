import { Injectable } from '@nestjs/common';
import type { ConfirmedClaim } from '../cases/types.js';
import type { GeneratedDraft } from './draft.schema.js';
import { draftTemplate } from './templates.js';
const tokens = (s: string) => s.match(/[\p{L}\d./-]*\d[\p{L}\d./-]*/gu) ?? [];
@Injectable()
export class VerificationService {
  verify(
    draft: GeneratedDraft,
    claims: ConfirmedClaim[],
    context: { caseNumber?: string | null } = {},
    now = new Date(),
  ) {
    const corpus = claims.map((c) => `${c.text} ${c.quote ?? ''}`).join('\n');
    const allowed = new Set(tokens(corpus));
    const ids = new Set(claims.map((c) => c.id));
    const referenced = claims.filter((c) => draft.usedClaimIds.includes(c.id));
    const expected = draftTemplate(referenced);
    const unknownTokens = tokens(
      draft.germanText + '\n' + draft.russianExplanation,
    ).filter((n) => !allowed.has(n));
    const checks = [
      {
        name: 'confirmed-claims-only',
        passed:
          claims.length > 0 && claims.every((c) => c.status === 'CONFIRMED'),
      },
      {
        name: 'claim-ids',
        passed:
          draft.usedClaimIds.length > 0 &&
          new Set(draft.usedClaimIds).size === draft.usedClaimIds.length &&
          draft.usedClaimIds.every((id) => ids.has(id)),
      },
      {
        name: 'numbers-dates-references',
        passed: unknownTokens.length === 0,
        details: unknownTokens,
      },
      {
        name: 'case-number',
        passed:
          !context.caseNumber ||
          (corpus.includes(context.caseNumber) &&
            draft.germanText.includes(context.caseNumber)),
      },
      // An exact evidence template is intentional: numeric checks alone cannot catch invented prose facts.
      {
        name: 'evidence-template',
        passed:
          draft.germanText === expected.germanText &&
          draft.russianExplanation === expected.russianExplanation,
      },
      {
        name: 'no-past-future-deadlines',
        passed: !this.hasPastFutureDate(draft.germanText, now),
      },
    ];
    return {
      passed: checks.every((c) => c.passed),
      checks,
      checklist: referenced.map((c) => ({
        claimId: c.id,
        fact: c.text,
        source: {
          basis: c.basis,
          letterId: c.letterId,
          quote: c.quote,
          page: c.page,
        },
      })),
    };
  }
  private hasPastFutureDate(text: string, now: Date) {
    // Historic dates inside explicitly quoted documentary evidence remain historic.
    const prose = text
      .split('\n')
      .filter((line) => !line.startsWith('„'))
      .join('\n');
    for (const m of prose.matchAll(
      /(?:bis zum|spätestens am)\s+(\d{2})\.(\d{2})\.(\d{4})/g,
    ))
      if (`${m[3]}-${m[2]}-${m[1]}` < now.toISOString().slice(0, 10))
        return true;
    return false;
  }
}
