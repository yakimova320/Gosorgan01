import { ApiError } from '../common/api-error.js';
import { berlinToday } from '../common/berlin-date.js';
import { LoginSchema, RegisterSchema } from './auth.schemas.js';
import { LOGIN_WINDOW_MS, LoginLimiter } from './login-limiter.js';
import {
  assertPasswordFits,
  hashPassword,
  verifyPassword,
} from './password.js';
import { hashToken, maskEmail, newToken } from './session-token.js';

describe('Пароль', () => {
  it('хэш не равен паролю и проверяется', async () => {
    const hash = await hashPassword('mein-langes-Passwort');
    expect(hash).not.toContain('mein-langes-Passwort');
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await verifyPassword('mein-langes-Passwort', hash)).toBe(true);
    expect(await verifyPassword('falsches-Passwort', hash)).toBe(false);
  }, 20_000); // bcrypt cost 12 три раза: под нагрузкой дольше 5 с

  it('72 байта можно, 73 байта: PASSWORD_TOO_LONG', () => {
    expect(() => assertPasswordFits('a'.repeat(72))).not.toThrow();
    expect(() => assertPasswordFits('a'.repeat(73))).toThrow(ApiError);
    // Кириллица: 2 байта на букву, 37 букв = 74 байта.
    expect(() => assertPasswordFits('я'.repeat(37))).toThrow(ApiError);
  });
});

describe('Токен сессии', () => {
  it('32 байта base64url, в базу идёт sha256', () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(token)).not.toBe(token);
    expect(newToken()).not.toBe(token);
  });

  it('e-mail в логах замаскирован', () => {
    expect(maskEmail('anna@example.org')).toBe('a***@example.org');
    expect(maskEmail('bad')).toBe('***');
  });
});

describe('Проверка ввода', () => {
  it('e-mail приводится к маленьким буквам', () => {
    const r = RegisterSchema.parse({
      email: '  Anna@Example.ORG ',
      password: '1234567890',
      consent: true,
    });
    expect(r.email).toBe('anna@example.org');
  });

  it('пароль короче 10 знаков и неверный e-mail отклоняются', () => {
    expect(
      RegisterSchema.safeParse({
        email: 'a@b.de',
        password: '123',
        consent: true,
      }).success,
    ).toBe(false);
    expect(
      RegisterSchema.safeParse({
        email: 'nope',
        password: '1234567890',
        consent: true,
      }).success,
    ).toBe(false);
    expect(
      LoginSchema.safeParse({ email: 'a@b.de', password: '' }).success,
    ).toBe(false);
  });
});

describe('Лимит входа', () => {
  it('после 4 неудач блокирует e-mail на 15 минут, другие адреса не трогает', () => {
    const limiter = new LoginLimiter();
    let now = 1_000_000;
    limiter.now = () => now;
    for (let i = 0; i < 4; i++) {
      expect(limiter.isBlocked('a@b.de')).toBe(false);
      limiter.recordFailure('a@b.de');
    }
    expect(limiter.isBlocked('a@b.de')).toBe(true);
    expect(limiter.isBlocked('c@d.de')).toBe(false);
    now += LOGIN_WINDOW_MS + 1;
    expect(limiter.isBlocked('a@b.de')).toBe(false);
  });

  it('удачный вход сбрасывает счётчик', () => {
    const limiter = new LoginLimiter();
    limiter.recordFailure('a@b.de');
    limiter.recordFailure('a@b.de');
    limiter.reset('a@b.de');
    limiter.recordFailure('a@b.de');
    expect(limiter.isBlocked('a@b.de')).toBe(false);
  });
});

describe('Сегодня по Берлину', () => {
  it('23:30 UTC 31 декабря в Берлине уже 1 января', () => {
    expect(berlinToday(new Date('2026-12-31T23:30:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
    expect(berlinToday(new Date('2026-12-01T10:00:00Z')).toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
  });
});
