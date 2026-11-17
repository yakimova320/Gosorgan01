import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ChangePasswordSchema,
  DeleteAccountSchema,
  LoginSchema,
  RegisterSchema,
  toValidationDetails,
  issueCode,
  utf8Bytes,
} from './index.js';

const ru = (n: number) => 'ж'.repeat(n);

describe('пароль', () => {
  it('новый: 9 знаков нельзя, 10 можно', () => {
    expect(
      RegisterSchema.safeParse({
        email: 'a@b.de',
        password: 'x'.repeat(9),
        consent: true,
      }).success,
    ).toBe(false);
    expect(
      RegisterSchema.safeParse({
        email: 'a@b.de',
        password: 'x'.repeat(10),
        consent: true,
      }).success,
    ).toBe(true);
  });

  it('новый: 36 русских букв (72 байта) можно, 37 нельзя, код PASSWORD_TOO_LONG', () => {
    expect(utf8Bytes(ru(36))).toBe(72);
    expect(
      RegisterSchema.safeParse({
        email: 'a@b.de',
        password: ru(36),
        consent: true,
      }).success,
    ).toBe(true);
    const r = RegisterSchema.safeParse({
      email: 'a@b.de',
      password: ru(37),
      consent: true,
    });
    expect(r.success).toBe(false);
    expect(issueCode(r.error!.issues[0])).toBe('PASSWORD_TOO_LONG');
  });

  it('пароль не меняется: пробелы по краям остаются', () => {
    const r = RegisterSchema.parse({
      email: 'a@b.de',
      password: '  passwort-1  ',
      consent: true,
    });
    expect(r.password).toBe('  passwort-1  ');
  });

  it('текущий пароль не проверяется по правилам нового', () => {
    expect(
      LoginSchema.safeParse({ email: 'a@b.de', password: 'kurz' }).success,
    ).toBe(true);
    expect(
      LoginSchema.safeParse({ email: 'a@b.de', password: ru(40) }).success,
    ).toBe(true);
    expect(DeleteAccountSchema.safeParse({ password: 'kurz' }).success).toBe(
      true,
    );
    expect(
      ChangePasswordSchema.safeParse({
        oldPassword: 'kurz',
        newPassword: 'kurz',
      }).success,
    ).toBe(false);
    expect(
      LoginSchema.safeParse({ email: 'a@b.de', password: '' }).success,
    ).toBe(false);
  });
});

describe('регистрация', () => {
  it('без согласия нельзя', () => {
    expect(
      RegisterSchema.safeParse({
        email: 'a@b.de',
        password: 'x'.repeat(10),
        consent: false,
      }).success,
    ).toBe(false);
  });

  it('e-mail: trim и нижний регистр, неверный отклоняется', () => {
    expect(
      LoginSchema.parse({ email: '  Anna@Example.ORG ', password: 'x' }).email,
    ).toBe('anna@example.org');
    expect(
      LoginSchema.safeParse({ email: 'anna@', password: 'x' }).success,
    ).toBe(false);
  });
});

describe('формат ошибок', () => {
  it('вложенные пути через точку, ошибки без пути в form', () => {
    expect(
      toValidationDetails([
        { path: ['profile', 'numbers', 0, 'value'], message: 'Пусто' },
        { path: ['profile', 'numbers', 0, 'value'], message: 'Второе' },
        { path: [], message: 'Общая' },
      ]),
    ).toEqual({
      fields: { 'profile.numbers.0.value': 'Пусто' },
      form: ['Общая'],
    });
  });
});

describe('пакет работает в браузере', () => {
  it('исходники импортируют только zod и свои файлы, без Node API', () => {
    const dir = import.meta.dirname;
    for (const file of readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    )) {
      const src = readFileSync(resolve(dir, file), 'utf8');
      const specifiers = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const s of specifiers)
        expect(s === 'zod' || s.startsWith('./'), `${file}: ${s}`).toBe(true);
      expect(src).not.toMatch(/\b(Buffer|process|require)\b/);
    }
  });
});
