import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';

/** Папка api: и из src/documents, и из dist/documents на два уровня выше. */
const API_DIR = resolve(import.meta.dirname, '..', '..');

/*
 * Оригиналы писем: STORAGE_DIR/letters/<cabinetId>/<случайный ключ>.
 * Имя исходного файла не сохраняется. Папка не раздаётся статически: файлы отдаёт только код с проверкой владельца (B11).
 * Папка кабинета нужна для полного удаления аккаунта (A01): при удалении она переносится
 * в корзину STORAGE_DIR/trash/<id задания>/letters и удаляется только после удаления строк базы.
 */
const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

/** Файловые операции корзины. Объект можно подменить в тестах сбоев. */
export const fileOps = { access, mkdir, readdir, rename, rm, rmdir };

@Injectable()
export class StorageService {
  private readonly logger = new Logger('Storage');
  readonly root: string;
  readonly ops = { ...fileOps };

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

  /** B11: оригинал письма. Нет файла: null (ответ API 404), путь в лог не пишется. */
  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathOf(key));
    } catch {
      return null;
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

  // ---------- Письма восстановления пароля (A03, MAIL_MODE=file) ----------
  // STORAGE_DIR/mail-outbox/<cabinetId>/<id задания>.eml. В файле действующая ссылка: папки 0700,
  // файлы 0600, статически не раздаются. Удаляются после сброса и смены пароля и при удалении аккаунта.

  mailDir(cabinetId: string): string {
    if (!SAFE_ID.test(cabinetId)) throw new Error('bad cabinetId');
    return resolve(this.root, 'mail-outbox', cabinetId);
  }

  async writeMail(cabinetId: string, id: string, data: Buffer): Promise<string> {
    if (!SAFE_ID.test(id)) throw new Error('bad mail id');
    const dir = this.mailDir(cabinetId);
    await this.ops.mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${id}.eml`);
    try {
      await writeFile(path, data, { flag: 'w', mode: 0o600 });
    } catch (e) {
      await this.ops.rm(path, { force: true }).catch(() => undefined);
      throw e;
    }
    return path;
  }

  async removeMailFile(path: string): Promise<void> {
    await this.ops.rm(path, { force: true });
  }

  /** Все письма кабинета. Нет папки: не ошибка. Ошибка удаления пробрасывается (решает вызывающий). */
  async removeMailDir(cabinetId: string): Promise<void> {
    await this.ops.rm(this.mailDir(cabinetId), { recursive: true, force: true });
  }

  // ---------- Корзина удаления аккаунта (A01) ----------
  // Все операции повторяемые: решают по фактическому месту файлов, а не по записанному статусу.

  /** Папка писем кабинета → корзина задания. Новые файлы в обеих папках сливаются. */
  async moveCabinetToTrash(cabinetId: string, jobId: string): Promise<void> {
    await this.moveDir(this.cabinetDir(cabinetId), this.trashLetters(jobId));
  }

  /** Обратно из корзины. Нет корзины: возвращать нечего, это не ошибка. */
  async restoreCabinetFromTrash(
    cabinetId: string,
    jobId: string,
  ): Promise<void> {
    await this.moveDir(this.trashLetters(jobId), this.cabinetDir(cabinetId));
    await this.ops.rm(this.trashDir(jobId), { recursive: true, force: true });
  }

  /** Окончательная очистка: корзина и (на всякий случай) папка кабинета. Ошибка пробрасывается. */
  async purgeErasure(cabinetId: string, jobId: string): Promise<void> {
    await this.ops.rm(this.trashDir(jobId), { recursive: true, force: true });
    await this.ops.rm(this.cabinetDir(cabinetId), {
      recursive: true,
      force: true,
    });
  }

  async exists(path: string): Promise<boolean> {
    return this.ops.access(path).then(
      () => true,
      () => false,
    );
  }

  cabinetDir(cabinetId: string): string {
    if (!SAFE_ID.test(cabinetId)) throw new Error('bad cabinetId');
    return resolve(this.root, 'letters', cabinetId);
  }

  trashDir(jobId: string): string {
    if (!SAFE_ID.test(jobId)) throw new Error('bad jobId');
    return resolve(this.root, 'trash', jobId);
  }

  private trashLetters(jobId: string): string {
    return join(this.trashDir(jobId), 'letters');
  }

  private async moveDir(src: string, dst: string): Promise<void> {
    if (!(await this.exists(src))) return;
    if (!(await this.exists(dst))) {
      await this.ops.mkdir(dirname(dst), { recursive: true });
      await this.ops.rename(src, dst);
      return;
    }
    for (const name of await this.ops.readdir(src))
      await this.ops.rename(join(src, name), join(dst, name));
    await this.ops.rmdir(src);
  }

  pathOf(key: string): string {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + '/') && !path.startsWith(this.root + '\\'))
      throw new Error('bad key');
    return path;
  }
}
