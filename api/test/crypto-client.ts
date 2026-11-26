import {
  createDocumentKey,
  formatKeysHeader,
  formatNewKeyHeader,
  generateRecoverySecret,
  KEYS_HEADER,
  NEW_KEY_HEADER,
  newRawKey,
  parseRecoverySecret,
  unwrapDocumentKey,
  wrapMasterKey,
} from '@jasno/shared';
import type { Test } from 'supertest';

/**
 * E01 (#163): то же, что делает браузер, для e2e API. Мастер-ключ живёт только в этом объекте,
 * на сервер уходят запись под секретом (POST /crypto/vault) и ключи документов в заголовках.
 */
export class CryptoClient {
  readonly master = newRawKey();
  secret = '';

  constructor(readonly cabinetId: string) {}

  /** Создать ключ архива кабинета. */
  async createVault(post: (body: object) => Promise<unknown>): Promise<void> {
    this.secret = await generateRecoverySecret();
    const bytes = (await parseRecoverySecret(this.secret))!;
    await post({ wrappedMaster: await wrapMasterKey(this.master, bytes, this.cabinetId) });
  }

  /** Новый ключ документа в заголовке x-jasno-new-key. Возвращает его keyId. */
  async withNewKey(req: Test): Promise<{ req: Test; keyId: string }> {
    const k = await createDocumentKey(this.master, this.cabinetId);
    return { req: req.set(NEW_KEY_HEADER, formatNewKeyHeader(k)), keyId: k.keyId };
  }

  /** Ключи документов (по записям из GET /crypto/keys) в заголовке x-jasno-keys. */
  async withKeys(
    req: Test,
    keys: { keyId: string; wrapped: string }[],
    ids: string[],
  ): Promise<{ req: Test }> {
    const raw = [];
    for (const id of ids) {
      const w = keys.find((k) => k.keyId === id);
      if (!w) throw new Error(`нет ключа ${id}`);
      raw.push({ keyId: id, raw: await unwrapDocumentKey(this.master, w.wrapped, this.cabinetId, id) });
    }
    // в объекте: Test — thenable, из async-функции его нельзя вернуть напрямую (запрос выполнился бы)
    return { req: req.set(KEYS_HEADER, formatKeysHeader(raw)) };
  }
}
