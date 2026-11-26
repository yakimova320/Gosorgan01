import { Inject, Injectable } from '@nestjs/common';
import { isEnvelope } from '@jasno/shared';
import { ApiError } from '../common/api-error.js';
import { StorageService } from '../documents/storage.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { sealClaim } from './claim-fields.js';
import { VaultService } from './vault.service.js';

export interface LegacyStep {
  done: { kind: 'letter' | 'case'; id: string } | null;
  remaining: number;
}

/**
 * E01 (#163): письма и дела, загруженные до шифрования (keyId null), шифруются по одному за запрос
 * новым ключом из браузера. Сначала дела (у них черновики и факты своего письма), потом письма.
 * Открытые копии не остаются: поля перезаписываются шифротекстом, оригиналы — файлом JXB1.
 * Письмо без резюме в поиск по архиву не попадает (L05-куски с открытым текстом удалены миграцией).
 */
@Injectable()
export class LegacyEncryptionService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(VaultService) private readonly vault: VaultService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  async remaining(cabinetId: string): Promise<number> {
    const [cases, letters] = await Promise.all([
      this.db.case.count({ where: { cabinetId, keyId: null } }),
      this.db.letter.count({ where: { cabinetId, keyId: null } }),
    ]);
    return cases + letters;
  }

  async next(cabinetId: string): Promise<LegacyStep> {
    if (!(await this.vault.hasVault(cabinetId))) throw new ApiError('ENCRYPTION_SETUP_REQUIRED');
    const kase = await this.db.case.findFirst({
      where: { cabinetId, keyId: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (kase) {
      await this.encryptCase(cabinetId, kase.id);
      return { done: { kind: 'case', id: kase.id }, remaining: await this.remaining(cabinetId) };
    }
    const letter = await this.db.letter.findFirst({
      where: { cabinetId, keyId: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (letter) {
      await this.encryptLetter(cabinetId, letter.id);
      return { done: { kind: 'letter', id: letter.id }, remaining: await this.remaining(cabinetId) };
    }
    return { done: null, remaining: 0 };
  }

  private async encryptCase(cabinetId: string, caseId: string): Promise<void> {
    const key = await this.vault.takeNewKey(cabinetId);
    const keyId = key!.keyId;
    await this.db.$transaction(async (tx) => {
      const row = await tx.case.findFirst({ where: { id: caseId, cabinetId, keyId: null } });
      if (!row) return; // уже зашифровано параллельным запросом
      await this.vault.saveKey(tx, cabinetId, key);
      await tx.case.update({
        where: { id: caseId },
        data: {
          keyId,
          title: await this.vault.seal(cabinetId, keyId, row.title),
          authority: await this.vault.sealOrNull(cabinetId, keyId, row.authority),
          caseNumber: await this.vault.sealOrNull(cabinetId, keyId, row.caseNumber),
        },
      });
      for (const d of await tx.draft.findMany({ where: { caseId } })) {
        if (isEnvelope(d.germanText)) continue;
        await tx.draft.update({
          where: { id: d.id },
          data: {
            germanText: await this.vault.seal(cabinetId, keyId, d.germanText),
            russianText: await this.vault.seal(cabinetId, keyId, d.russianText),
            claimSnapshot: await this.vault.sealJson(cabinetId, keyId, (d.claimSnapshot ?? {}) as object),
            verification: await this.vault.sealJson(cabinetId, keyId, (d.verification ?? {}) as object),
          },
        });
      }
      // факты своего письма (B16): без письма, принадлежат делу
      for (const c of await tx.claim.findMany({ where: { caseId, letterId: null } })) {
        if (isEnvelope(c.text)) continue;
        await tx.claim.update({ where: { id: c.id }, data: await this.claimData(cabinetId, keyId, c) });
      }
    });
  }

  private async encryptLetter(cabinetId: string, letterId: string): Promise<void> {
    const key = await this.vault.takeNewKey(cabinetId);
    const keyId = key!.keyId;
    const files = await this.db.letter.findFirst({
      where: { id: letterId, cabinetId, keyId: null },
      select: { files: true },
    });
    if (!files) return;
    await this.db.$transaction(
      async (tx) => {
        const row = await tx.letter.findFirst({ where: { id: letterId, cabinetId, keyId: null } });
        if (!row) return;
        await this.vault.saveKey(tx, cabinetId, key);
        await tx.letter.update({
          where: { id: letterId },
          data: {
            keyId,
            rawText: await this.vault.seal(cabinetId, keyId, row.rawText),
            title: await this.vault.sealOrNull(cabinetId, keyId, row.title),
            explanation: row.explanation
              ? await this.vault.sealJson(cabinetId, keyId, row.explanation as object)
              : Prisma.DbNull,
            translation: row.translation
              ? await this.vault.sealJson(cabinetId, keyId, row.translation as object)
              : Prisma.DbNull,
          },
        });
        for (const c of await tx.claim.findMany({ where: { letterId } })) {
          if (isEnvelope(c.text)) continue;
          await tx.claim.update({ where: { id: c.id }, data: await this.claimData(cabinetId, keyId, c) });
        }
        // Оригиналы: тот же путь, содержимое — шифротекст. Файл до шифрования (не JXB1) перезаписывается.
        for (const f of (row.files as unknown as { fileKey: string }[]) ?? []) {
          const data = await this.storage.read(f.fileKey);
          if (!data) continue;
          await this.storage.write(f.fileKey, await this.vault.sealBytes(cabinetId, keyId, data));
        }
      },
      { timeout: this.storage.uploadTxTimeoutMs },
    );
  }

  private async claimData(
    cabinetId: string,
    keyId: string,
    c: { kind: string; value: string; text: string; quote: string | null },
  ) {
    const sealed = await sealClaim(this.vault, cabinetId, keyId, {
      kind: c.kind,
      value: c.value,
      text: c.text,
      quote: c.quote,
    });
    return { value: sealed.value, text: sealed.text, quote: sealed.quote ?? null };
  }
}
