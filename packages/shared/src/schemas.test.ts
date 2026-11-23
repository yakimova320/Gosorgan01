import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ChangePasswordSchema,
  composeAddress,
  splitAddress,
  FirstNameSchema,
  LastNameSchema,
  ProfilePatchSchema,
  ProfileSchema,
  DeleteAccountSchema,
  LoginSchema,
  RegisterSchema,
  toValidationDetails,
  issueCode,
  utf8Bytes,
} from './index.js';

const ru = (n: number) => 'ж'.repeat(n);
const person = {
  firstName: 'Anna',
  lastName: 'Muster',
  address: 'Musterstr. 1, 10115 Berlin',
};

describe('пароль', () => {
  it('новый: 9 знаков нельзя, 10 можно', () => {
    expect(
      RegisterSchema.safeParse({
        ...person,
        email: 'a@b.de',
        password: 'x'.repeat(9),
        consent: true,
      }).success,
    ).toBe(false);
    expect(
      RegisterSchema.safeParse({
        ...person,
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
        ...person,
        email: 'a@b.de',
        password: ru(36),
        consent: true,
      }).success,
    ).toBe(true);
    const r = RegisterSchema.safeParse({
      ...person,
      email: 'a@b.de',
      password: ru(37),
      consent: true,
    });
    expect(r.success).toBe(false);
    expect(issueCode(r.error!.issues[0])).toBe('PASSWORD_TOO_LONG');
  });

  it('пароль не меняется: пробелы по краям остаются', () => {
    const r = RegisterSchema.parse({
      ...person,
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
        ...person,
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

describe('имя, фамилия, адрес', () => {
  it('латиница с умлаутами, диакритикой, пробелом, дефисом и апострофами', () => {
    for (const name of [
      'Anna',
      'Jürgen',
      'Zoë',
      'Łukasz',
      'Anna-Lena',
      "O'Neill",
      'D’Angelo',
      'van der Berg',
      'Müller-Lüdenscheidt',
      'Straße',
    ]) {
      expect(FirstNameSchema.safeParse(name).success, name).toBe(true);
    }
    expect(FirstNameSchema.parse('  Anna  ')).toBe('Anna');
    expect(FirstNameSchema.parse('Ze\u0301lie')).toBe('Zélie'); // NFC
  });

  it('кириллица, цифры, пустое значение: понятная ошибка у поля', () => {
    for (const bad of [
      'Анна',
      'Anna1',
      '',
      '   ',
      'Anna  Lena',
      '-Anna',
      'Annа' /* кириллическая а */,
    ]) {
      expect(FirstNameSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(FirstNameSchema.safeParse('Анна').error!.issues[0].message).toBe(
      'Введите имя латинскими буквами',
    );
    expect(LastNameSchema.safeParse('Иванова').error!.issues[0].message).toBe(
      'Введите фамилию латинскими буквами',
    );
  });

  it('регистрация требует имя, фамилию и адрес; адрес без ограничения алфавита', () => {
    const base = { email: 'a@b.de', password: 'x'.repeat(10), consent: true };
    expect(RegisterSchema.safeParse(base).success).toBe(false);
    expect(
      RegisterSchema.safeParse({
        ...base,
        ...person,
        address: 'ул. Ленина 1, Berlin',
      }).success,
    ).toBe(true);
  });

  it('профиль: можно прислать одно поле, но нельзя очистить обязательное', () => {
    expect(
      ProfilePatchSchema.safeParse({ address: 'Neue Str. 2, 10115 Berlin' })
        .success,
    ).toBe(true);
    expect(ProfilePatchSchema.safeParse({ firstName: '' }).success).toBe(false);
    expect(ProfileSchema.safeParse({ firstName: 'Anna' }).success).toBe(false);
  });

  it('номера профиля: немецкое название, без кириллицы и строк шаблона, не больше 10', () => {
    const msg = (numbers: unknown) => {
      const r = ProfilePatchSchema.safeParse({ numbers });
      return r.success ? null : r.error.issues[0].message;
    };
    expect(msg([{ label: ' Kundennummer ', value: '123A456' }])).toBeNull();
    expect(
      ProfilePatchSchema.parse({
        numbers: [{ label: ' BG-Nummer ', value: ' 12345BG0001234 ' }],
      }).numbers,
    ).toEqual([{ label: 'BG-Nummer', value: '12345BG0001234' }]);
    expect(msg([])).toBeNull();
    expect(msg([{ label: 'Номер клиента', value: '1' }])).toBe(
      'Название по-немецки, как в письме ведомства',
    );
    expect(msg([{ label: 'Kundennummer', value: '' }])).toBe('Введите номер');
    expect(msg([{ label: '', value: '1' }])).toBe('Введите название номера');
    expect(msg([{ label: 'Ihr Zeichen', value: '1' }])).toContain(
      'уже есть в шаблоне',
    );
    expect(
      msg(Array.from({ length: 11 }, (_, i) => ({ label: `N${i}`, value: '1' }))),
    ).toBe('Не больше 10 номеров');
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

describe('адрес по частям (поправка 6)', () => {
  it('собирает и разбирает строку', () => {
    const parts = { street: 'Musterstr. 1', postalCode: '10115', city: 'Berlin' };
    expect(composeAddress(parts)).toBe('Musterstr. 1, 10115 Berlin');
    expect(splitAddress('Musterstr. 1, 10115 Berlin')).toEqual(parts);
    expect(splitAddress('где-то в Берлине')).toBeNull();
  });
});
