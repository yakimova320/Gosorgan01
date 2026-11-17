import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DocumentsService } from '../documents/documents.service.js';
import { StorageService } from '../documents/storage.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LetterView, UploadLetterResponse } from './letters.dto.js';

interface StoredFile {
  n: number;
  fileKey: string;
  mime: string;
  bytes: number;
}

/**
 * Приём письма (B05): проверки → текст → оригинал на диск → строка Letter во входящих.
 * ID письма создаётся заранее: журнал LlmCall связан с ним и с кабинетом, даже если письмо не сохранилось.
 * При любой ошибке не остаётся ни строки Letter, ни файла.
 */
@Injectable()
export class LettersService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  async upload(cabinetId: string, data: Buffer): Promise<UploadLetterResponse> {
    const kind = this.documents.precheck(data);
    const letterId = randomUUID();
    const doc = await this.documents.extractText(data, kind, {
      cabinetId,
      letterId,
    });

    const ext = kind === 'jpeg' ? 'jpg' : kind;
    const fileKey = this.storage.newKey(cabinetId, ext);
    await this.storage.write(fileKey, data);
    const files: StoredFile[] = [
      { n: 1, fileKey, mime: doc.mime, bytes: data.length },
    ];

    try {
      const row = await this.db.letter.create({
        data: {
          id: letterId,
          cabinetId,
          sourceType: doc.sourceType,
          rawText: doc.text,
          pages: doc.pages,
          files: files as unknown as object[],
        },
      });
      return {
        letter: toView(row, files),
        claims: [],
        deadlines: [],
        suggestions: [],
      };
    } catch (e) {
      await this.storage.remove(fileKey);
      throw e;
    }
  }

  /**
   * Полное удаление письма: строка, файлы и журнал LlmCall по letterId.
   * Используется удалением письма (B06/B07); удаление аккаунта (A01) удаляет LlmCall по cabinetId.
   */
  async removeLetter(cabinetId: string, letterId: string): Promise<boolean> {
    const letter = await this.db.letter.findFirst({
      where: { id: letterId, cabinetId },
    });
    if (!letter) return false;
    await this.db.$transaction([
      this.db.llmCall.deleteMany({ where: { letterId } }),
      this.db.letter.delete({ where: { id: letterId } }),
    ]);
    for (const f of (letter.files as unknown as StoredFile[]) ?? [])
      await this.storage.remove(f.fileKey);
    return true;
  }
}

function toView(
  row: {
    id: string;
    caseId: string | null;
    sourceType: string;
    rawText: string;
    pages: unknown;
    createdAt: Date;
  },
  files: StoredFile[],
): LetterView {
  return {
    id: row.id,
    caseId: row.caseId,
    sourceType: row.sourceType as LetterView['sourceType'],
    text: row.rawText,
    pages: row.pages as LetterView['pages'],
    files: files.map(({ n, mime, bytes }) => ({ n, mime, bytes })),
    createdAt: row.createdAt.toISOString(),
  };
}
