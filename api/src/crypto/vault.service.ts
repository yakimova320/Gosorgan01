import { Inject, Injectable } from '@nestjs/common';
import {
  collectKeyIds,
  CryptoIntegrityError,
  decryptBytes,
  decryptDeep,
  encryptBytes,
  encryptJson,
  encryptText,
  importKey,
  isEncryptedBytes,
  bytesKeyId,
} from '@jasno/shared';
import { ApiError } from '../common/api-error.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { keyContext } from './key-context.js';

type Db = Pick<PrismaService, 'keyVault' | 'documentKey'> | Prisma.TransactionClient;

/** Новый ключ документа из запроса: сохраняется в DocumentKey в той же транзакции, что и документ. */
export interface FreshKey {
  keyId: string;
  wrapped: string;
}

/**
 * E01 (#163): шифрование полей и файлов ключами из запроса.
 * keyId null — документ загружен до шифрования (открытый текст): seal возвращает значение как есть.
 * open расшифровывает все шифротексты в объекте; нет ключа — 428 KEYS_REQUIRED { keyIds },
 * подмена — 422 INTEGRITY_FAILED. Ключи нигде не сохраняются и не пишутся в журнал.
 */
@Injectable()
export class VaultService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(APP_CONFIG) private readonly config: Pick<Env, 'ENCRYPTION_REQUIRED' | 'NODE_ENV'>,
  ) {}

  /** Письма без шифрования запрещены (по умолчанию всегда, кроме NODE_ENV=test). */
  get required(): boolean {
    return this.config.ENCRYPTION_REQUIRED ?? this.config.NODE_ENV !== 'test';
  }

  async hasVault(cabinetId: string, db: Db = this.db): Promise<boolean> {
    return (await db.keyVault.count({ where: { cabinetId } })) > 0;
  }

  /**
   * Ключ нового документа (письмо, дело). Кабинет без ключа архива: null (документ открытый),
   * если шифрование не обязательно, иначе 409 ENCRYPTION_SETUP_REQUIRED.
   * Ключ не прислан: 428 KEYS_REQUIRED { newKey: true }. Один новый ключ на запрос.
   */
  async takeNewKey(cabinetId: string, db: Db = this.db): Promise<FreshKey | null> {
    if (!(await this.hasVault(cabinetId, db))) {
      if (this.required) throw new ApiError('ENCRYPTION_SETUP_REQUIRED');
      return null;
    }
    const ctx = keyContext();
    if (!ctx?.newKey || ctx.newKeyUsed) throw new ApiError('KEYS_REQUIRED', { keyIds: [], newKey: true });
    ctx.newKeyUsed = true;
    ctx.keys.set(ctx.newKey.keyId, ctx.newKey.raw);
    return { keyId: ctx.newKey.keyId, wrapped: ctx.newKey.wrapped };
  }

  /** Сохранить новый ключ (строка DocumentKey). Повтор keyId: 400. */
  async saveKey(db: Db, cabinetId: string, key: FreshKey | null): Promise<void> {
    if (!key) return;
    const taken = await db.documentKey.count({ where: { id: key.keyId } });
    if (taken) throw new ApiError('VALIDATION_FAILED', { fields: { key: 'Ключ уже использован' } });
    await db.documentKey.create({ data: { id: key.keyId, cabinetId, wrapped: key.wrapped } });
  }

  private async key(keyId: string): Promise<CryptoKey> {
    const raw = keyContext()?.keys.get(keyId);
    if (!raw) throw new ApiError('KEYS_REQUIRED', { keyIds: [keyId] });
    return importKey(raw);
  }

  async seal(cabinetId: string, keyId: string | null, text: string): Promise<string> {
    if (!keyId) return text;
    return encryptText(await this.key(keyId), { cabinetId, keyId }, text);
  }

  async sealOrNull(cabinetId: string, keyId: string | null, text: string | null | undefined): Promise<string | null> {
    return text === null || text === undefined ? null : this.seal(cabinetId, keyId, text);
  }

  /** Значение столбца Json: шифротекст — строка JSON. */
  async sealJson<T extends object>(cabinetId: string, keyId: string | null, value: T): Promise<T | string> {
    if (!keyId) return value;
    return encryptJson(await this.key(keyId), { cabinetId, keyId }, value);
  }

  async sealBytes(cabinetId: string, keyId: string | null, data: Buffer): Promise<Buffer> {
    if (!keyId) return data;
    return Buffer.from(await encryptBytes(await this.key(keyId), { cabinetId, keyId }, data));
  }

  /** Все ключи для объекта есть в запросе? */
  canOpen(value: unknown): boolean {
    const keys = keyContext()?.keys;
    return [...collectKeyIds(value)].every((id) => keys?.has(id));
  }

  /** Расшифровать все шифротексты в объекте. Не хватает ключей: 428 KEYS_REQUIRED со всеми keyId сразу. */
  async open<T>(cabinetId: string, value: T): Promise<T> {
    const keys = keyContext()?.keys ?? new Map<string, Uint8Array>();
    const missing = [...collectKeyIds(value)].filter((id) => !keys.has(id));
    if (missing.length) throw new ApiError('KEYS_REQUIRED', { keyIds: missing });
    const imported = new Map<string, CryptoKey>();
    for (const [id, raw] of keys) imported.set(id, await importKey(raw));
    try {
      return await decryptDeep(value, cabinetId, (id) => imported.get(id) ?? null);
    } catch (e) {
      if (e instanceof CryptoIntegrityError) throw new ApiError('INTEGRITY_FAILED');
      throw e;
    }
  }

  /** Файл из хранилища: JXB1 — расшифровать, иначе (до шифрования) как есть. */
  async openBytes(cabinetId: string, data: Buffer): Promise<Buffer> {
    if (!isEncryptedBytes(data)) return data;
    const keyId = bytesKeyId(data);
    if (!keyId) throw new ApiError('INTEGRITY_FAILED');
    try {
      return Buffer.from(await decryptBytes(await this.key(keyId), cabinetId, data));
    } catch (e) {
      if (e instanceof CryptoIntegrityError) throw new ApiError('INTEGRITY_FAILED');
      throw e;
    }
  }
}
