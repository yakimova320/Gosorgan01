import type { INestApplicationContext } from '@nestjs/common';
import {
  AI_CONSENT_VERSION,
  createDocumentKey,
  EmailSchema,
  generateRecoverySecret,
  NewPasswordSchema,
  newRawKey,
  parseRecoverySecret,
  wrapMasterKey,
  type NewKey,
} from '@jasno/shared';
import { runWithKeys } from '../crypto/key-context.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashPassword } from '../auth/password.js';
import { AccountErasureService } from '../erasure/account-erasure.service.js';
import { ExplainService } from '../letters/explain.service.js';
import { LettersService } from '../letters/letters.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/*
 * B19: демо-кабинет для показа (25.11, защита). Только синтетические данные из fixtures/letters.
 * Три дела из писем 01, 04 и 12 (у 12 срок просрочен); даты и эталоны не меняются.
 * Повторный запуск пересоздаёт только кабинет с пометкой demo; обычный аккаунт с тем же e-mail не трогается.
 * Модель внутри seed всегда demo (без сети и расходов), .env не меняется.
 * E01 (#163): архив демо-кабинета зашифрован. Ключ архива открывается секретом DEMO_RECOVERY_SECRET
 * (api/.env, в git не попадает): его вводят в браузере при первом входе на устройстве.
 */

export const DEMO_LETTERS = [
  '01_jobcenter_request',
  '04_buergeramt',
  '12_past_deadline',
] as const;

export const DEMO_PROFILE = {
  firstName: 'Alex',
  lastName: 'Beispiel',
  address: 'Beispielallee 12, 00000 Beispielhausen',
};

export const DEFAULT_DEMO_EMAIL = 'demo@example.org';

/** Переопределения окружения для приложения внутри seed: модель demo, без лимита операций. */
export const SEED_ENV_OVERRIDES: NodeJS.ProcessEnv = {
  LLM_MODE: 'demo',
  LLM_DAILY_OPS_PER_CABINET: '0',
};

export class SeedError extends Error {}

export interface SeedInput {
  nodeEnv: string | undefined;
  email: string | undefined;
  password: string | undefined;
  recoverySecret: string | undefined;
  fixturesDir: string;
}

export interface PreparedSeed {
  email: string;
  password: string;
  /** E01: 32 байта секрета восстановления (из DEMO_RECOVERY_SECRET) */
  recoverySecret: Uint8Array;
  files: { id: string; data: Buffer }[];
}

/** Проверки до любых изменений в базе: окружение, пароль, e-mail, файлы писем. */
export async function prepareSeed(input: SeedInput): Promise<PreparedSeed> {
  if (input.nodeEnv === 'production')
    throw new SeedError('Seed демо-кабинета в production запрещён.');
  if (!input.password)
    throw new SeedError(
      'Нет DEMO_PASSWORD. Впишите пароль демо-кабинета в api/.env (в git он не попадает) и запустите снова.',
    );
  const pw = NewPasswordSchema.safeParse(input.password);
  if (!pw.success)
    throw new SeedError(`DEMO_PASSWORD не подходит: ${pw.error.issues[0]?.message}`);
  if (!input.recoverySecret)
    throw new SeedError(
      'Нет DEMO_RECOVERY_SECRET. Впишите секрет восстановления демо-кабинета в api/.env, например новый: ' +
        `${await generateRecoverySecret()} — его вводят в браузере при первом входе.`,
    );
  const recoverySecret = await parseRecoverySecret(input.recoverySecret);
  if (!recoverySecret)
    throw new SeedError('DEMO_RECOVERY_SECRET не подходит: проверьте опечатки (55 знаков группами по 4).');
  const email = EmailSchema.safeParse(input.email ?? DEFAULT_DEMO_EMAIL);
  if (!email.success) throw new SeedError('DEMO_EMAIL: неверный e-mail.');
  const files = DEMO_LETTERS.map((id) => {
    const path = resolve(input.fixturesDir, `${id}.pdf`);
    if (!existsSync(path)) throw new SeedError(`Нет файла письма ${id}.pdf в fixtures/letters.`);
    return { id, data: readFileSync(path) };
  });
  return { email: email.data, password: input.password, recoverySecret, files };
}

export interface SeedResult {
  cabinetId: string;
  email: string;
  replaced: boolean;
  cases: number;
  overdueDeadlines: number;
}

/** Создаёт (или пересоздаёт) демо-кабинет через сервисы приложения. */
export async function seedDemo(
  app: INestApplicationContext,
  prepared: PreparedSeed,
  options: { waitMs?: number; today?: string } = {},
): Promise<SeedResult> {
  const db = app.get(PrismaService);
  const erasure = app.get(AccountErasureService);
  const letters = app.get(LettersService);
  const explain = app.get(ExplainService);

  const existing = await db.cabinet.findUnique({
    where: { email: prepared.email },
    select: { id: true, demo: true },
  });
  if (existing && !existing.demo)
    throw new SeedError(
      `Аккаунт ${prepared.email} — обычный, не демо. Seed его не трогает: укажите другой DEMO_EMAIL.`,
    );
  if (existing) await eraseCompletely(erasure, db, existing.id, options.waitMs ?? 30_000);

  const cabinet = await db.cabinet.create({
    data: {
      email: prepared.email,
      passwordHash: await hashPassword(prepared.password),
      consentAt: new Date(),
      // K11: демо-кабинет показывает основной путь, согласие на анализ ИИ дано
      aiConsentAt: new Date(),
      aiConsentVersion: AI_CONSENT_VERSION,
      firstName: DEMO_PROFILE.firstName,
      lastName: DEMO_PROFILE.lastName,
      profile: DEMO_PROFILE,
      demo: true,
    },
  });

  // E01: мастер-ключ создаётся здесь так же, как в браузере, и хранится только под секретом
  const master = newRawKey();
  await db.keyVault.create({
    data: {
      cabinetId: cabinet.id,
      wrappedMaster: await wrapMasterKey(master, prepared.recoverySecret, cabinet.id),
    },
  });
  const withKey = <T>(key: NewKey, fn: () => Promise<T>, fresh: NewKey | null = null) =>
    runWithKeys([key], fn, fresh);

  for (const file of prepared.files) {
    const letterKey = await createDocumentKey(master, cabinet.id);
    const up = await runWithKeys([], () => letters.upload(cabinet.id, [file.data]), letterKey);
    const ids = up.claims.filter((c) => c.status === 'UNCONFIRMED').map((c) => c.id);
    if (ids.length)
      await withKey(letterKey, () =>
        letters.confirm(cabinet.id, up.letter.id, { confirm: ids, reject: [] }),
      );
    const caseKey = await createDocumentKey(master, cabinet.id);
    await withKey(
      letterKey,
      () => letters.assign(cabinet.id, up.letter.id, { newCase: {} }),
      caseKey,
    );
    await withKey(letterKey, () => explain.explain(cabinet.id, up.letter.id, 'ru'));
  }

  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const deadlines = await db.deadline.findMany({
    where: { letter: { cabinetId: cabinet.id } },
    select: { date: true },
  });
  return {
    cabinetId: cabinet.id,
    email: prepared.email,
    replaced: !!existing,
    cases: await db.case.count({ where: { cabinetId: cabinet.id } }),
    overdueDeadlines: deadlines.filter((d) => isoDate(d.date) < today).length,
  };
}

/** Удаление прежнего демо-кабинета механизмом A01; 202 (PENDING) — ждём полной очистки. */
async function eraseCompletely(
  erasure: AccountErasureService,
  db: PrismaService,
  cabinetId: string,
  waitMs: number,
): Promise<void> {
  const outcome = await erasure.erase(cabinetId);
  if (outcome !== 'DONE' && outcome !== 'PENDING')
    throw new SeedError(`Прежний демо-кабинет не удалён (${outcome}). Запустите seed позже.`);
  const until = Date.now() + waitMs;
  for (;;) {
    const job = await db.accountErasure.count({ where: { cabinetId } });
    const left = await db.cabinet.count({ where: { id: cabinetId } });
    if (job === 0 && left === 0) return;
    if (Date.now() > until)
      throw new SeedError(
        'Очистка прежнего демо-кабинета ещё не закончилась. Новый не создан; запустите seed позже.',
      );
    await erasure.recoverAll();
    await new Promise((done) => setTimeout(done, 500));
  }
}

function isoDate(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}
