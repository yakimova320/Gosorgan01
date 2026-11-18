import type { MailMessage } from './mail-transport.js';

/** Письмо восстановления пароля по-русски. Ссылка ведёт на экран «Новый пароль» сайта. */
export function resetMail(input: {
  to: string;
  appUrl: string;
  token: string;
  ttlMin: number;
}): MailMessage {
  const link = `${input.appUrl.replace(/\/+$/, '')}/reset?token=${encodeURIComponent(input.token)}`;
  return {
    to: input.to,
    subject: 'Ja!sno: новый пароль',
    text: [
      'Здравствуйте!',
      '',
      'Кто-то (возможно, вы) попросил задать новый пароль для аккаунта Ja!sno.',
      'Чтобы задать новый пароль, откройте ссылку:',
      '',
      link,
      '',
      `Ссылка работает один раз и ${input.ttlMin} мин.`,
      'Если вы не просили новый пароль, ничего не делайте: старый пароль продолжает работать.',
      '',
      'Ja!sno',
    ].join('\n'),
  };
}
