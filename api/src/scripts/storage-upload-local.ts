/**
 * ST01: pnpm --filter jasno-api storage:upload-local — разовый перенос оригиналов писем из папки
 * STORAGE_DIR/letters в бакет (STORAGE_MODE=s3 и ключи S3_* в api/.env).
 *
 *   без флагов    только показ: сколько файлов и сколько МБ
 *   --confirm     загрузить. Файл, который уже есть в бакете, пропускается. Повторный запуск безопасен.
 *
 * Ключ в бакете = путь от STORAGE_DIR (letters/<cabinetId>/<файл>), как в базе (Letter.files[].fileKey).
 * Локальные файлы не удаляются. Имена файлов и ключи на экран не выводятся.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseEnv } from '../config/env.schema.js';
import { loadEnvFiles } from '../config/load-env-files.js';
import { StorageService } from '../documents/storage.service.js';

const apiDir = resolve(import.meta.dirname, '..', '..');
loadEnvFiles(apiDir);

const confirm = process.argv.slice(2).includes('--confirm');
const env = parseEnv(process.env);
if (env.STORAGE_MODE !== 's3') {
  console.error('Отказ: нужен STORAGE_MODE=s3 и ключи S3_* в api/.env.');
  process.exit(2);
}
const storage = new StorageService(env);
const remote = storage.remote!;
const lettersDir = join(storage.root, 'letters');

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
const SAFE_FILE = /^[a-zA-Z0-9_-]+\.[a-z0-9]+$/;

async function localKeys(): Promise<{ key: string; bytes: number }[]> {
  const out: { key: string; bytes: number }[] = [];
  let cabinets: string[];
  try {
    cabinets = await readdir(lettersDir);
  } catch {
    return out; // папки нет
  }
  for (const cab of cabinets) {
    if (!SAFE_ID.test(cab)) continue;
    const dir = join(lettersDir, cab);
    if (!(await stat(dir)).isDirectory()) continue;
    for (const name of await readdir(dir)) {
      if (!SAFE_FILE.test(name)) continue;
      const s = await stat(join(dir, name));
      if (s.isFile())
        out.push({ key: `letters/${cab}/${name}`, bytes: s.size });
    }
  }
  return out;
}

const files = await localKeys();
const mb = (files.reduce((n, f) => n + f.bytes, 0) / 1024 / 1024).toFixed(1);
console.log(`Папка:  ${lettersDir}`);
console.log(`Бакет:  ${remote.bucket}`);
console.log(`Файлов: ${files.length}, ${mb} МБ`);

if (!confirm) {
  console.log('\nНичего не загружено. Чтобы загрузить, повторите с --confirm');
} else {
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  for (const f of files) {
    try {
      if (await remote.exists(f.key)) {
        skipped++;
        continue;
      }
      await remote.put(f.key, await readFile(join(storage.root, f.key)));
      uploaded++;
    } catch (e) {
      failed++;
      console.error(`  ошибка: ${(e as Error).name}`);
    }
  }
  console.log(
    `\nЗагружено: ${uploaded}, уже были в бакете: ${skipped}, ошибок: ${failed}.`,
  );
  if (failed) {
    console.error('Запустите ещё раз: загруженные файлы будут пропущены.');
    process.exitCode = 1;
  }
}
