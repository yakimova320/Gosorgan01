import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';

/** Папка api: и из src/documents, и из dist/documents на два уровня выше. */
const API_DIR = resolve(import.meta.dirname, '..', '..');

/*
 * Оригиналы писем: STORAGE_DIR/letters/<cabinetId>/<случайный ключ>.
 * Имя исходного файла не сохраняется. Папка не раздаётся статически: файлы отдаёт только код с проверкой владельца (B11).
 * Папка кабинета нужна для полного удаления аккаунта (A01).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger('Storage');
  readonly root: string;

  constructor(@Inject(APP_CONFIG) config: Pick<Env, 'STORAGE_DIR'>) {
    this.root = isAbsolute(config.STORAGE_DIR)
      ? config.STORAGE_DIR
      : resolve(API_DIR, config.STORAGE_DIR);
  }

  /** Ключ файла: letters/<cabinetId>/<32 hex>.<ext>. Наружу (в ответ API) не отдаётся. */
  newKey(cabinetId: string, ext: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(cabinetId)) throw new Error('bad cabinetId');
    return `letters/${cabinetId}/${randomBytes(16).toString('hex')}.${ext}`;
  }

  async write(key: string, data: Buffer): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, data, { flag: 'wx' });
    } catch (e) {
      await this.remove(key); // частично записанный файл не оставляем
      throw e;
    }
  }

  /** Удаление, которое не ломает операцию: отсутствующий файл не ошибка, путь в лог не пишется. */
  async remove(key: string): Promise<void> {
    try {
      await rm(this.pathOf(key), { force: true });
    } catch (e) {
      this.logger.error(`не удалось удалить файл письма: ${(e as Error).name}`);
    }
  }

  async removeCabinet(cabinetId: string): Promise<void> {
    if (!/^[a-zA-Z0-9_-]+$/.test(cabinetId)) return;
    await rm(resolve(this.root, 'letters', cabinetId), {
      recursive: true,
      force: true,
    }).catch(() => this.logger.error('не удалось удалить папку кабинета'));
  }

  pathOf(key: string): string {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + '/') && !path.startsWith(this.root + '\\'))
      throw new Error('bad key');
    return path;
  }
}
