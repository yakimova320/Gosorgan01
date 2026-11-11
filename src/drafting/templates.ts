import type { ConfirmedClaim } from '../cases/types.js';
export function draftTemplate(claims: ConfirmedClaim[]) {
  const evidence = [...new Set(claims.map((c) => c.quote ?? c.text))];
  return {
    germanText: [
      'Sehr geehrte Damen und Herren,',
      '',
      'ich beziehe mich auf Ihre Korrespondenz. Darin sind folgende Angaben enthalten:',
      ...evidence.map((q) => `„${q}“`),
      '',
      'Bitte teilen Sie mir mit, welche weiteren Unterlagen oder Angaben Sie benötigen.',
      '',
      'Mit freundlichen Grüßen',
    ].join('\n'),
    russianExplanation:
      'Это проект запроса уточнения. В нём дословно приведены только проверенные вами сведения из документов. Перед отправкой проверьте содержание и добавьте своё имя. Письмо не отправлено.',
    usedClaimIds: claims.map((c) => c.id),
  };
}
