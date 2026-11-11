import type { LlmProvider, ProviderRequest } from './provider.js';
// STUB: deterministic, deliberately limited offline demonstration; not a language model.
export class DemoLlmProvider implements LlmProvider {
  readonly name = 'demo';
  readonly model = 'deterministic-demo-v1';
  complete(request: ProviderRequest) {
    let result: unknown;
    if (request.promptName === 'extract')
      result = this.extract(String(request.variables.text));
    else if (request.promptName === 'dialogue')
      result = {
        claims: [
          { text: String(request.variables.message), topic: 'userStatement' },
        ],
        questions: [
          'Какие документы вы отправили?',
          'Когда и каким способом вы их отправили?',
          'Есть ли подтверждение отправки или получения?',
        ],
      };
    else
      result = {
        germanText: request.variables.expectedGermanText,
        russianExplanation: request.variables.expectedRussianExplanation,
        usedClaimIds: request.variables.claimIds,
      };
    return Promise.resolve({ content: JSON.stringify(result), tokens: null });
  }
  private extract(text: string) {
    const lines = text
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const iso = (d: string) => d.split('.').reverse().join('-');
    const field = (value: string | null, quote: string | null) => ({
      value,
      quote,
      page: value ? 1 : null,
      confidence: value ? 0.85 : 0,
    });
    const authority =
      lines.find((l) =>
        /^(Jobcenter|Bürgeramt|Ausländerbehörde|Finanzamt|Familienkasse|Wohngeldstelle|Sozialamt)/.test(
          l,
        ),
      ) ?? null;
    const number = text.match(
      /(?:Aktenzeichen|Kundennummer|Geschäftszeichen):\s*([^\s]+)/,
    );
    const date = text.match(/Datum:\s*(\d{2}\.\d{2}\.\d{4})/);
    const requirements = lines
      .filter((l) =>
        /^(Bitte reichen|Bitte senden|Bitte legen|Bitte bestätigen|Wir bestätigen|Ihre Unterlagen)/.test(
          l,
        ),
      )
      .map((l) => field(l, l));
    const deadlines = [
      ...text.matchAll(/(?:bis zum|spätestens am)\s+(\d{2}\.\d{2}\.\d{4})/g),
    ].map((m) => ({
      date: iso(m[1]),
      kind: 'DOCUMENTS',
      quote: m[0],
      page: 1,
      confidence: 0.85,
    }));
    return {
      authority: field(authority, authority),
      caseNumber: field(number?.[1] ?? null, number?.[0] ?? null),
      letterDate: field(date ? iso(date[1]) : null, date?.[0] ?? null),
      requirements,
      deadlines,
    };
  }
}
