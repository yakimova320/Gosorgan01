import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { parseEnv } from '../config/env.schema.js';
import { S3LetterStore, type S3Like } from './s3-letter-store.js';
import { StorageService } from './storage.service.js';

/** Бакет в памяти: понимает только команды, которые использует хранилище. */
class FakeS3 implements S3Like {
  readonly objects = new Map<string, Buffer>();
  readonly calls: string[] = [];
  failOn: string | null = null;

  async send(cmd: object): Promise<unknown> {
    const input = (cmd as { input: Record<string, unknown> }).input;
    const name = cmd.constructor.name;
    this.calls.push(name);
    if (this.failOn === name) {
      this.failOn = null;
      throw Object.assign(new Error('boom'), { name: 'NetworkError' });
    }
    const key = input.Key as string;
    const notFound = () =>
      Object.assign(new Error('nf'), {
        name: 'NoSuchKey',
        $metadata: { httpStatusCode: 404 },
      });
    if (cmd instanceof PutObjectCommand) {
      this.objects.set(key, Buffer.from(input.Body as Buffer));
      return {};
    }
    if (cmd instanceof GetObjectCommand) {
      const data = this.objects.get(key);
      if (!data) throw notFound();
      return {
        Body: { transformToByteArray: async () => new Uint8Array(data) },
      };
    }
    if (cmd instanceof HeadObjectCommand) {
      if (!this.objects.has(key)) throw notFound();
      return {};
    }
    if (cmd instanceof DeleteObjectCommand) {
      this.objects.delete(key);
      return {};
    }
    if (cmd instanceof CopyObjectCommand) {
      const src = (input.CopySource as string).replace(/^[^/]+\//, '');
      const data = this.objects.get(src);
      if (!data) throw notFound();
      this.objects.set(key, data);
      return {};
    }
    if (cmd instanceof ListObjectsV2Command) {
      const prefix = input.Prefix as string;
      const all = [...this.objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .sort();
      // страницы по 2 ключа, чтобы проверить продолжение списка
      const start = input.ContinuationToken
        ? Number(input.ContinuationToken)
        : 0;
      const page = all.slice(start, start + 2);
      const more = start + 2 < all.length;
      return {
        Contents: page.map((Key) => ({ Key })),
        IsTruncated: more,
        NextContinuationToken: more ? String(start + 2) : undefined,
      };
    }
    throw new Error(`unexpected ${name}`);
  }
}

const s3Env = {
  STORAGE_DIR: '/tmp/jasno-st01-unused',
  STORAGE_MODE: 's3' as const,
  S3_ENDPOINT: 'https://example.storage.supabase.co/storage/v1/s3',
  S3_REGION: 'eu-west-1',
  S3_BUCKET: 'letters',
  S3_ACCESS_KEY_ID: 'test-id',
  S3_SECRET_ACCESS_KEY: 'test-secret',
};

function s3Storage() {
  const fake = new FakeS3();
  const storage = new StorageService(s3Env);
  (storage as { remote: S3LetterStore }).remote = new S3LetterStore(
    'letters',
    fake,
  );
  return { storage, fake };
}

describe('ST01: оригиналы писем в бакете', () => {
  it('local по умолчанию: бакета нет', () => {
    expect(new StorageService({ STORAGE_DIR: './storage' }).remote).toBeNull();
    expect(new StorageService(s3Env).remote?.bucket).toBe('letters');
  });

  it('запись, чтение, удаление; нет объекта: null', async () => {
    const { storage, fake } = s3Storage();
    const key = storage.newKey('cab1', 'pdf');
    await storage.write(key, Buffer.from('%PDF-1'));
    expect(fake.objects.has(key)).toBe(true);
    expect((await storage.read(key))?.toString()).toBe('%PDF-1');
    await storage.remove(key);
    expect(await storage.read(key)).toBeNull();
    await storage.remove(key); // повторное удаление не ошибка
  });

  it('сбой записи: ошибка наружу, объекта нет', async () => {
    const { storage, fake } = s3Storage();
    const key = storage.newKey('cab1', 'jpg');
    fake.failOn = 'PutObjectCommand';
    await expect(storage.write(key, Buffer.from('x'))).rejects.toThrow('boom');
    expect(fake.objects.size).toBe(0);
  });

  it('сетевая ошибка чтения не превращается в «файла нет»', async () => {
    const { storage, fake } = s3Storage();
    fake.failOn = 'GetObjectCommand';
    await expect(storage.read(storage.newKey('cab1', 'pdf'))).rejects.toThrow(
      'boom',
    );
  });

  it('плохой ключ не уходит в бакет', async () => {
    const { storage, fake } = s3Storage();
    await expect(storage.read('../secret')).rejects.toThrow('bad key');
    await expect(storage.read('letters/../x.pdf')).rejects.toThrow('bad key');
    expect(fake.calls).toEqual([]);
  });

  it('A01: корзина, откат и окончательная очистка', async () => {
    const { storage, fake } = s3Storage();
    const keys = [1, 2, 3].map(() => storage.newKey('cabA', 'png'));
    const other = storage.newKey('cabB', 'pdf');
    for (const k of [...keys, other]) await storage.write(k, Buffer.from(k));

    await storage.moveCabinetToTrash('cabA', 'job1');
    expect(
      [...fake.objects.keys()].filter((k) => k.startsWith('letters/cabA/')),
    ).toEqual([]);
    expect(
      [...fake.objects.keys()].filter((k) =>
        k.startsWith('trash/job1/letters/'),
      ),
    ).toHaveLength(3);

    await storage.restoreCabinetFromTrash('cabA', 'job1');
    for (const k of keys) expect(fake.objects.get(k)?.toString()).toBe(k);
    expect([...fake.objects.keys()].some((k) => k.startsWith('trash/'))).toBe(
      false,
    );

    await storage.moveCabinetToTrash('cabA', 'job2');
    await storage.purgeErasure('cabA', 'job2');
    expect([...fake.objects.keys()]).toEqual([other]); // чужой кабинет не тронут
  });

  it('A01: перенос в корзину после сбоя доделывается повторным вызовом', async () => {
    const { storage, fake } = s3Storage();
    for (let i = 0; i < 3; i++)
      await storage.write(storage.newKey('cabA', 'pdf'), Buffer.from('x'));
    fake.failOn = 'CopyObjectCommand';
    await expect(storage.moveCabinetToTrash('cabA', 'job1')).rejects.toThrow(
      'boom',
    );
    await storage.moveCabinetToTrash('cabA', 'job1');
    expect(
      [...fake.objects.keys()].every((k) =>
        k.startsWith('trash/job1/letters/'),
      ),
    ).toBe(true);
    expect(fake.objects.size).toBe(3);
  });

  it('удаление дела/кабинета по префиксу', async () => {
    const { storage, fake } = s3Storage();
    await storage.write(storage.newKey('cabA', 'pdf'), Buffer.from('x'));
    await storage.write(storage.newKey('cabAB', 'pdf'), Buffer.from('y'));
    await storage.removeCabinet('cabA');
    expect([...fake.objects.keys()].map((k) => k.split('/')[1])).toEqual([
      'cabAB',
    ]);
  });

  it('время транзакции загрузки больше для бакета', () => {
    expect(s3Storage().storage.uploadTxTimeoutMs).toBeGreaterThan(
      new StorageService({ STORAGE_DIR: './storage' }).uploadTxTimeoutMs,
    );
  });
});

describe('ST01: .env', () => {
  it('STORAGE_MODE=s3 без ключей: сервер не стартует', () => {
    expect(() => parseEnv({ STORAGE_MODE: 's3' })).toThrow(
      /S3_BUCKET: нужно при STORAGE_MODE=s3/,
    );
    expect(() => parseEnv({ ...s3Env, S3_SECRET_ACCESS_KEY: '' })).toThrow(
      /S3_SECRET_ACCESS_KEY/,
    );
    expect(parseEnv({ ...s3Env }).STORAGE_MODE).toBe('s3');
    expect(parseEnv({}).STORAGE_MODE).toBe('local');
  });

  it('имя бакета без / и пробелов', () => {
    expect(() => parseEnv({ ...s3Env, S3_BUCKET: 'letters/x' })).toThrow(
      /S3_BUCKET/,
    );
  });
});
