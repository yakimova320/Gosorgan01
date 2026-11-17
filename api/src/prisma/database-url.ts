/**
 * Разбирает адрес PostgreSQL для адаптера pg.
 * Параметр `?schema=` понимает Prisma CLI, но не драйвер pg:
 * он убирается из адреса и передаётся адаптеру отдельно.
 */
export function parseDatabaseUrl(url: string): {
  connectionString: string;
  schema?: string;
} {
  const parsed = new URL(url);
  const schema = parsed.searchParams.get('schema') ?? undefined;
  parsed.searchParams.delete('schema');
  return { connectionString: parsed.toString(), schema };
}
