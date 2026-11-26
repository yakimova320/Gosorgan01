import { AsyncLocalStorage } from 'node:async_hooks';
import {
  KEYS_HEADER,
  NEW_KEY_HEADER,
  parseKeysHeader,
  parseNewKeyHeader,
  type NewKey,
} from '@jasno/shared';
import type { NextFunction, Request, Response } from 'express';

/**
 * E01 (#163): ключи документов одного запроса. Живут только в памяти, пока идёт запрос.
 * Браузер присылает их по действию человека (загрузка, объяснение, черновик…), заголовком x-jasno-keys;
 * новый ключ документа — заголовком x-jasno-new-key. Заголовки удаляются из запроса сразу после
 * разбора: ни журнал, ни другой код их не видит.
 */
export interface KeyContext {
  keys: Map<string, Uint8Array>;
  newKey: NewKey | null;
  newKeyUsed: boolean;
}

const store = new AsyncLocalStorage<KeyContext>();

export function keyContext(): KeyContext | undefined {
  return store.getStore();
}

/** Ключи вне HTTP-запроса: seed, скрипты, тесты. */
export function runWithKeys<T>(
  keys: { keyId: string; raw: Uint8Array }[],
  fn: () => Promise<T>,
  newKey: NewKey | null = null,
): Promise<T> {
  return store.run(
    { keys: new Map(keys.map((k) => [k.keyId, k.raw])), newKey, newKeyUsed: false },
    fn,
  );
}

function header(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  delete req.headers[name];
  return Array.isArray(v) ? v.join(',') : v;
}

export function keyContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const keys = header(req, KEYS_HEADER);
  const fresh = header(req, NEW_KEY_HEADER);
  store.run(
    {
      keys: (keys && parseKeysHeader(keys)) || new Map(),
      newKey: fresh ? parseNewKeyHeader(fresh) : null,
      newKeyUsed: false,
    },
    next,
  );
}
