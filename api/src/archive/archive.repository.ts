import { Inject, Injectable } from '@nestjs/common';
import { toPgVector } from '../llm/vector.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface SummaryHit {
  letterId: string;
  distance: number;
}

/** Имя в SQL в кавычках: "jasno". Имена схем берутся из конфигурации, но кавычки всё равно экранируются. */
const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * L05 (#81), E01 (#163): сырой SQL для векторов (Prisma не умеет тип vector).
 * Вектор — от обезличенного резюме письма (LetterSummary), открытых кусков текста больше нет.
 * Каждый запрос поиска ограничен cabinetId: чужие письма в выдачу не попадают (AGENTS.md: отбор делает код).
 */
@Injectable()
export class ArchiveRepository {
  private vectorSchema: Promise<string> | null = null;

  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  private get table(): string {
    return `${ident(this.db.dbSchema)}."LetterSummary"`;
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
   * Резюме письма: зашифрованный текст и открытый вектор. Пишется в транзакции загрузки письма.
   * db — клиент транзакции (письмо уже создано в ней).
   */
  async saveSummary(
    db: Pick<PrismaService, '$executeRawUnsafe'>,
    row: { cabinetId: string; letterId: string; summary: string; embedderId: string; vector: number[] },
  ): Promise<void> {
    const { type } = await this.vectorType();
    await db.$executeRawUnsafe(
      `INSERT INTO ${this.table} ("letterId", "cabinetId", "summary", "embedderId", "embedding")
       VALUES ($1, $2, $3, $4, $5::${type})
       ON CONFLICT ("letterId") DO UPDATE SET "summary" = EXCLUDED."summary",
         "embedderId" = EXCLUDED."embedderId", "embedding" = EXCLUDED."embedding"`,
      row.letterId,
      row.cabinetId,
      row.summary,
      row.embedderId,
      toPgVector(row.vector),
    );
  }

  /** Ближайшие письма этого кабинета по вектору резюме (косинусное расстояние, 0 — то же направление). */
  async search(cabinetId: string, embedderId: string, vector: number[], limit: number): Promise<SummaryHit[]> {
    const { type, op } = await this.vectorType();
    const rows = await this.db.$queryRawUnsafe<SummaryHit[]>(
      `SELECT "letterId", ("embedding" ${op} $2::${type})::float8 AS "distance"
         FROM ${this.table}
        WHERE "cabinetId" = $1 AND "embedderId" = $4
        ORDER BY "distance" ASC
        LIMIT $3`,
      cabinetId,
      toPgVector(vector),
      limit,
      embedderId,
    );
    return rows.map((r) => ({ ...r, distance: Number(r.distance) }));
  }
}
