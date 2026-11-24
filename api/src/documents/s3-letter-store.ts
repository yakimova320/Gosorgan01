import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Env } from '../config/env.schema.js';

/*
 * ST01: оригиналы писем в S3-совместимом хранилище (Supabase Storage).
 * Бакет закрытый, ключи только на сервере. Ссылок на бакет наружу нет:
 * оригинал отдаёт только API с проверкой владельца (B11).
 * Ключи объектов те же, что у папки: letters/<cabinetId>/<32 hex>.<ext>, корзина A01: trash/<jobId>/letters/...
 */

export type S3Config = Pick<
  Env,
  | 'S3_ENDPOINT'
  | 'S3_REGION'
  | 'S3_BUCKET'
  | 'S3_ACCESS_KEY_ID'
  | 'S3_SECRET_ACCESS_KEY'
>;

/** Минимум клиента, который нужен хранилищу. В тестах подменяется. */
export interface S3Like {
  send(command: object): Promise<unknown>;
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
};

/** Ключ объекта: только буквы, цифры, _ - . и /, без пустых частей и «..». */
const SAFE_KEY = /^(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9_-]+(?:\.[a-z0-9]+)?$/;

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key)) throw new Error('bad key');
}

function isNotFound(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    err?.name === 'NoSuchKey' ||
    err?.name === 'NotFound' ||
    err?.$metadata?.httpStatusCode === 404
  );
}

export function createS3Client(config: S3Config): S3Client {
  return new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: true, // Supabase: бакет в пути, не в имени хоста
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: config.S3_SECRET_ACCESS_KEY ?? '',
    },
    // Новые версии SDK по умолчанию добавляют контрольные суммы CRC32,
    // которые S3-совместимые сервисы принимают не всегда. Только когда без них нельзя.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 3,
  });
}

export class S3LetterStore {
  constructor(
    readonly bucket: string,
    readonly client: S3Like,
  ) {}

  static fromConfig(config: S3Config): S3LetterStore {
    return new S3LetterStore(config.S3_BUCKET ?? '', createS3Client(config));
  }

  async put(key: string, data: Buffer): Promise<void> {
    assertSafeKey(key);
    const ext = key.slice(key.lastIndexOf('.') + 1);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: MIME[ext] ?? 'application/octet-stream',
        ContentLength: data.length,
      }),
    );
  }

  /** Нет объекта: null. Другая ошибка (сеть, ключи) пробрасывается. */
  async get(key: string): Promise<Buffer | null> {
    assertSafeKey(key);
    try {
      const out = (await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      )) as { Body?: { transformToByteArray(): Promise<Uint8Array> } };
      if (!out.Body) return null;
      return Buffer.from(await out.Body.transformToByteArray());
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (e) {
      if (isNotFound(e)) return false;
      throw e;
    }
  }

  /** Отсутствующий объект не ошибка. */
  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }

  /** Все ключи под префиксом (префикс оканчивается на /). */
  async list(prefix: string): Promise<string[]> {
    assertPrefix(prefix);
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const out = (await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      )) as {
        Contents?: { Key?: string }[];
        IsTruncated?: boolean;
        NextContinuationToken?: string;
      };
      for (const o of out.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  async deletePrefix(prefix: string): Promise<void> {
    for (const key of await this.list(prefix)) await this.delete(key);
  }

  /**
   * Перенос всех объектов из src/ в dst/: копия, потом удаление оригинала.
   * Повторяемый: после сбоя повторный вызов доносит оставшееся (уже перенесённые объекты в src не видны).
   */
  async movePrefix(src: string, dst: string): Promise<void> {
    assertPrefix(dst);
    for (const key of await this.list(src)) {
      const target = dst + key.slice(src.length);
      assertSafeKey(target);
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${key}`,
          Key: target,
        }),
      );
      await this.delete(key);
    }
  }
}

function assertPrefix(prefix: string): void {
  if (!/^(?:[A-Za-z0-9_-]+\/)+$/.test(prefix)) throw new Error('bad prefix');
}
