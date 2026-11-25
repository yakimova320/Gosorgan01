import type { Language } from '../common/language.js';
import type { MailMessage } from './mail-transport.js';

const TEXT: Record<Language, { subject: string; lines: (link: string, ttl: number) => string[] }> = {
  ru: {
    subject: 'Ja!sno: новый пароль',
    lines: (link, ttl) => [
      'Здравствуйте!',
      '',
      'Кто-то (возможно, вы) попросил задать новый пароль для аккаунта Ja!sno.',
      'Чтобы задать новый пароль, откройте ссылку:',
      '',
      link,
      '',
      `Ссылка работает один раз и ${ttl} мин.`,
      'Если вы не просили новый пароль, ничего не делайте: старый пароль продолжает работать.',
    ],
  },
  uk: {
    subject: 'Ja!sno: новий пароль',
    lines: (link, ttl) => [
      'Вітаємо!',
      '',
      'Хтось (можливо, ви) попросив задати новий пароль для акаунта Ja!sno.',
      'Щоб задати новий пароль, відкрийте посилання:',
      '',
      link,
      '',
      `Посилання працює один раз і ${ttl} хв.`,
      'Якщо ви не просили новий пароль, нічого не робіть: старий пароль і далі працює.',
    ],
  },
  de: {
    subject: 'Ja!sno: neues Passwort',
    lines: (link, ttl) => [
      'Hallo!',
      '',
      'Jemand (vielleicht Sie) möchte ein neues Passwort für das Ja!sno-Konto.',
      'Für ein neues Passwort öffnen Sie diesen Link:',
      '',
      link,
      '',
      `Der Link geht einmal und ${ttl} Minuten lang.`,
      'Haben Sie kein neues Passwort verlangt? Dann tun Sie nichts. Das alte Passwort geht weiter.',
    ],
  },
};

/** Письмо восстановления пароля на языке кабинета (L07). Ссылка ведёт на экран «Новый пароль» сайта. */
export function resetMail(input: {
  to: string;
  appUrl: string;
  token: string;
  ttlMin: number;
  lang?: Language;
}): MailMessage {
  const link = `${input.appUrl.replace(/\/+$/, '')}/reset?token=${encodeURIComponent(input.token)}`;
  const T = TEXT[input.lang ?? 'ru'];
  return {
    to: input.to,
    subject: T.subject,
    text: [...T.lines(link, input.ttlMin), '', 'Ja!sno'].join('\n'),
  };
}
