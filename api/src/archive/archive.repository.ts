import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { lockActiveCabinet } from '../erasure/cabinet-lock.js';
import { toPgVector } from '../llm/vector.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ChunkHit {
  id: string;
  letterId: string;
  text: string;
  distance: number;
}

/** Имя в SQL в кавычках: "jasno". Имена схем берутся из конфигурации, но кавычки всё равно экранируются. */
const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * L05 (#81): сырой SQL для векторов (Prisma не умеет тип vector).
 * Каждый запрос поиска ограничен cabinetId: чужие письма в выдачу не попадают (AGENTS.md: отбор делает код).
 */
@Injectable()
export class ArchiveRepository {
  private vectorSchema: Promise<string> | null = null;

  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  private get table(): string {
    return `${ident(this.db.dbSchema)}."LetterChunk"`;
  }

  /** Схема расширения vector: public локально и в CI, на Supabase может быть extensions. */
  private async vectorType(): Promise<{ type: string; op: string }> {
    this.vectorSchema ??= this.db
      .$queryRawUnsafe<{ nspname: string }[]>(
        `SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'vector'`,
      )
      .then((rows) => {
        if (!rows[0]) throw new Error('расширение vector не установлено');
        return rows[0].nspname;
      })
      .catch((e: unknown) => {
        this.vectorSchema = null;
        throw e;
      });
    const nsp = ident(await this.vectorSchema);
    return { type: `${nsp}.vector`, op: `OPERATOR(${nsp}.<=>)` };
  }

  /**
   * Заменяет куски письма новыми. Письмо уже удалено или аккаунт удаляется: ничего не пишет, false.
   */
  async replaceChunks(
    cabinetId: string,
    letterId: string,
    hash: string,
    chunks: { text: string; vector: number[] }[],
  ): Promise<boolean> {
    const { type } = await this.vectorType();
    return this.db.$transaction(async (tx) => {
      if (!(await lockActiveCabinet(tx, cabinetId))) return false;
      const letter = await tx.letter.count({ where: { id: letterId, cabinetId } });
      if (!letter) return false;
      await tx.letterChunk.deleteMany({ where: { letterId } });
      for (const [n, c] of chunks.entries()) {
        await tx.$executeRawUnsafe(
          `INSERT INTO ${this.table} ("id", "cabinetId", "letterId", "n", "text", "textHash", "embedding")
           VALUES ($1, $2, $3, $4, $5, $6, $7::${type})`,
          randomUUID(),
          cabinetId,
          letterId,
          n,
          c.text,
          hash,
          toPgVector(c.vector),
        );
      }
      return true;
    });
  }

  /** Ближайшие куски писем этого кабинета (косинусное расстояние, 0 — то же направление). */
  async search(cabinetId: string, vector: number[], limit: number): Promise<ChunkHit[]> {
    const { type, op } = await this.vectorType();
    const rows = await this.db.$queryRawUnsafe<ChunkHit[]>(
      `SELECT "id", "letterId", "text", ("embedding" ${op} $2::${type})::float8 AS "distance"
         FROM ${this.table}
        WHERE "cabinetId" = $1
        ORDER BY "distance" ASC
        LIMIT $3`,
      cabinetId,
      toPgVector(vector),
      limit,
    );
    return rows.map((r) => ({ ...r, distance: Number(r.distance) }));
  }
}
