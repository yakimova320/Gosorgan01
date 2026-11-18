import { Inject, Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/*
 * A03: отправка писем через nodemailer (официального пакета @nestjs/* для почты нет).
 * file: письмо собирается в .eml (streamTransport), сохраняет его вызывающий под блокировкой кабинета.
 * smtp: настоящая отправка. Отладочный вывод nodemailer выключен: в нём были бы адрес и ссылка.
 */
@Injectable()
export class MailTransport {
  private readonly composer = createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'unix',
  });
  private smtp: Transporter | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: Env) {}

  get mode(): Env['MAIL_MODE'] {
    return this.config.MAIL_MODE;
  }

  /** Готовое письмо .eml для режима file. */
  async compose(message: MailMessage): Promise<Buffer> {
    const info = await this.composer.sendMail(this.envelope(message));
    return info.message as Buffer;
  }

  async sendSmtp(message: MailMessage): Promise<void> {
    this.smtp ??= createTransport({
      host: this.config.SMTP_HOST,
      port: this.config.SMTP_PORT ?? 587,
      secure: this.config.SMTP_SECURE ?? this.config.SMTP_PORT === 465,
      auth: this.config.SMTP_USER
        ? { user: this.config.SMTP_USER, pass: this.config.SMTP_PASS ?? '' }
        : undefined,
      logger: false,
      debug: false,
    });
    await this.smtp.sendMail(this.envelope(message));
  }

  private envelope(message: MailMessage) {
    return {
      from: this.config.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      // quoted-printable, а не base64: ссылку видно, если открыть .eml как текст
      textEncoding: 'quoted-printable' as const,
    };
  }
}

/**
 * Безопасный код ошибки отправки: код nodemailer/Node (EAUTH, ECONNECTION, ETIMEDOUT) или
 * номер ответа SMTP. Текст ответа провайдера не берём: в нём бывают адрес и детали.
 */
export function mailErrorCode(e: unknown): string {
  const err = e as { code?: unknown; responseCode?: unknown };
  const code =
    typeof err.code === 'string' && /^[A-Z0-9_]{2,32}$/.test(err.code)
      ? err.code
      : 'ERROR';
  return typeof err.responseCode === 'number'
    ? `${code}/${err.responseCode}`
    : code;
}
