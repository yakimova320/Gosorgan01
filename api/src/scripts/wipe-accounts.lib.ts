import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { StorageService } from '../documents/storage.service.js';
import { AccountErasureService } from '../erasure/account-erasure.service.js';
import { registerResetMailCleaner } from '../mail/mail.module.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/*
 * Разовая очистка аккаунтов (не запускается вместе с приложением).
 * Удаляет только выбранные кабинеты: строки по cabinetId (каскад: сессии, токены восстановления,
 * дела, письма, факты, сроки, события, сообщения, черновики), LlmCall этих кабинетов и их писем, файлы писем.
 * Механизм тот же, что у DELETE /cabinet (A01): файлы сначала в корзину, потом база, потом
 * окончательная очистка. Сбой до удаления базы: файлы возвращаются, кабинет остаётся.
 */

export interface WipeTarget {
  host: string;
  port: string;
  database: string;
  schema: string;
  storageDir: string;
}

/** Цель из DATABASE_URL, без логина и пароля. */
export function describeTarget(
  databaseUrl: string,
  storageDir: string,
): WipeTarget {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port || '5432',
    database: url.pathname.replace(/^\//, ''),
    schema: url.searchParams.get('schema') ?? 'public',
    storageDir,
  };
}

/** Строка, которую человек вводит в --confirm: хост, порт, база и схема. */
export function targetId(t: WipeTarget): string {
  return `${t.host}:${t.port}/${t.database}/${t.schema}`;
}

export type Selector = { all: true } | { emails: string[] };

export interface WipePlan {
  cabinets: { id: string; email: string }[];
  counts: {
    sessions: number;
    resetTokens: number;
    cases: number;
    letters: number;
    claims: number;
    drafts: number;
    llmCalls: number;
    letterDirs: number;
  };
}

export async function planWipe(
  db: PrismaService,
  storageDir: string,
  selector: Selector,
): Promise<WipePlan> {
  const cabinets = await db.cabinet.findMany({
    where:
      'all' in selector
        ? {}
        : { email: { in: selector.emails.map((e) => e.trim().toLowerCase()) } },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  });
  const ids = cabinets.map((c) => c.id);
  const letterIds = (
    await db.letter.findMany({
      where: { cabinetId: { in: ids } },
      select: { id: true },
    })
  ).map((l) => l.id);
  const [sessions, resetTokens, cases, claims, drafts, llmCalls] =
    await Promise.all([
      db.session.count({ where: { cabinetId: { in: ids } } }),
      db.passwordResetToken.count({ where: { cabinetId: { in: ids } } }),
      db.case.count({ where: { cabinetId: { in: ids } } }),
      db.claim.count({ where: { letterId: { in: letterIds } } }),
      db.draft.count({ where: { case: { cabinetId: { in: ids } } } }),
      db.llmCall.count({ where: llmCallsOf(ids, letterIds) }),
    ]);
  return {
    cabinets,
    counts: {
      sessions,
      resetTokens,
      cases,
      letters: letterIds.length,
      claims,
      drafts,
      llmCalls,
      letterDirs: ids.filter((id) => existsSync(letterDir(storageDir, id)))
        .length,
    },
  };
}

/**
 * Удаление тем же механизмом, что DELETE /cabinet (AccountErasureService):
 * блокировка, перенос файлов в корзину, база одной транзакцией, окончательная очистка.
 * failed: удаление откатилось, кабинет остался и найдётся при повторном запуске.
 * pending: база удалена, очистка файлов не закончилась — повторный запуск её доделает.
 */
export async function executeWipe(
  db: PrismaService,
  storageDir: string,
  plan: WipePlan,
  storage: StorageService = new StorageService({ STORAGE_DIR: storageDir }),
): Promise<{ deleted: string[]; pending: string[]; failed: string[] }> {
  const erasure = new AccountErasureService(db, storage);
  registerResetMailCleaner(erasure, storage);
  // сначала незаконченные задания прошлых запусков
  await erasure.recoverAll();
  const result = {
    deleted: [] as string[],
    pending: [] as string[],
    failed: [] as string[],
  };
  for (const cabinet of plan.cabinets) {
    const outcome = await erasure.erase(cabinet.id);
    if (outcome === 'DONE') result.deleted.push(cabinet.id);
    else if (outcome === 'PENDING') result.pending.push(cabinet.id);
    else result.failed.push(cabinet.id);
  }
  return result;
}

function llmCallsOf(cabinetIds: string[], letterIds: string[]) {
  return {
    OR: [{ cabinetId: { in: cabinetIds } }, { letterId: { in: letterIds } }],
  };
}

function letterDir(storageDir: string, cabinetId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(cabinetId)) throw new Error('bad cabinetId');
  return resolve(storageDir, 'letters', cabinetId);
}
